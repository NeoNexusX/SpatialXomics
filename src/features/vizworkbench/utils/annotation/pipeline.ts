/**
 * 注释管线（纯计算，worker / 主线程兜底 / 单测共用）。
 *
 *  run():         匹配 → 关联同分子、同峰 → 打分 → decoy 走同一流程 → 初始 q → 排名 → 空间任务
 *  applyImage():  收到一个峰的离子图 → 截顶后算混乱度（按峰缓存）、与已经到了的配对峰算 Pearson
 *                 （按峰对缓存）→ 峰和峰对都有结果的分子组回填空间分与总分；最后一个任务完成时
 *                 用同一套 decoy 重算 q 和排名
 *
 * 空间评分默认覆盖全部目标与 decoy。比例小于 100% 时，按初始总分取指定比例的目标行
 * 所在分子组（含组内全部加合离子），以及初始总分不低于同一阈值的 decoy 所在的组。
 *
 * 每个峰的图只需送来一次（主线程按 m/z 顺序读）。还有峰对要算的峰留着截顶后的图，总量超出
 * 上限时先释放下一次用到最晚的；之后配对峰到了而它不在，就请主线程重读。混乱度和相关只取决于
 * 图本身，结果与送图的顺序无关。
 */

import { ADDUCT_BY_ID, adductMz, type AdductDef, type AdductId } from '@/shared/chem/adducts'
import type {
  AnnotationDb,
  AnnotationResult,
  EngineConfig,
  IonAnnotation,
  IonPatch,
  IonScores,
  Molecule,
  PeakTable,
  RunSummary,
  SpatialJob,
  SpatialPatch,
  Tolerance,
} from '@/features/vizworkbench/types/annotation'
import { countNonZero, hotspotClip, measureOfChaos } from './chaos'
import { decoyElementIndex, decoyElementPool, decoyShift } from './decoys'
import { qValues } from './fdr'
import { emptyHits, matchDecoys, matchTargets } from './match'
import { pairKey, pearsonUnionMask } from './pearson'
import { colocScore, massScore, spatialScore, totalScore } from './score'
import { matchableRange } from './tolerance'

export interface SessionInput {
  db: AnnotationDb
  peaks: PeakTable
  adducts: { id: AdductId; fit: number }[]
  tolerance: Tolerance
  config: EngineConfig
}

/** 限定比例时 decoy 空间任务的上限（选中目标行数的倍数）；全部计算时不设上限 */
const DECOY_JOB_FACTOR = 2

/** 留着的截顶图的总字节上限 */
const RETAIN_BYTES = 256 * 1024 * 1024

/** 目标分子组的空间任务键（主线程据此把可见行的任务提前） */
export function targetJobKey(moleculeId: number): string {
  return `t${moleculeId}`
}

/** 排名顺序：总分降序；并列时误差绝对值小者优先，再按强度、id */
export function compareIons(a: IonAnnotation, b: IonAnnotation): number {
  const ia = Number.isFinite(a.intensity) ? a.intensity : 0
  const ib = Number.isFinite(b.intensity) ? b.intensity : 0
  return (
    b.scores.total - a.scores.total ||
    Math.abs(a.errPpm) - Math.abs(b.errPpm) ||
    ib - ia ||
    a.id - b.id
  )
}

/** 一个空间任务 = 一个分子组；成员之间互为兄弟（共定位只在组内算） */
interface JobState {
  axisIndices: number[]
  /** 目标组：成员行 id */
  ionIds: number[]
  /** decoy 组：成员在 decoy 列式数组里的下标 */
  decoyIdx: number[]
  /** 还没有结果的峰与峰对数，为 0 时打分 */
  left: number
  done: boolean
}

/** 空间任务里的一个峰 */
interface AxisState {
  axis: number
  /** 含这个峰的任务 */
  jobs: JobState[]
  /** 要和它算相关的峰（各任务里的其他峰，去重），与 pairKeys 一一对应 */
  partners: number[]
  pairKeys: string[]
  /** 还没有结果的峰对数 */
  pending: number
  /** 图送来过（读取失败也算） */
  delivered: boolean
  failed: boolean
  /** 截顶后的图：还有峰对要用时留着 */
  clip: Float32Array | null
  /** 已请求重读，还没送到 */
  rereading: boolean
}

/** 一张图带来的变化 */
interface Changes {
  ions: IonPatch[]
  pairs: [string, number | null][]
  /** 完成的任务数 */
  jobs: number
  /** 要主线程重读的峰 */
  reread: number[]
}

export class AnnotationSession {
  private readonly input: SessionInput
  private readonly defs: (AdductDef & { fit: number })[]
  private readonly ions: IonAnnotation[] = []
  private readonly molecules = new Map<number, Molecule>()

  // decoy（列式，不出 worker）
  private readonly dAxis: number[] = []
  private readonly dMass: number[] = []
  private readonly dFit: number[] = []
  private readonly dTotal: number[] = []
  /** `${重复}:${分子}` → decoy 下标 */
  private readonly dGroups = new Map<string, number[]>()

  private readonly jobs = new Map<string, JobState>()
  private jobsDone = 0
  private readonly axes = new Map<number, AxisState>()
  /** 还没有结果的峰对 → 含它的任务 */
  private readonly pairJobs = new Map<string, JobState[]>()
  /** 留着截顶图的峰 */
  private readonly retained = new Set<AxisState>()
  private retainedBytes = 0
  private readonly retainBytes: number
  private readonly chaosByAxis = new Map<number, number>()
  private readonly pairR = new Map<string, number | null>()
  private summary!: RunSummary

  /** retainBytes：留着的截顶图的总字节上限（单测用小值验证重读） */
  constructor(input: SessionInput, opts: { retainBytes?: number } = {}) {
    this.input = input
    this.defs = input.adducts.map((a) => ({ ...ADDUCT_BY_ID[a.id], fit: a.fit }))
    this.retainBytes = opts.retainBytes ?? RETAIN_BYTES
  }

  run(): AnnotationResult {
    const t0 = performance.now()
    const { peaks, config: cfg } = this.input
    this.buildTargets()
    this.linkMolecules()
    this.buildDecoys()
    this.assignQ()
    // 之后只改 spatialState，不影响排序，排好的顺序直接给空间任务和结果用
    const ranked = this.assignRanks()
    const jobs = this.planSpatialJobs(ranked)
    this.summary = {
      peaks: peaks.mz.length,
      ions: this.ions.length,
      molecules: this.molecules.size,
      qCounts: this.qCounts(),
      decoy: { replicates: cfg.decoyReplicates, ions: this.dTotal.length },
      spatial: { total: this.jobs.size, done: 0 },
      timingMs: Math.round(performance.now() - t0),
    }
    return {
      // 副本：主线程兜底时会话和界面不共享同一批对象
      ions: ranked.map((i) => ({ ...i, scores: { ...i.scores } })),
      molecules: [...this.molecules.values()],
      summary: { ...this.summary },
      jobs,
    }
  }

  // ---- 目标 ------------------------------------------------------------------

  private buildTargets(): void {
    const { db, peaks, tolerance: tol, config: cfg } = this.input
    const hits = matchTargets(db.mass, this.defs, peaks.mz, tol)
    const byPeak = new Map<number, number[]>()
    for (let k = 0; k < hits.mol.length; k++) {
      const def = this.defs[hits.adduct[k]!]!
      const peak = hits.peak[k]!
      const mass = massScore(hits.errPpm[k]!, hits.theo[k]!, tol, cfg.massSigma)
      this.ions.push({
        id: k,
        moleculeId: hits.mol[k]!,
        adduct: def.id,
        fit: def.fit,
        peak,
        axisIndex: peaks.axisIndex[peak]!,
        theoMz: hits.theo[k]!,
        obsMz: peaks.mz[peak]!,
        errPpm: hits.errPpm[k]!,
        intensity: peaks.intensity[peak]!,
        samePeak: [],
        scores: unscored(mass, def.fit, 'na', cfg),
        q: null,
        rank: 0,
      })
      const list = byPeak.get(peak)
      if (list) list.push(k)
      else byPeak.set(peak, [k])
    }
    // 同一个峰的多种解释
    for (const ids of byPeak.values()) {
      if (ids.length < 2) continue
      for (const id of ids) this.ions[id]!.samePeak = ids.filter((x) => x !== id)
    }
  }

  /** 按分子归组（不合并行），并列出已启用但没检出的加合物 */
  private linkMolecules(): void {
    const { db, peaks, tolerance: tol } = this.input
    for (const ion of this.ions) {
      let m = this.molecules.get(ion.moleculeId)
      if (!m) {
        m = {
          id: ion.moleculeId,
          formula: db.formula[ion.moleculeId]!,
          neutralMass: db.mass[ion.moleculeId]!,
          candidates: db.candidates[ion.moleculeId] ?? [],
          ionIds: [],
          missing: [],
        }
        this.molecules.set(ion.moleculeId, m)
      }
      m.ionIds.push(ion.id)
    }
    if (peaks.mz.length === 0) return
    const [cLo, cHi] = matchableRange(peaks.mz[0]!, peaks.mz[peaks.mz.length - 1]!, tol)
    for (const m of this.molecules.values()) {
      const have = new Set(m.ionIds.map((id) => this.ions[id]!.adduct))
      for (const def of this.defs) {
        if (have.has(def.id)) continue
        const theoMz = adductMz(m.neutralMass, def)
        m.missing.push({ adduct: def.id, theoMz, outOfRange: theoMz < cLo || theoMz > cHi })
      }
    }
  }

  // ---- decoy -----------------------------------------------------------------

  private buildDecoys(): void {
    const { db, peaks, tolerance: tol, config: cfg } = this.input
    const pool = decoyElementPool(this.defs)
    if (pool.length === 0) return
    // 位移只取决于（元素, 加合物），先按加合物算好整池，逐分子只查表
    const shifts = this.defs.map((def) => pool.map((element) => decoyShift(element, def)))
    for (let r = 0; r < cfg.decoyReplicates; r++) {
      const hits = emptyHits()
      this.defs.forEach((def, ai) => {
        const pooled = shifts[ai]!
        const shiftOf = (mol: number) =>
          pooled[decoyElementIndex(mol, ai, r, cfg.seed, pooled.length)]!
        matchDecoys(db.mass, def, ai, shiftOf, peaks.mz, tol, hits)
      })
      for (let k = 0; k < hits.mol.length; k++) {
        const idx = this.dTotal.length
        const fit = this.defs[hits.adduct[k]!]!.fit
        const mass = massScore(hits.errPpm[k]!, hits.theo[k]!, tol, cfg.massSigma)
        this.dAxis.push(peaks.axisIndex[hits.peak[k]!]!)
        this.dMass.push(mass)
        this.dFit.push(fit)
        this.dTotal.push(totalScore(mass, fit, null, cfg))
        const key = `${r}:${hits.mol[k]}`
        const group = this.dGroups.get(key)
        if (group) group.push(idx)
        else this.dGroups.set(key, [idx])
      }
    }
  }

  // ---- q 值与排名 --------------------------------------------------------------

  private assignQ(): void {
    const q = qValues(
      this.ions.map((i) => i.scores.total),
      this.dTotal,
      this.input.config.decoyReplicates,
    )
    this.ions.forEach((ion, i) => (ion.q = q[i]!))
  }

  /** 按排名顺序返回全部行 */
  private assignRanks(): IonAnnotation[] {
    const order = [...this.ions].sort(compareIons)
    order.forEach((ion, i) => (ion.rank = i + 1))
    return order
  }

  private qCounts(): RunSummary['qCounts'] {
    const c = { q05: 0, q10: 0, q20: 0 }
    for (const { q } of this.ions) {
      if (q == null) continue
      if (q <= 0.05) c.q05++
      if (q <= 0.1) c.q10++
      if (q <= 0.2) c.q20++
    }
    return c
  }

  // ---- 空间评分 ----------------------------------------------------------------

  private planSpatialJobs(ranked: IonAnnotation[]): SpatialJob[] {
    const pct = Math.min(100, Math.max(0, this.input.config.spatialPct))
    const all = pct === 100
    const limit = Math.ceil((ranked.length * pct) / 100)
    const tier = ranked.slice(0, limit)
    if (tier.length === 0) return []
    const cutoff = tier[tier.length - 1]!.scores.total
    const out: SpatialJob[] = []

    // 目标：初始排名前指定比例的行所在分子组，向上取整保留不足一项的比例
    for (const ion of tier) {
      const job = targetJobKey(ion.moleculeId)
      if (this.jobs.has(job)) continue
      const ionIds = this.molecules.get(ion.moleculeId)!.ionIds
      const axisIndices = uniqueAxes(ionIds.map((id) => this.ions[id]!.axisIndex))
      for (const id of ionIds) this.ions[id]!.scores.spatialState = 'queued'
      this.jobs.set(job, { axisIndices, ionIds, decoyIdx: [], left: 0, done: false })
      out.push({ job, axisIndices, priority: ion.rank })
    }

    // decoy：全部计算时覆盖所有组；限定比例时使用同一初始总分阈值
    const groups = [...this.dGroups]
      .map(([key, idx]) => ({ key, idx, best: Math.max(...idx.map((i) => this.dTotal[i]!)) }))
      .filter((g) => all || g.best >= cutoff)
      .sort((a, b) => b.best - a.best)
      .slice(0, all ? undefined : limit * DECOY_JOB_FACTOR)
    groups.forEach(({ key, idx }, n) => {
      const axisIndices = uniqueAxes(idx.map((i) => this.dAxis[i]!))
      const job = `d${key}`
      this.jobs.set(job, { axisIndices, ionIds: [], decoyIdx: idx, left: 0, done: false })
      out.push({ job, axisIndices, priority: tier.length + 1 + n })
    })
    this.indexSpatialJobs()
    return out
  }

  /** 每个任务等它的峰和组内两两峰对都有结果；建峰 → 任务、峰对 → 任务的索引 */
  private indexSpatialJobs(): void {
    for (const job of this.jobs.values()) {
      const axes = job.axisIndices
      job.left = axes.length + (axes.length * (axes.length - 1)) / 2
      for (let i = 0; i < axes.length; i++) {
        const a = this.axisState(axes[i]!)
        a.jobs.push(job)
        for (let j = i + 1; j < axes.length; j++) {
          const key = pairKey(axes[i]!, axes[j]!)
          const jobs = this.pairJobs.get(key)
          if (jobs) {
            jobs.push(job)
            continue
          }
          this.pairJobs.set(key, [job])
          const b = this.axisState(axes[j]!)
          a.partners.push(b.axis)
          a.pairKeys.push(key)
          a.pending++
          b.partners.push(a.axis)
          b.pairKeys.push(key)
          b.pending++
        }
      }
    }
  }

  private axisState(axis: number): AxisState {
    let st = this.axes.get(axis)
    if (!st) {
      st = {
        axis,
        jobs: [],
        partners: [],
        pairKeys: [],
        pending: 0,
        delivered: false,
        failed: false,
        clip: null,
        rereading: false,
      }
      this.axes.set(axis, st)
    }
    return st
  }

  /**
   * 一个峰的离子图到了（null 或尺寸不对 = 读取失败）。返回这张图带来的变化（没有时为 null）
   * 和要主线程重读的峰：送来过、图已释放、现在配对峰到了又要用它。
   * 不在任何任务里的峰、重复送来的图不产生变化。
   */
  applyImage(
    axis: number,
    image: Float32Array | null,
    width: number,
    height: number,
  ): { patch: SpatialPatch | null; reread: number[] } {
    const st = this.axes.get(axis)
    const changes: Changes = { ions: [], pairs: [], jobs: 0, reread: [] }
    if (st) {
      st.rereading = false
      if (image && image.length === width * height) this.receive(st, image, width, height, changes)
      else this.fail(st, changes)
    }
    return { patch: this.patchOf(changes), reread: changes.reread }
  }

  /** 截顶后算混乱度（只在第一次送来时），再与留着图的配对峰算 Pearson */
  private receive(
    st: AxisState,
    image: Float32Array,
    width: number,
    height: number,
    changes: Changes,
  ): void {
    // 失败过的峰不再用；图还留着或峰对都有结果了：重复送来的图没有新东西
    if (st.failed || st.clip || (st.delivered && st.pending === 0)) return
    const { minPixels } = this.input.config
    const clip = hotspotClip(image, 99)
    if (!st.delivered) {
      st.delivered = true
      const chaos = countNonZero(clip) < minPixels ? 0 : (measureOfChaos(clip, width, height) ?? 0)
      // 恰为 1 的退化结果记 0
      this.chaosByAxis.set(st.axis, chaos === 1 ? 0 : chaos)
      for (const job of st.jobs) this.progress(job, changes)
    }
    st.partners.forEach((p, k) => {
      const key = st.pairKeys[k]!
      if (!this.pairJobs.has(key)) return
      const other = this.axes.get(p)!
      if (other.clip) {
        const r = pearsonUnionMask(clip, other.clip, minPixels)
        this.pairR.set(key, r)
        changes.pairs.push([key, r])
        this.resolvePair(key, st, other, changes)
      } else if (other.delivered && !other.rereading) {
        // 配对峰的图已经释放：请主线程重读，这张图留着等它
        other.rereading = true
        changes.reread.push(p)
      }
    })
    if (st.pending > 0) this.retain(st, clip)
  }

  /** 读取失败：没有混乱度（第一次就失败时），和它的峰对都不再算 */
  private fail(st: AxisState, changes: Changes): void {
    if (st.failed || st.clip) return
    st.failed = true
    if (!st.delivered) {
      st.delivered = true
      for (const job of st.jobs) this.progress(job, changes)
    }
    st.partners.forEach((p, k) => {
      const key = st.pairKeys[k]!
      if (this.pairJobs.has(key)) this.resolvePair(key, st, this.axes.get(p)!, changes)
    })
  }

  /** 峰对有了结果（算出 r，或一侧读取失败）：推进含它的任务，两个峰都少一个待算的峰对 */
  private resolvePair(key: string, a: AxisState, b: AxisState, changes: Changes): void {
    const jobs = this.pairJobs.get(key)!
    this.pairJobs.delete(key)
    for (const job of jobs) this.progress(job, changes)
    for (const st of [a, b]) if (--st.pending === 0 && st.clip) this.release(st)
  }

  /** 任务的一个峰或峰对有了结果；全都有了就打分 */
  private progress(job: JobState, changes: Changes): void {
    if (--job.left > 0 || job.done) return
    job.done = true
    this.jobsDone++
    changes.jobs++
    const ionAxes = job.ionIds.map((id) => this.ions[id]!.axisIndex)
    job.ionIds.forEach((id, k) => {
      const ion = this.ions[id]!
      ion.scores = this.scoreSpatial(k, ionAxes, ion.scores.mass, ion.fit)
      changes.ions.push({ id, scores: { ...ion.scores } })
    })
    const decoyAxes = job.decoyIdx.map((i) => this.dAxis[i]!)
    job.decoyIdx.forEach((di, k) => {
      this.dTotal[di] = this.scoreSpatial(k, decoyAxes, this.dMass[di]!, this.dFit[di]!).total
    })
  }

  /** 没有变化时为 null；最后一个任务完成时用同一套 decoy 重算 q 和排名，带全量 q 与 rank */
  private patchOf(changes: Changes): SpatialPatch | null {
    if (changes.jobs === 0 && changes.pairs.length === 0) return null
    const final = changes.jobs > 0 && this.jobsDone === this.jobs.size
    if (final) {
      this.assignQ()
      this.assignRanks()
      const byId = new Map(changes.ions.map((p) => [p.id, p]))
      for (const ion of this.ions) {
        const p = byId.get(ion.id)
        if (p) Object.assign(p, { q: ion.q, rank: ion.rank })
        else changes.ions.push({ id: ion.id, q: ion.q, rank: ion.rank })
      }
      this.summary.qCounts = this.qCounts()
    }
    this.summary.spatial = { total: this.jobs.size, done: this.jobsDone }
    return { ions: changes.ions, pairR: changes.pairs, summary: { ...this.summary }, final }
  }

  /** 留着截顶图；超出上限时释放下一次用到最晚的 */
  private retain(st: AxisState, clip: Float32Array): void {
    st.clip = clip
    this.retained.add(st)
    this.retainedBytes += clip.byteLength
    while (this.retainedBytes > this.retainBytes) {
      let victim: AxisState | null = null
      let latest = -Infinity
      for (const s of this.retained) {
        const next = this.nextUse(s)
        if (next > latest) {
          latest = next
          victim = s
        }
      }
      // 留着的都在等配对峰重读：暂时超出上限
      if (!victim) break
      this.release(victim)
    }
  }

  private release(st: AxisState): void {
    this.retainedBytes -= st.clip!.byteLength
    st.clip = null
    this.retained.delete(st)
  }

  /**
   * 图下一次用到的位置：还没送来的配对峰里最小的轴下标（主线程按 m/z 顺序送图）。
   * 有配对峰送来过、图已释放、正在重读：这张图要等它，-Infinity 表示不能释放
   */
  private nextUse(st: AxisState): number {
    let next = Infinity
    for (let k = 0; k < st.partners.length; k++) {
      if (!this.pairJobs.has(st.pairKeys[k]!)) continue
      const p = st.partners[k]!
      if (this.axes.get(p)!.delivered) return -Infinity
      if (p < next) next = p
    }
    return next
  }

  /** 组内第 k 个成员的空间分：混乱度与组内最大有效相关（r > 0.1）的加权和 */
  private scoreSpatial(k: number, groupAxes: number[], mass: number, fit: number): IonScores {
    const cfg = this.input.config
    const axis = groupAxes[k]!
    const chaos = this.chaosByAxis.get(axis)
    if (chaos == null) {
      return unscored(mass, fit, this.axes.get(axis)?.failed ? 'error' : 'na', cfg)
    }
    let coloc: number | null = null
    for (let j = 0; j < groupAxes.length; j++) {
      const other = groupAxes[j]!
      if (j === k) continue
      const r = this.pairR.get(pairKey(axis, other))
      if (r != null) coloc = Math.max(coloc ?? 0, colocScore(r))
    }
    const spatial = spatialScore(chaos, coloc, cfg.spatialWeights)
    return {
      mass,
      adduct: fit,
      chaos,
      coloc,
      spatial,
      spatialState: 'done',
      total: totalScore(mass, fit, spatial, cfg),
    }
  }
}

function unscored(
  mass: number,
  fit: number,
  spatialState: IonScores['spatialState'],
  cfg: EngineConfig,
): IonScores {
  return {
    mass,
    adduct: fit,
    chaos: null,
    coloc: null,
    spatial: null,
    spatialState,
    total: totalScore(mass, fit, null, cfg),
  }
}

function uniqueAxes(axes: number[]): number[] {
  return [...new Set(axes)]
}

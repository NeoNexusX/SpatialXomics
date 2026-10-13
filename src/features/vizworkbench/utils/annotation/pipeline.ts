/**
 * 注释管线（纯计算，worker / 主线程兜底 / 单测共用）。
 *
 *  run():           匹配 → 关联同分子、同峰 → 打分 → decoy 走同一流程 → 初始 q → 排名 → 空间任务
 *  applySpatial():  收到一个分子组的离子图 → 混乱度（按峰缓存）+ 组内两两 Pearson（按峰对缓存）
 *                   → 回填空间分与总分；最后一个任务完成时用同一套 decoy 重算 q 和排名
 *
 * 空间评分默认覆盖全部目标与 decoy。比例小于 100% 时，按初始总分取指定比例的目标行
 * 所在分子组（含组内全部加合离子），以及初始总分不低于同一阈值的 decoy 所在的组。
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
  done: boolean
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
  private readonly chaosByAxis = new Map<number, number>()
  private readonly pairR = new Map<string, number | null>()
  private summary!: RunSummary

  constructor(input: SessionInput) {
    this.input = input
    this.defs = input.adducts.map((a) => ({ ...ADDUCT_BY_ID[a.id], fit: a.fit }))
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
      this.jobs.set(job, { axisIndices, ionIds, decoyIdx: [], done: false })
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
      this.jobs.set(job, { axisIndices, ionIds: [], decoyIdx: idx, done: false })
      out.push({ job, axisIndices, priority: tier.length + 1 + n })
    })
    return out
  }

  /**
   * 一个任务的离子图到了（与 axisIndices 一一对应，null = 读取失败，undefined = 主线程
   * 判定这个峰的混乱度和所在峰对都已算过、没有传图）。任务未知或已处理过时返回 null。
   */
  applySpatial(
    job: string,
    images: (Float32Array | null | undefined)[],
    width: number,
    height: number,
  ): SpatialPatch | null {
    const state = this.jobs.get(job)
    if (!state || state.done) return null
    state.done = true
    this.jobsDone++

    const failed = new Set<number>()
    const newPairs = this.measure(state.axisIndices, images, width, height, failed)

    const patches: IonPatch[] = []
    const ionAxes = state.ionIds.map((id) => this.ions[id]!.axisIndex)
    state.ionIds.forEach((id, k) => {
      const ion = this.ions[id]!
      ion.scores = this.scoreSpatial(k, ionAxes, failed, ion.scores.mass, ion.fit)
      patches.push({ id, scores: { ...ion.scores } })
    })
    const decoyAxes = state.decoyIdx.map((i) => this.dAxis[i]!)
    state.decoyIdx.forEach((di, k) => {
      this.dTotal[di] = this.scoreSpatial(
        k,
        decoyAxes,
        failed,
        this.dMass[di]!,
        this.dFit[di]!,
      ).total
    })

    const final = this.jobsDone === this.jobs.size
    if (final) {
      this.assignQ()
      this.assignRanks()
      const byId = new Map(patches.map((p) => [p.id, p]))
      for (const ion of this.ions) {
        const p = byId.get(ion.id)
        if (p) Object.assign(p, { q: ion.q, rank: ion.rank })
        else patches.push({ id: ion.id, q: ion.q, rank: ion.rank })
      }
      this.summary.qCounts = this.qCounts()
    }
    this.summary.spatial = { total: this.jobs.size, done: this.jobsDone }
    return { ions: patches, pairR: newPairs, summary: { ...this.summary }, final }
  }

  /**
   * 截顶后算各峰的混乱度（按峰缓存）与组内两两 Pearson（按峰对缓存）；返回新算出的峰对。
   * 同一个峰会出现在许多目标 / decoy 任务里，截顶按需进行：混乱度和峰对都已缓存的峰不再截顶。
   */
  private measure(
    axes: number[],
    images: (Float32Array | null | undefined)[],
    width: number,
    height: number,
    failed: Set<number>,
  ): [string, number | null][] {
    const { minPixels } = this.input.config
    const valid = new Map<number, Float32Array>()
    axes.forEach((axis, k) => {
      const img = images[k]
      if (img === undefined) return
      if (img && img.length === width * height) valid.set(axis, img)
      else failed.add(axis)
    })
    const clipped = new Map<number, Float32Array>()
    const clipOf = (axis: number): Float32Array => {
      let clip = clipped.get(axis)
      if (!clip) clipped.set(axis, (clip = hotspotClip(valid.get(axis)!, 99)))
      return clip
    }
    for (const axis of valid.keys()) {
      if (this.chaosByAxis.has(axis)) continue
      const clip = clipOf(axis)
      const chaos = countNonZero(clip) < minPixels ? 0 : (measureOfChaos(clip, width, height) ?? 0)
      // 恰为 1 的退化结果记 0
      this.chaosByAxis.set(axis, chaos === 1 ? 0 : chaos)
    }
    const newPairs: [string, number | null][] = []
    const ok = [...valid.keys()]
    for (let i = 0; i < ok.length; i++) {
      for (let j = i + 1; j < ok.length; j++) {
        const key = pairKey(ok[i]!, ok[j]!)
        if (this.pairR.has(key)) continue
        const r = pearsonUnionMask(clipOf(ok[i]!), clipOf(ok[j]!), minPixels)
        this.pairR.set(key, r)
        newPairs.push([key, r])
      }
    }
    return newPairs
  }

  /** 组内第 k 个成员的空间分：混乱度与组内最大有效相关（r > 0.1）的加权和 */
  private scoreSpatial(
    k: number,
    groupAxes: number[],
    failed: Set<number>,
    mass: number,
    fit: number,
  ): IonScores {
    const cfg = this.input.config
    const axis = groupAxes[k]!
    const chaos = this.chaosByAxis.get(axis)
    if (chaos == null) return unscored(mass, fit, failed.has(axis) ? 'error' : 'na', cfg)
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

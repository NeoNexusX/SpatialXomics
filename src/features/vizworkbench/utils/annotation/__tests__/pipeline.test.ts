import { describe, expect, it } from 'vitest'
import positiveCsv from '../__fixtures__/peaks.positive.csv?raw'
import negativeCsv from '../__fixtures__/peaks.negative.csv?raw'
import { buildTestDb } from '../__fixtures__/testDb'
import { testPeaks } from '../__fixtures__/testPeaks'
import { AnnotationSession, targetJobKey } from '../pipeline'
import { DEFAULT_ENGINE_CONFIG } from '../score'
import { buildAnnotationCsv } from '../format'
import { csvLines, splitCsvLine } from '../csv'
import { decoyElementIndex, decoyElementPool, decoyShift } from '../decoys'
import { ADDUCT_BY_ID, adductMz } from '@/shared/chem/adducts'
import type { AdductId } from '@/shared/chem/adducts'
import type {
  AnnotationResult,
  IonAnnotation,
  SpatialJob,
  SpatialPatch,
} from '@/features/vizworkbench/types/annotation'

const POSITIVE: { id: AdductId; fit: number }[] = [
  { id: 'M+H', fit: 1 },
  { id: 'M+Na', fit: 0.9 },
  { id: 'M+K', fit: 0.9 },
]
const NEGATIVE: { id: AdductId; fit: number }[] = [
  { id: 'M-H', fit: 1 },
  { id: 'M+Cl', fit: 0.8 },
  { id: 'M+HCOO', fit: 0.8 },
]

const db = buildTestDb()

function run(
  csv: string,
  adducts: { id: AdductId; fit: number }[],
  spatialPct = DEFAULT_ENGINE_CONFIG.spatialPct,
  weights = DEFAULT_ENGINE_CONFIG.weights,
) {
  const session = new AnnotationSession({
    db,
    peaks: testPeaks(csv),
    adducts,
    tolerance: { value: 5, unit: 'ppm', origin: 'user' },
    config: { ...DEFAULT_ENGINE_CONFIG, weights, spatialPct, seed: 7 },
  })
  return { session, result: session.run() }
}

function ionsOf(result: AnnotationResult, name: string): IonAnnotation[] {
  const m = result.molecules.find((x) => x.candidates[0]?.name === name)
  return m ? result.ions.filter((i) => i.moleculeId === m.id) : []
}

const W = 40
const H = 40
const WEIGHTS = DEFAULT_ENGINE_CONFIG.weights

/**
 * 两个亮度不同的成块区域：低阈值下 2 个连通区域、高阈值下只剩亮的那个。
 * （混乱度在各层区域数完全相同时记 0，单个圆盘会触发这条规则）
 */
function twoBlobs(scale = 1): Float32Array {
  const img = new Float32Array(W * H)
  const blobs = [
    { cx: 12, cy: 12, r: 7, peak: 1 },
    { cx: 28, cy: 28, r: 7, peak: 0.5 },
  ]
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (const b of blobs) {
        const d = Math.hypot(x - b.cx, y - b.cy)
        if (d <= b.r) img[y * W + x] = scale * b.peak * (1 - d / b.r)
      }
    }
  }
  return img
}

/** 把一个任务的图按峰逐个交给会话，合并这些图带来的变化；都没有变化时为 null */
function deliverJob(
  session: AnnotationSession,
  job: SpatialJob,
  images: (Float32Array | null)[],
  width = W,
  height = H,
): SpatialPatch | null {
  let merged: SpatialPatch | null = null
  for (let k = 0; k < job.axisIndices.length; k++) {
    const { patch } = session.applyImage(job.axisIndices[k]!, images[k] ?? null, width, height)
    if (!patch) continue
    merged = merged
      ? {
          ...patch,
          ions: [...merged.ions, ...patch.ions],
          pairR: [...merged.pairR, ...patch.pairR],
        }
      : patch
  }
  return merged
}

describe('AnnotationSession (positive fixture)', () => {
  const { session, result } = run(positiveCsv, POSITIVE)

  it('keeps each adduct ion as its own row and links ions of the same molecule', () => {
    const pc = ionsOf(result, 'PC 34:1')
    expect(pc.map((i) => i.adduct).sort()).toEqual(['M+H', 'M+K', 'M+Na'])
    const mol = result.molecules.find((m) => m.candidates[0]?.name === 'PC 34:1')!
    expect(mol.ionIds.sort()).toEqual(pc.map((i) => i.id).sort())
    expect(mol.candidates.map((c) => c.name)).toEqual(['PC 34:1', 'PC 16:0_18:1', 'PC 18:1_16:0'])
    expect(mol.candidates[0]!.id).toBe('TEST0003')
    for (const ion of pc) expect(Math.abs(ion.errPpm)).toBeLessThan(2.5)
  })

  it('flags a peak that two annotations explain', () => {
    const na = ionsOf(result, 'PC 34:1').find((i) => i.adduct === 'M+Na')!
    const pc364 = ionsOf(result, 'PC 36:4')
    expect(pc364.map((i) => i.adduct)).toEqual(['M+H'])
    expect(na.samePeak).toEqual([pc364[0]!.id])
    expect(pc364[0]!.peak).toBe(na.peak)
  })

  it('lists enabled adducts that were not detected', () => {
    const pc321 = result.molecules.find((m) => m.candidates[0]?.name === 'PC 32:1')!
    expect(ionsOf(result, 'PC 32:1').map((i) => i.adduct)).toEqual(['M+K'])
    expect(pc321.missing.map((m) => m.adduct).sort()).toEqual(['M+H', 'M+Na'])
  })

  it('leaves default-off adducts out until they are enabled', () => {
    expect(ionsOf(result, 'Cholesterol')).toEqual([])
    const withLoss = run(positiveCsv, [...POSITIVE, { id: 'M+H-H2O', fit: 0.4 }]).result
    expect(ionsOf(withLoss, 'Cholesterol').map((i) => i.adduct)).toEqual(['M+H-H2O'])
  })

  it('ranks by total score and gives planted ions low q-values', () => {
    const totals = result.ions.map((i) => i.scores.total)
    for (let i = 1; i < totals.length; i++) expect(totals[i]!).toBeLessThanOrEqual(totals[i - 1]!)
    expect(result.ions.map((i) => i.rank)).toEqual(result.ions.map((_, i) => i + 1))
    for (const ion of result.ions.slice(0, 5)) expect(ion.q!).toBeLessThanOrEqual(0.2)
    expect(result.summary.decoy.replicates).toBe(10)
  })

  it('exports uncomputed spatial scores as zero', () => {
    const molecules = new Map(result.molecules.map((m) => [m.id, m]))
    const ions = new Map(result.ions.map((ion) => [ion.id, ion]))
    const csv = buildAnnotationCsv(result.ions, molecules, ions, new Map())
    const [header, ...lines] = csvLines(csv).map((line) => splitCsvLine(line, ','))
    const spatialColumn = header!.indexOf('Spatial score')
    expect(spatialColumn).toBeGreaterThanOrEqual(0)
    expect(lines).toHaveLength(result.ions.length)
    for (const line of lines) expect(line[spatialColumn]).toBe('0.0000')
  })

  it('scores totals with the configured weights', () => {
    const weights = { mass: 0.5, adduct: 0.2, spatial: 0.3 }
    const { result } = run(positiveCsv, POSITIVE, DEFAULT_ENGINE_CONFIG.spatialPct, weights)
    expect(result.ions.length).toBeGreaterThan(0)
    // 空间分还没算：总分 = 质量与适配度两项
    for (const ion of result.ions) {
      expect(ion.scores.total).toBeCloseTo(0.5 * ion.scores.mass + 0.2 * ion.scores.adduct, 9)
    }
  })

  it('gives failed spatial jobs no spatial contribution', () => {
    const fresh = run(positiveCsv, POSITIVE)
    const job = fresh.result.jobs[0]!
    const patch = deliverJob(
      fresh.session,
      job,
      job.axisIndices.map(() => null),
    )!
    expect(patch.ions.length).toBeGreaterThan(0)
    for (const ion of patch.ions) {
      expect(ion.scores!.spatialState).toBe('error')
      expect(ion.scores!.spatial).toBeNull()
      expect(ion.scores!.total).toBeCloseTo(
        WEIGHTS.mass * ion.scores!.mass + WEIGHTS.adduct * ion.scores!.adduct,
        9,
      )
    }
  })

  it('retains weak positive pair correlations but excludes them from scores', () => {
    const fresh = run(positiveCsv, POSITIVE)
    const pc = ionsOf(fresh.result, 'PC 34:1')
    const job = fresh.result.jobs.find((j) => j.job === targetJobKey(pc[0]!.moleculeId))!
    expect(job.axisIndices).toHaveLength(3)
    // 互相正交的像素模式混入少量共同信号，得到约 0.05 / 0.05 / 0.0025 的相关。
    const images = job.axisIndices.map((_, k) =>
      Float32Array.from({ length: W * H }, (_, i) => {
        const common = i & 1 ? 1 : -1
        if (k === 0) return 4 + common
        const independent = (i >> k) & 1 ? 1 : -1
        return 4 + 0.05 * common + Math.sqrt(1 - 0.05 ** 2) * independent
      }),
    )
    const patch = deliverJob(fresh.session, job, images)!
    expect(patch.pairR).toHaveLength(3)
    for (const [, r] of patch.pairR) {
      expect(r).toBeGreaterThan(0)
      expect(r).toBeLessThanOrEqual(0.1)
    }
    const scored = patch.ions.filter((p) => pc.some((ion) => ion.id === p.id))
    expect(scored).toHaveLength(3)
    for (const { scores } of scored) {
      expect(scores!.spatialState).toBe('done')
      expect(scores!.coloc).toBe(0)
      expect(scores!.spatial).toBeCloseTo(0.2 * scores!.chaos!, 9)
      expect(scores!.total).toBeCloseTo(
        WEIGHTS.mass * scores!.mass +
          WEIGHTS.adduct * scores!.adduct +
          WEIGHTS.spatial * scores!.spatial!,
        9,
      )
    }
  })

  it('backfills weighted chaos and sibling co-localization, then re-ranks with final q', () => {
    const pc = ionsOf(result, 'PC 34:1')
    const mol = pc[0]!.moleculeId
    const job = result.jobs.find((j) => j.job === targetJobKey(mol))!
    expect(job.axisIndices.length).toBe(3)
    // 三个加合离子的图分布相同（强度不同）→ 两两 r ≈ 1
    const images = job.axisIndices.map((_, k) => twoBlobs(k + 1))
    const patch = deliverJob(session, job, images)!
    const scored = patch.ions.filter((p) => pc.some((i) => i.id === p.id))
    expect(scored).toHaveLength(3)
    for (const p of scored) {
      expect(p.scores!.spatialState).toBe('done')
      expect(p.scores!.chaos!).toBeGreaterThan(0.9)
      expect(p.scores!.coloc!).toBeGreaterThan(0.99)
      expect(p.scores!.spatial!).toBeGreaterThan(p.scores!.chaos!)
    }
    expect(patch.pairR).toHaveLength(3)
    // 重复送来的图不会再处理
    expect(deliverJob(session, job, images)).toBeNull()

    // 其余任务给散点图；最后一个任务带全量 q 与排名
    let last = patch
    for (const j of result.jobs) {
      if (j.job === job.job) continue
      const speckle = j.axisIndices.map(() => {
        const img = new Float32Array(W * H)
        for (let i = 0; i < img.length; i += 13) img[i] = 1
        return img
      })
      last = deliverJob(session, j, speckle) ?? last
    }
    expect(last.final).toBe(true)
    expect(last.summary.spatial.done).toBe(last.summary.spatial.total)
    const withRank = last.ions.filter((p) => p.rank !== undefined)
    expect(withRank).toHaveLength(result.ions.length)
    // 成块且共定位的 PC 34:1 排到最前面
    const top = withRank.sort((a, b) => a.rank! - b.rank!)[0]!
    expect(pc.map((i) => i.id)).toContain(top.id)
  })
})

describe('AnnotationSession (negative fixture)', () => {
  it('annotates [M-H]- ions and links chloride / formate adducts of the same lipid', () => {
    const { result } = run(negativeCsv, NEGATIVE)
    expect(
      ionsOf(result, 'PC 34:1')
        .map((i) => i.adduct)
        .sort(),
    ).toEqual(['M+Cl', 'M+HCOO'])
    expect(ionsOf(result, 'PI 38:4').map((i) => i.adduct)).toEqual(['M-H'])
    expect(ionsOf(result, 'Cer d36:1').map((i) => i.adduct)).toEqual(['M+Cl'])
  })
})

describe('spatial calculation scope', () => {
  it('scores every match beyond 100 and all lower-scoring decoys by default', () => {
    const count = 120
    const replicates = 3
    const seed = 7
    const def = ADDUCT_BY_ID['M+H']!
    const pool = decoyElementPool([def])
    const mass = Float64Array.from({ length: count }, (_, i) => 200 + 1000 * i)
    const observed = new Set<number>()
    for (let mol = 0; mol < count; mol++) {
      observed.add(adductMz(mass[mol]!, def))
      for (let r = 0; r < replicates; r++) {
        const element = pool[decoyElementIndex(mol, 0, r, seed, pool.length)]!
        // Decoy 的质量分略低于全部目标，验证“全部”模式不会沿用排名阈值或任务上限。
        observed.add(mass[mol]! + decoyShift(element, def) + 0.000002)
      }
    }
    const mz = Float64Array.from([...observed].sort((a, b) => a - b))
    const session = new AnnotationSession({
      db: {
        id: 'scope',
        label: 'Scope fixture',
        version: '1',
        mass,
        formula: Array.from({ length: count }, (_, i) => `C${i + 1}`),
        candidates: Array.from({ length: count }, () => []),
      },
      peaks: {
        mz,
        intensity: new Float32Array(mz.length).fill(1),
        axisIndex: Int32Array.from({ length: mz.length }, (_, i) => i),
      },
      adducts: [{ id: def.id, fit: 1 }],
      tolerance: { value: 0.00001, unit: 'Da', origin: 'user' },
      config: { ...DEFAULT_ENGINE_CONFIG, decoyReplicates: replicates, seed },
    })
    const result = session.run()
    expect(result.ions).toHaveLength(count)
    expect(result.jobs.filter((job) => job.job.startsWith('t'))).toHaveLength(count)
    expect(result.summary.decoy.ions).toBe(count * replicates)
    expect(result.jobs.filter((job) => job.job.startsWith('d'))).toHaveLength(count * replicates)
    expect(result.ions.every((ion) => ion.scores.spatialState === 'queued')).toBe(true)

    const scored = new Set<number>()
    const image = new Float32Array(25).fill(1)
    let last: SpatialPatch | null = null
    for (const job of result.jobs) {
      // 峰被前面的任务送过时，这个任务可能已经完成
      const patch = deliverJob(
        session,
        job,
        job.axisIndices.map(() => image),
        5,
        5,
      )
      if (!patch) continue
      for (const ion of patch.ions) {
        if (ion.scores?.spatialState === 'done') scored.add(ion.id)
      }
      last = patch
    }
    expect(scored.size).toBe(count)
    expect(last?.final).toBe(true)
    expect(last?.summary.spatial.done).toBe(last?.summary.spatial.total)
    expect(last?.ions.filter((ion) => ion.q != null)).toHaveLength(count)
  })

  it('rounds a nonzero percentage up and keeps every sibling of a selected molecule', () => {
    const { result } = run(positiveCsv, POSITIVE, 0.1)
    const selected = result.ions[0]!.moleculeId
    expect(result.jobs.filter((job) => job.job.startsWith('t')).map((job) => job.job)).toEqual([
      targetJobKey(selected),
    ])
    const group = result.ions.filter((ion) => ion.moleculeId === selected)
    expect(group.length).toBeGreaterThan(1)
    expect(group.every((ion) => ion.scores.spatialState === 'queued')).toBe(true)
    expect(
      result.ions
        .filter((ion) => ion.moleculeId !== selected)
        .every((ion) => ion.scores.spatialState === 'na'),
    ).toBe(true)
  })

  it('selects the top half of initial matches when spatial coverage is 50%', () => {
    const { result } = run(positiveCsv, POSITIVE, 50)
    const selected = new Set(
      result.ions
        .slice(0, Math.ceil(result.ions.length / 2))
        .map((ion) => targetJobKey(ion.moleculeId)),
    )
    const scheduled = result.jobs.filter((job) => job.job.startsWith('t')).map((job) => job.job)
    expect(new Set(scheduled)).toEqual(selected)
    expect(result.ions.some((ion) => ion.scores.spatialState === 'na')).toBe(true)
  })

  it('skips target and decoy spatial scoring at 0%', () => {
    const { result } = run(positiveCsv, POSITIVE, 0)
    expect(result.jobs).toEqual([])
    expect(result.summary.spatial).toEqual({ total: 0, done: 0 })
    expect(result.ions.every((ion) => ion.scores.spatialState === 'na')).toBe(true)
    expect(result.ions.every((ion) => ion.scores.spatial == null)).toBe(true)
  })
})

/**
 * 打分：
 *  - 质量分 = exp(−½·(err/σ)²)，σ = 容差 × massSigma（误差 0 → 1，半个容差 → 0.61，容差边缘 → 0.14）
 *  - 加合分 = 加合物适配度 fit
 *  - 空间分 = 0.2 · chaos + 0.8 · coloc；只有 r > 0.1 的共定位证据计分
 *  - 总分 = 加权和；空间分未计算时按 0 计。权重由面板上的三个比例数（各不小于 0.1，和为 10）
 *    除以三项之和得到
 */

import type {
  EngineConfig,
  ScoreWeights,
  Tolerance,
} from '@/features/vizworkbench/types/annotation'

/** 共定位计分的严格下界；等于此值的相关也不计分。 */
export const MIN_COLOC_CORRELATION = 0.1

/** 面板上三个权重比例数之和 */
export const SCORE_RATIO_TOTAL = 10
/** 每个比例数的下限 */
export const MIN_SCORE_RATIO = 0.1
/** 每个比例数的上限：另外两项至少各取下限 */
export const MAX_SCORE_RATIO = SCORE_RATIO_TOTAL - 2 * MIN_SCORE_RATIO

/** 默认比例 质量 : 加合适配度 : 空间 */
export const DEFAULT_SCORE_RATIO: Readonly<ScoreWeights> = { mass: 6, adduct: 1, spatial: 3 }

/** 单个比例数在 [MIN_SCORE_RATIO, MAX_SCORE_RATIO] 内 */
export function isValidScoreRatioPart(v: number): boolean {
  return typeof v === 'number' && v >= MIN_SCORE_RATIO && v <= MAX_SCORE_RATIO
}

export function scoreRatioSum(ratio: ScoreWeights): number {
  return ratio.mass + ratio.adduct + ratio.spatial
}

/** 每项都在范围内，且三项之和为 SCORE_RATIO_TOTAL（容许小数相加的浮点误差） */
export function isValidScoreRatio(ratio: ScoreWeights): boolean {
  return (
    [ratio.mass, ratio.adduct, ratio.spatial].every(isValidScoreRatioPart) &&
    Math.abs(scoreRatioSum(ratio) - SCORE_RATIO_TOTAL) < 1e-9
  )
}

/** 比例 → 总分权重（除以三项之和）；调用方保证每项大于 0 */
export function normalizeScoreRatio(ratio: ScoreWeights): ScoreWeights {
  const sum = scoreRatioSum(ratio)
  return { mass: ratio.mass / sum, adduct: ratio.adduct / sum, spatial: ratio.spatial / sum }
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  weights: normalizeScoreRatio(DEFAULT_SCORE_RATIO),
  spatialWeights: { chaos: 0.2, coloc: 0.8 },
  massSigma: 0.5,
  spatialPct: 100,
  decoyReplicates: 10,
  minPixels: 20,
  seed: 1,
}

export function massScore(
  errPpm: number,
  theoMz: number,
  tol: Pick<Tolerance, 'value' | 'unit'>,
  sigmaRatio: number,
): number {
  const err = tol.unit === 'ppm' ? Math.abs(errPpm) : Math.abs(errPpm * theoMz * 1e-6)
  const sigma = tol.value * sigmaRatio
  if (!(sigma > 0)) return 0
  return Math.exp(-0.5 * (err / sigma) ** 2)
}

/** 将原始相关转换为可计入空间评分的共定位分。 */
export function colocScore(r: number | null): number {
  if (r == null || !Number.isFinite(r) || r <= MIN_COLOC_CORRELATION) return 0
  return Math.min(1, r)
}

export function spatialScore(
  chaos: number,
  coloc: number | null,
  weights: EngineConfig['spatialWeights'],
): number {
  return weights.chaos * chaos + weights.coloc * colocScore(coloc)
}

export function totalScore(
  mass: number,
  fit: number,
  spatial: number | null,
  cfg: Pick<EngineConfig, 'weights'>,
): number {
  const w = cfg.weights
  return w.mass * mass + w.adduct * fit + w.spatial * (spatial ?? 0)
}

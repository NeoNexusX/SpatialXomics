/**
 * 参与匹配的峰：数据集平均轴上的点，强度取平均谱。
 *  - 平均强度为 0（或无效）的点不参与匹配：整个数据集在这个 m/z 上没有信号
 *  - 其余的点按强度从小到大排，最低的 cutPct% 去掉（面板上的滑动条）
 */

import type { PeakTable } from '@/features/vizworkbench/types/annotation'

/** 滑动条上限：至少留下最强的 1% */
export const MAX_CUT_PCT = 99

function clampPct(pct: number): number {
  return Number.isFinite(pct) ? Math.min(MAX_CUT_PCT, Math.max(0, Math.round(pct))) : 0
}

/** 平均强度 > 0 的点的轴下标，按强度从小到大（并列按下标）。与 cutPct 无关，可以缓存 */
export function rankByIntensity(intensity: ArrayLike<number>): Int32Array {
  const idx: number[] = []
  for (let i = 0; i < intensity.length; i++) if (intensity[i]! > 0) idx.push(i)
  idx.sort((a, b) => intensity[a]! - intensity[b]! || a - b)
  return Int32Array.from(idx)
}

/** 去掉强度最低的 cutPct%（向下取整）后剩下的峰数 */
export function keptCount(nonZero: number, cutPct: number): number {
  return nonZero - Math.floor((nonZero * clampPct(cutPct)) / 100)
}

/** 按强度排名去掉最低的 cutPct%，剩下的按轴下标（即 m/z）升序组成峰表 */
export function selectPeaks(
  axis: ArrayLike<number>,
  intensity: ArrayLike<number>,
  ranked: Int32Array,
  cutPct: number,
): PeakTable {
  const kept = ranked.slice(ranked.length - keptCount(ranked.length, cutPct)).sort()
  return {
    mz: Float64Array.from(kept, (i) => axis[i]!),
    intensity: Float32Array.from(kept, (i) => intensity[i]!),
    axisIndex: kept,
  }
}

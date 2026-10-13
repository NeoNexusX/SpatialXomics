/**
 * m/z 匹配容差：用户填写的值优先，其次按质量分析器给默认值，分析器未知时 10 ppm。
 */

import type { AnalyzerFamily, Tolerance } from '@/features/vizworkbench/types/annotation'

/** 各分析器家族的默认容差（ppm） */
export const ANALYZER_TOLERANCE_PPM: Record<Exclude<AnalyzerFamily, 'other'>, number> = {
  orbitrap: 5,
  fticr: 3,
  qtof: 10,
  tof: 20,
}

const FALLBACK_TOLERANCE_PPM = 10

export function resolveTolerance(
  user: { value: number | null; unit: 'ppm' | 'Da' },
  analyzer: AnalyzerFamily,
): Tolerance {
  if (user.value != null && Number.isFinite(user.value) && user.value > 0) {
    return { value: user.value, unit: user.unit, origin: 'user' }
  }
  if (analyzer !== 'other') {
    return { value: ANALYZER_TOLERANCE_PPM[analyzer], unit: 'ppm', origin: 'analyzer' }
  }
  return { value: FALLBACK_TOLERANCE_PPM, unit: 'ppm', origin: 'fallback' }
}

/** 某 m/z 处的容差半宽（Da） */
export function toleranceDa(mz: number, tol: Pick<Tolerance, 'value' | 'unit'>): number {
  return tol.unit === 'ppm' ? Math.abs(mz) * tol.value * 1e-6 : tol.value
}

/** 理论 m/z 为 c 时，能匹配上的实测 m/z 窗口 [lo, hi] */
export function matchWindow(c: number, tol: Pick<Tolerance, 'value' | 'unit'>): [number, number] {
  if (tol.unit === 'ppm') {
    const t = tol.value * 1e-6
    return [c * (1 - t), c * (1 + t)]
  }
  return [c - tol.value, c + tol.value]
}

/** 实测 m/z 范围 [mzMin, mzMax] 内的峰能匹配上的理论 m/z 范围 */
export function matchableRange(
  mzMin: number,
  mzMax: number,
  tol: Pick<Tolerance, 'value' | 'unit'>,
): [number, number] {
  if (tol.unit === 'ppm') {
    const t = tol.value * 1e-6
    return [mzMin / (1 + t), t < 1 ? mzMax / (1 - t) : Infinity]
  }
  return [mzMin - tol.value, mzMax + tol.value]
}

/**
 * 测试用的峰：peaks.positive.csv / peaks.negative.csv（m/z, intensity）当作一个对齐
 * 数据集的平均轴和平均谱，与 annotation-db.csv 配套。
 */

import { rankByIntensity, selectPeaks } from '../peaks'
import type { PeakTable } from '@/features/vizworkbench/types/annotation'

export interface TestSpectrum {
  /** 平均轴（m/z 升序） */
  axis: Float64Array
  /** 平均谱强度，与 axis 对齐 */
  mean: Float32Array
}

export function parseTestSpectrum(csv: string): TestSpectrum {
  const [header, ...lines] = csv.trim().split(/\r?\n/)
  const cols = header!.split(',')
  const mzCol = cols.indexOf('m/z')
  const intCol = cols.indexOf('intensity')
  const points = lines
    .map((line) => line.split(','))
    .map((f) => [Number(f[mzCol]), Number(f[intCol])] as const)
    .sort((a, b) => a[0] - b[0])
  return {
    axis: Float64Array.from(points, (p) => p[0]),
    mean: Float32Array.from(points, (p) => p[1]),
  }
}

/** 平均轴上全部峰都参与匹配（不按强度过滤） */
export function testPeaks(csv: string): PeakTable {
  const { axis, mean } = parseTestSpectrum(csv)
  return selectPeaks(axis, mean, rankByIntensity(mean), 0)
}

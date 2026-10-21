/**
 * 化合物来源等级（库模板的可选 Origin 列）。
 *
 * 同一分子式的候选按等级排（同级保持库里的先后），第一个候选就是显示名；同一峰上的其他
 * 注释也先按等级、再按排名排。等级只决定先后和标签，不计入总分，也不影响 q 值。
 */

import type { CandidateOrigin, Molecule } from '@/features/vizworkbench/types/annotation'

/** 全部等级，按排序先后 */
export const CANDIDATE_ORIGINS: readonly CandidateOrigin[] = [
  'endogenous',
  'expected',
  'unknown',
  'exogenous',
]

/** 单元格 → 等级（不区分大小写）；认不出的返回 undefined */
export function parseOrigin(raw: string): CandidateOrigin | undefined {
  const value = raw.trim().toLowerCase()
  return CANDIDATE_ORIGINS.find((o) => o === value)
}

/** 排序用的序号，越小越靠前；没有标签的按 unknown 算 */
export function originRank(origin: CandidateOrigin | undefined): number {
  return CANDIDATE_ORIGINS.indexOf(origin ?? 'unknown')
}

/**
 * 分子的来源：第一个候选的等级。候选在建库时已按等级排好，所以这就是候选里最靠前的
 * 等级；分子是外源说明全部候选都是外源。库里没有标签时为 undefined
 */
export function moleculeOrigin(m: Molecule | undefined): CandidateOrigin | undefined {
  return m?.candidates[0]?.origin
}

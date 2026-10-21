/**
 * target-decoy FDR 用的「不可能加合物」：分子式不变，加合元素换成化学上不会以
 * 加合形式出现在 MSI 数据里的元素。每个（分子, 目标加合物, 重复）组合确定性地
 * 抽一个元素，结果可复现。
 */

import { DECOY_ONLY_MASS, MONOISOTOPIC_MASS } from '@/shared/chem/elements'
import { ionShift, type AdductDef } from '@/shared/chem/adducts'

/**
 * 候选元素：排除了 H、碱金属、Mg/Ca/Fe/Cu/Zn、卤素、C/N/O/P/S，以及纳米颗粒和
 * 掺杂会用到的 Ag/Au/Li。
 */
export const DECOY_ELEMENTS: readonly string[] = Object.keys(DECOY_ONLY_MASS)

/** 本次可用的 decoy 元素：再排除已启用加合物引入的元素 */
export function decoyElementPool(enabled: readonly AdductDef[]): string[] {
  const used = new Set(enabled.flatMap((d) => d.elements))
  return DECOY_ELEMENTS.filter((e) => !used.has(e))
}

/** decoy 加合物的质量位移：与目标加合物同电荷，[M+X]± */
export function decoyShift(
  element: string,
  target: Pick<AdductDef, 'polarity' | 'charge'>,
): number {
  return ionShift(MONOISOTOPIC_MASS[element]!, target.polarity, target.charge)
}

/** 32 位整数混合哈希：把（分子, 加合物, 重复, 种子）确定性地映射到元素下标 */
export function decoyElementIndex(
  molecule: number,
  adduct: number,
  replicate: number,
  seed: number,
  poolSize: number,
): number {
  let h = (seed ^ Math.imul(molecule + 1, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  h = (h ^ Math.imul(adduct + 1, 0xc2b2ae35)) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f) >>> 0
  h = (h ^ Math.imul(replicate + 1, 0x165667b1)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  return (h >>> 0) % poolSize
}

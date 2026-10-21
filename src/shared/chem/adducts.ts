/**
 * 加合物定义表（注释面板与 AI 助手的质量检索共用）。
 *
 * 每个加合物的质量位移由元素质量现算，已包含电子质量：
 *   m/z = (nmol · M + shift) / charge
 * 正离子减去 charge 个电子，负离子加上 charge 个电子。
 * 哪些加合物在什么实验条件下启用、适配度多少，由注释模块的规则表决定，不在这里。
 */

import { ELECTRON_MASS, MONOISOTOPIC_MASS } from './elements'

export type AdductPolarity = 'positive' | 'negative'

export type AdductId =
  | 'M+H'
  | 'M+Na'
  | 'M+K'
  | 'M+NH4'
  | 'M+Li'
  | 'M+Ag'
  | 'M+H-H2O'
  | 'M-H'
  | 'M+Cl'
  | 'M+HCOO'
  | 'M+CH3COO'
  | 'M-H-H2O'
  | 'M-2H+Na'
  | 'M-2H+K'

export interface AdductDef {
  id: AdductId
  /** ASCII 写法，用于导出和检索：'[M+H]+' */
  label: string
  /** 界面显示写法（上下标）：'[M+H]⁺' */
  display: string
  polarity: AdductPolarity
  /** |z| */
  charge: number
  /** 聚合度（[2M+H]+ 为 2） */
  nmol: number
  /** Da，已含电子质量 */
  shift: number
  /** 加合物引入的元素（decoy 元素池要排除它们） */
  elements: string[]
}

const el = (symbol: string): number => MONOISOTOPIC_MASS[symbol]!
const H2O = 2 * el('H') + el('O')

/** 离子的质量位移：加上 / 去掉的原子质量之和，正离子再减去 charge 个电子，负离子加上 */
export function ionShift(delta: number, polarity: AdductPolarity, charge: number): number {
  return polarity === 'positive' ? delta - charge * ELECTRON_MASS : delta + charge * ELECTRON_MASS
}

function adduct(
  id: AdductId,
  label: string,
  display: string,
  polarity: AdductPolarity,
  /** 加上 / 去掉的原子质量之和（不含电子） */
  delta: number,
  elements: string[],
): AdductDef {
  const charge = 1
  const shift = ionShift(delta, polarity, charge)
  return { id, label, display, polarity, charge, nmol: 1, shift, elements }
}

export const ADDUCT_DEFS: readonly AdductDef[] = [
  adduct('M+H', '[M+H]+', '[M+H]⁺', 'positive', el('H'), ['H']),
  adduct('M+Na', '[M+Na]+', '[M+Na]⁺', 'positive', el('Na'), ['Na']),
  adduct('M+K', '[M+K]+', '[M+K]⁺', 'positive', el('K'), ['K']),
  adduct('M+NH4', '[M+NH4]+', '[M+NH₄]⁺', 'positive', el('N') + 4 * el('H'), ['N', 'H']),
  adduct('M+Li', '[M+Li]+', '[M+Li]⁺', 'positive', el('Li'), ['Li']),
  adduct('M+Ag', '[M+Ag]+', '[M+Ag]⁺', 'positive', el('Ag'), ['Ag']),
  adduct('M+H-H2O', '[M+H-H2O]+', '[M+H−H₂O]⁺', 'positive', el('H') - H2O, ['H', 'O']),
  adduct('M-H', '[M-H]-', '[M−H]⁻', 'negative', -el('H'), ['H']),
  adduct('M+Cl', '[M+Cl]-', '[M+Cl]⁻', 'negative', el('Cl'), ['Cl']),
  adduct('M+HCOO', '[M+HCOO]-', '[M+HCOO]⁻', 'negative', el('C') + el('H') + 2 * el('O'), [
    'C',
    'H',
    'O',
  ]),
  adduct(
    'M+CH3COO',
    '[M+CH3COO]-',
    '[M+CH₃COO]⁻',
    'negative',
    2 * el('C') + 3 * el('H') + 2 * el('O'),
    ['C', 'H', 'O'],
  ),
  adduct('M-H-H2O', '[M-H-H2O]-', '[M−H−H₂O]⁻', 'negative', -el('H') - H2O, ['H', 'O']),
  adduct('M-2H+Na', '[M-2H+Na]-', '[M−2H+Na]⁻', 'negative', el('Na') - 2 * el('H'), ['Na', 'H']),
  adduct('M-2H+K', '[M-2H+K]-', '[M−2H+K]⁻', 'negative', el('K') - 2 * el('H'), ['K', 'H']),
]

export const ADDUCT_BY_ID: Readonly<Record<AdductId, AdductDef>> = Object.fromEntries(
  ADDUCT_DEFS.map((d) => [d.id, d]),
) as Record<AdductId, AdductDef>

/** 中性质量 → 加合离子 m/z */
export function adductMz(
  neutralMass: number,
  def: Pick<AdductDef, 'charge' | 'nmol' | 'shift'>,
): number {
  return (def.nmol * neutralMass + def.shift) / def.charge
}

/** 按 ASCII 写法组织的位移表（{ '[M+H]+': 1.007276, ... }），供只需要「名称 → 位移」的调用方 */
export function adductShiftTable(ids: AdductId[]): Record<string, number> {
  return Object.fromEntries(ids.map((id) => [ADDUCT_BY_ID[id].label, ADDUCT_BY_ID[id].shift]))
}

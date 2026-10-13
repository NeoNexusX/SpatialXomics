/**
 * 采集元数据 → 规则引擎的离散条件（AcquisitionContext）。
 *
 * 词表里的值（上传表单的下拉选项）逐项精确映射，表用 Record<词表值, …> 声明，
 * 词表新增一项而这里漏了会直接编译报错。用户在 Other 里自填的值和旧数据里的
 * 自由文本才走关键词匹配。
 */

import type {
  ANALYZERS,
  ION_SOURCES,
  MALDI_MATRICES,
  SOLVENTS,
} from '@/features/datasets/constants/datasetMetadata'
import type { Acquisition } from '@/features/vizworkbench/types/acquisition'
import type {
  AcquisitionContext,
  AdditiveKey,
  AnalyzerFamily,
  MatrixKey,
  SourceFamily,
} from '@/features/vizworkbench/types/annotation'

// ---- 极性 -----------------------------------------------------------------

export function normalizePolarity(p: string | null | undefined): 'positive' | 'negative' | null {
  const s = (p ?? '').trim().toLowerCase()
  if (s.startsWith('pos') || s === '+') return 'positive'
  if (s.startsWith('neg') || s === '-') return 'negative'
  return null
}

// ---- 离子源 ---------------------------------------------------------------

const SOURCE_FAMILY: Record<(typeof ION_SOURCES)[number], SourceFamily> = {
  MALDI: 'maldi',
  'AP-MALDI': 'maldi',
  'AP-SMALDI': 'maldi',
  'MALDI-2': 'maldi',
  LDI: 'ldi',
  SALDI: 'ldi',
  DESI: 'esi',
  'nano-DESI': 'esi',
  'IR-MALDESI': 'esi',
  LAESI: 'esi',
  SIMS: 'sims',
  Other: 'other',
}

export function sourceFamilyOf(ionSource: string | null | undefined): SourceFamily {
  const raw = (ionSource ?? '').trim()
  const exact = (SOURCE_FAMILY as Record<string, SourceFamily>)[raw]
  if (exact) return exact
  const s = raw.toLowerCase()
  if (/desi|laesi|maldesi/.test(s)) return 'esi'
  if (/maldi/.test(s)) return 'maldi'
  if (/saldi|\bldi\b/.test(s)) return 'ldi'
  if (/sims/.test(s)) return 'sims'
  return 'other'
}

// ---- 质量分析器 -----------------------------------------------------------

const ANALYZER_FAMILY: Record<(typeof ANALYZERS)[number], AnalyzerFamily> = {
  'Orbitrap Exploris 480': 'orbitrap',
  'Orbitrap Exploris 240': 'orbitrap',
  'Orbitrap Exploris 120': 'orbitrap',
  'Q Exactive HF': 'orbitrap',
  'Q Exactive': 'orbitrap',
  'timsTOF fleX': 'qtof',
  Orbitrap: 'orbitrap',
  FTICR: 'fticr',
  TOF: 'tof',
  // Thermo 在原始文件里把 Orbitrap 记作 FTMS
  FTMS: 'orbitrap',
  'Q-TOF': 'qtof',
  Other: 'other',
}

export function analyzerFamilyOf(analyzer: string | null | undefined): AnalyzerFamily {
  const raw = (analyzer ?? '').trim()
  const exact = (ANALYZER_FAMILY as Record<string, AnalyzerFamily>)[raw]
  if (exact) return exact
  const s = raw.toLowerCase()
  if (/ft-?icr|solarix/.test(s)) return 'fticr'
  if (/orbitrap|exactive|exploris|ftms/.test(s)) return 'orbitrap'
  if (/timstof|q-?tof|synapt|xevo/.test(s)) return 'qtof'
  if (/\btof\b/.test(s)) return 'tof'
  return 'other'
}

// ---- 基质 -----------------------------------------------------------------

const MATRIX_KEY: Record<(typeof MALDI_MATRICES)[number], MatrixKey> = {
  'CHCA (α-Cyano-4-hydroxycinnamic acid)': 'chca',
  'DHB (2,5-Dihydroxybenzoic acid)': 'dhb',
  'NEDC(N-(1-naphthyl)ethylenediamine dihydrochloride)': 'nedc',
  'Sinapinic acid': 'sa',
  '9-AA (9-Aminoacridine)': '9aa',
  Norharmane: 'norharmane',
  'DAN (1,5-Diaminonaphthalene)': 'dan',
  'DHAP (2,6-Dihydroxyacetophenone)': 'dhap',
  'Ionic liquid matrices': 'ionic',
  'Gold nanoparticle': 'aunp',
  'Silver nanoparticle': 'agnp',
  Other: 'other',
}

const MATRIX_KEYWORDS: [MatrixKey, RegExp][] = [
  ['chca', /\bchca\b|cyano-?4-?hydroxycinnamic/i],
  ['dhap', /\bdhap\b|dihydroxyacetophenone/i],
  ['dhb', /\bdhb\b|2,5-dihydroxybenzoic/i],
  ['nedc', /\bnedc\b|naphthyl\)?ethylenediamine/i],
  ['sa', /sinapinic/i],
  ['9aa', /9-?aa\b|aminoacridine/i],
  ['norharmane', /norharmane/i],
  ['dan', /\bdan\b|diaminonaphthalene/i],
  ['ionic', /ionic liquid/i],
  ['aunp', /gold|\baunp/i],
  ['agnp', /silver|\bagnp/i],
]

export function matrixKeyOf(matrix: string | null | undefined): MatrixKey | null {
  const raw = (matrix ?? '').trim()
  if (!raw) return null
  const exact = (MATRIX_KEY as Record<string, MatrixKey>)[raw]
  if (exact) return exact
  for (const [key, re] of MATRIX_KEYWORDS) if (re.test(raw)) return key
  return 'other'
}

// ---- 溶剂 → 添加剂 --------------------------------------------------------

/** 溶剂词表的每一项对应的添加剂（影响哪些加合物见 adductRules.ts） */
const SOLVENT_ADDITIVES: Record<(typeof SOLVENTS)[number], AdditiveKey[]> = {
  Water: [],
  'Acetonitrile (ACN)': [],
  'Methanol (MeOH)': [],
  Ethanol: [],
  'Isopropanol (IPA)': [],
  Acetone: [],
  'Dimethylformamide (DMF)': [],
  // TFA 名字里有 acetic，但不提供乙酸根
  'Trifluoroacetic acid (TFA)': [],
  'Formic acid': ['formate'],
  'Acetic acid': ['acetate'],
  'Ammonium hydroxide': ['ammonium'],
  'Ammonium acetate': ['ammonium', 'acetate'],
  'Ammonium formate': ['ammonium', 'formate'],
  'Ammonium fluoride': ['ammonium'],
  Chloroform: ['chloride'],
  'Lithium chloride (LiCl)': ['lithium', 'chloride'],
  'Sodium acetate': ['sodium', 'acetate'],
  'Silver nitrate (AgNO3)': ['silver'],
  Other: [],
}

/**
 * 自由文本的关键词兜底。要避开两个陷阱：
 * 「Trifluoroacetic」含 acetic、「三氟乙酸」含「乙酸」；「苯甲酸」（如 DHB 的中文名）含「甲酸」。
 */
const ADDITIVE_KEYWORDS: [AdditiveKey, RegExp][] = [
  ['formate', /formic|formate|(?<!苯)甲酸/i],
  ['acetate', /(?<!trifluoro)acet(?:ic|ate)|(?<!三氟)乙酸|醋酸|\bOAc\b/i],
  ['ammonium', /ammonium|ammonia|\bNH4|\bNH3\b|氨水|铵/i],
  ['chloride', /chloroform|chloride|\bHCl\b|LiCl|NaCl|NH4Cl|氯仿|氯化/i],
  ['lithium', /lithium|LiCl|锂/i],
  ['sodium', /sodium|NaCl|NaOAc|钠/i],
  ['silver', /silver|AgNO3|银/i],
]

/** 溶剂串（"70% Methanol (MeOH), 0.1% Formic acid" 或自由文本）→ 添加剂 */
export function additivesOf(solvent: string | null | undefined): AdditiveKey[] {
  const out = new Set<AdditiveKey>()
  for (const part of (solvent ?? '').split(',')) {
    const name = part.replace(/^\s*[\d.]+\s*%\s*/, '').trim()
    if (!name) continue
    const exact = (SOLVENT_ADDITIVES as Record<string, AdditiveKey[]>)[name]
    if (exact) {
      for (const a of exact) out.add(a)
      continue
    }
    for (const [key, re] of ADDITIVE_KEYWORDS) if (re.test(name)) out.add(key)
  }
  return [...out]
}

// ---- 汇总 -----------------------------------------------------------------

export function buildAcquisitionContext(
  acq: Pick<Acquisition, 'polarity' | 'ionSource' | 'analyzer' | 'maldiMatrix' | 'solvent'>,
  polarityOverride: 'positive' | 'negative' | null = null,
): AcquisitionContext {
  return {
    polarity: polarityOverride ?? normalizePolarity(acq.polarity),
    source: sourceFamilyOf(acq.ionSource),
    analyzer: analyzerFamilyOf(acq.analyzer),
    matrix: matrixKeyOf(acq.maldiMatrix),
    additives: additivesOf(acq.solvent),
  }
}

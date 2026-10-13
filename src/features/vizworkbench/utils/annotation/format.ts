/** 注释面板的数值格式化与导出 */

import { ADDUCT_BY_ID, type AdductId } from '@/shared/chem/adducts'
import type { IonAnnotation, Molecule } from '@/features/vizworkbench/types/annotation'
import { pairKey } from './pearson'

export function fmtScore(v: number | null | undefined): string {
  return v != null && Number.isFinite(v) ? v.toFixed(2) : '–'
}

/** q 值显示为百分数 */
export function fmtQ(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '–'
  const pct = v * 100
  if (pct < 0.1) return '<0.1%'
  return `${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%`
}

/** q 值按筛选档位着色：≤5% / ≤10% 绿，≤20% 黄，其余灰 */
export function qLevelClass(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v > 0.2) return 'text-base-content/40'
  if (v <= 0.05) return 'font-semibold text-success'
  return v <= 0.1 ? 'text-success' : 'text-warning'
}

export function fmtMz(v: number | null | undefined): string {
  return v != null && Number.isFinite(v) ? v.toFixed(6) : '–'
}

/** 带符号的 ppm（负号用 −） */
export function fmtPpm(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '–'
  const s = v.toFixed(1)
  if (s === '0.0' || s === '-0.0') return '0.0'
  return v > 0 ? `+${s}` : s.replace('-', '−')
}

export function fmtIntensity(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '–'
  if (v === 0) return '0'
  if (v >= 1e5 || v < 1e-2) return v.toExponential(2)
  return v >= 100 ? v.toFixed(0) : v.toFixed(2)
}

/** 界面写法：'[M+NH₄]⁺' */
export function adductDisplay(id: AdductId): string {
  return ADDUCT_BY_ID[id].display
}

/** ASCII 写法：'[M+NH4]+'（导出、助手） */
export function adductLabel(id: AdductId): string {
  return ADDUCT_BY_ID[id].label
}

/** 同分子离子小标签的短写：'[M+Na]⁺' → 'Na⁺'，'[M−H]⁻' → '−H⁻' */
export function adductShort(id: AdductId): string {
  return ADDUCT_BY_ID[id].display.replace(/^\[M\+?/, '').replace(']', '')
}

/** 分子的显示名：第一个候选名，没有候选名时用分子式 */
export function moleculeName(m: Molecule | undefined): string {
  return m?.candidates[0]?.name || m?.formula || ''
}

/** 同分子的其他加合离子（按分子表里的顺序） */
export function siblingIons(
  ion: IonAnnotation,
  molecules: Map<number, Molecule>,
  ionById: Map<number, IonAnnotation>,
): IonAnnotation[] {
  return (molecules.get(ion.moleculeId)?.ionIds ?? [])
    .filter((id) => id !== ion.id)
    .flatMap((id) => ionById.get(id) ?? [])
}

/** 同一个峰上的其他注释（samePeak 本身不含自己） */
export function samePeakIons(
  ion: IonAnnotation,
  ionById: Map<number, IonAnnotation>,
): IonAnnotation[] {
  return ion.samePeak.flatMap((id) => ionById.get(id) ?? [])
}

/** 常见数据库编号的条目页面；认不出的编号返回 null */
export function compoundUrl(id: string): string | null {
  if (/^HMDB\d{5,}$/.test(id)) return `https://hmdb.ca/metabolites/${id}`
  if (/^LM[A-Z]{2}\d{8}$/.test(id)) return `https://www.lipidmaps.org/databases/lmsd/${id}`
  if (/^C\d{5}$/.test(id)) return `https://www.kegg.jp/entry/${id}`
  if (/^CHEBI:\d+$/.test(id)) return `https://www.ebi.ac.uk/chebi/searchId.do?chebiId=${id}`
  return null
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function num(v: number | null | undefined, digits: number): string {
  return v != null && Number.isFinite(v) ? v.toFixed(digits) : ''
}

const CSV_HEADER = [
  'Rank',
  'Name',
  'Candidates',
  'Candidate IDs',
  'Formula',
  'Neutral mass',
  'Adduct',
  'Theoretical m/z',
  'Observed m/z',
  'Error (ppm)',
  'Mean intensity',
  'Mass score',
  'Adduct fit',
  'Chaos',
  'Co-localization',
  'Spatial score',
  'Total score',
  'q',
  'Same-molecule ions',
  'Same-peak annotations',
]

/** 导出：每个离子一行，按给定顺序 */
export function buildAnnotationCsv(
  ions: IonAnnotation[],
  molecules: Map<number, Molecule>,
  ionById: Map<number, IonAnnotation>,
  pairR: Map<string, number | null>,
): string {
  const lines = [CSV_HEADER.join(',')]
  for (const ion of ions) {
    const m = molecules.get(ion.moleculeId)
    const siblings = siblingIons(ion, molecules, ionById).map((s) => {
      const r = pairR.get(pairKey(ion.axisIndex, s.axisIndex))
      return `${adductLabel(s.adduct)} ${fmtMz(s.obsMz)}${r != null ? ` r=${r.toFixed(2)}` : ''}`
    })
    const samePeak = samePeakIons(ion, ionById).map(
      (s) => `${moleculeName(molecules.get(s.moleculeId))} ${adductLabel(s.adduct)}`,
    )
    const cells = [
      String(ion.rank),
      csvCell(moleculeName(m)),
      csvCell((m?.candidates ?? []).map((c) => c.name).join('; ')),
      csvCell(
        (m?.candidates ?? [])
          .map((c) => c.id)
          .filter(Boolean)
          .join('; '),
      ),
      csvCell(m?.formula ?? ''),
      num(m?.neutralMass, 6),
      csvCell(adductLabel(ion.adduct)),
      num(ion.theoMz, 6),
      num(ion.obsMz, 6),
      num(ion.errPpm, 3),
      num(ion.intensity, 2),
      num(ion.scores.mass, 4),
      num(ion.scores.adduct, 2),
      num(ion.scores.chaos, 4),
      num(ion.scores.coloc, 4),
      num(ion.scores.spatial ?? 0, 4),
      num(ion.scores.total, 4),
      num(ion.q, 4),
      csvCell(siblings.join('; ')),
      csvCell(samePeak.join('; ')),
    ]
    lines.push(cells.join(','))
  }
  return lines.join('\r\n')
}

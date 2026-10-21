/**
 * 区域比较结果的差异离子导出（临时功能）。
 *
 * 导出 A-only / B-only / A-enriched / B-enriched（即除 shared 外的全部差异
 * 类别）且已注释到的离子：比较行的 ionIndex 即平均谱轴下标，与
 * IonAnnotation.axisIndex 同空间，按轴下标精确匹配；processed 分箱模式下
 * ionIndex 是箱号，退回按 m/z 最近邻（20 ppm）匹配。一个峰上的多个注释
 * 解释（同量异位等）各占一行。
 */

import type { IonComparison } from '@/features/vizworkbench/composables/useRegionComparison'
import type { IonAnnotation, Molecule } from '@/features/vizworkbench/types/annotation'
import { adductLabel, moleculeName } from '@/features/vizworkbench/utils/annotation/format'

const CSV_HEADER = [
  'Category',
  'Name',
  'Candidates',
  'Candidate IDs',
  'Formula',
  'Adduct',
  'm/z',
  'Error (ppm)',
  'Det ratio',
  'Det direction',
  'Int ratio',
  'Int direction',
  'Total score',
  'q',
]

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function num(v: number | null | undefined, digits: number): string {
  return v != null && Number.isFinite(v) ? v.toFixed(digits) : ''
}

/** 比值列与界面同口径：富集方做分子，值 >= 1，方向用 A/B 或 B/A 标明。 */
function orientedPair(
  v: number,
): { value: string; direction: 'A/B' | 'B/A' } {
  if (v === Infinity || v === 0) return { value: 'inf', direction: v === Infinity ? 'A/B' : 'B/A' }
  return { value: (v >= 1 ? v : 1 / v).toFixed(2), direction: v >= 1 ? 'A/B' : 'B/A' }
}

/** Category 列展示词，与结果表格 / i18n 完全同词。 */
const CATEGORY_LABEL: Record<string, string> = {
  'a-only': 'A only',
  'b-only': 'B only',
  'a-enriched': 'A enriched',
  'b-enriched': 'B enriched',
}

export function buildComparisonCsv(
  results: IonComparison[],
  ions: IonAnnotation[],
  molecules: Map<number, Molecule>,
): { csv: string; count: number } {
  const byAxis = new Map<number, IonAnnotation[]>()
  for (const ion of ions) {
    const list = byAxis.get(ion.axisIndex)
    if (list) list.push(ion)
    else byAxis.set(ion.axisIndex, [ion])
  }

  /** processed 分箱模式的 m/z 兜底匹配：最近的注释峰，20 ppm 内 */
  const nearestByMz = (mz: number): IonAnnotation[] => {
    const tol = mz * 20e-6
    let best: IonAnnotation | null = null
    let bestErr = Infinity
    for (const ion of ions) {
      const err = Math.abs(ion.obsMz - mz)
      if (err < bestErr) {
        bestErr = err
        best = ion
      }
    }
    return best && bestErr <= tol ? [best] : []
  }

  const lines = [CSV_HEADER.join(',')]
  let count = 0
  for (const row of results) {
    if (row.category === 'shared') continue
    const matches = byAxis.get(row.ionIndex) ?? nearestByMz(row.mz)
    if (!matches.length) continue
    const det = orientedPair(row.detRatio)
    const inten = orientedPair(row.ratio)
    for (const ion of matches) {
      const m = molecules.get(ion.moleculeId)
      const cells = [
        CATEGORY_LABEL[row.category] ?? row.category,
        csvCell(moleculeName(m)),
        csvCell((m?.candidates ?? []).map((c) => c.name).join('; ')),
        csvCell(
          (m?.candidates ?? [])
            .map((c) => c.id)
            .filter(Boolean)
            .join('; '),
        ),
        csvCell(m?.formula ?? ''),
        csvCell(adductLabel(ion.adduct)),
        num(row.mz, 6),
        num(ion.errPpm, 3),
        det.value,
        det.direction,
        inten.value,
        inten.direction,
        num(ion.scores.total, 4),
        num(ion.q, 4),
      ]
      lines.push(cells.join(','))
      count++
    }
  }
  return { csv: lines.join('\r\n'), count }
}

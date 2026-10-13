/**
 * 注释库（被匹配的对象）：中性分子按分子式归组（同分子式的异构体作为同一分子的多个候选），按单同位素中性质量升序。
 *
 * 库模板（CSV，一行一个化合物）：
 *
 *   ID,Name,Formula,InChI,Mass
 *   HMDB0240254,Creatine riboside,C9H17N3O6,"InChI=1S/C9H17N3O6/...",263.1117353
 *
 *  - Formula：中性分子式（必需）
 *  - Mass：单同位素中性质量（Da）；缺失或无效时按分子式计算
 *  - ID / Name / InChI：可选；InChI 含逗号，按 CSV 规则用双引号包起来
 * 列名不区分大小写，也认几种常见写法（见下方别名表）。旧的「按加合物展开」格式
 * （formula, Ion type, Exp. m/z, Candidate_1..N）同样可读：同一分子式的多行合并，
 * 中性质量按分子式计算，不用其中的 m/z。
 *
 * 注释库由用户通过文件选择按钮提供，在浏览器本地（注释 worker 里）解析；网站不提供或分发
 * 注释库。最近选择的库 CSV 可由 dbStore 保存在当前浏览器中，见 useAnnotation。
 */

import { formulaMass } from '@/shared/chem/elements'
import type {
  AnnotationDb,
  AnnotationDbInfo,
  Candidate,
} from '@/features/vizworkbench/types/annotation'
import {
  csvLines,
  detectDelimiter,
  findColumn,
  normalizeHeader,
  parseNumberCell,
  splitCsvLine,
} from './csv'

export interface DbEntryInput {
  formula: string
  /** 单同位素中性质量；缺省或无效时按分子式计算 */
  mass?: number | null
  candidates?: Candidate[]
}

/** 按分子式合并、补算质量、按质量排序；分子式为空、质量也算不出的条目丢弃 */
export function buildAnnotationDb(
  meta: { id: string; label: string; version: string },
  entries: Iterable<DbEntryInput>,
): AnnotationDb {
  const byFormula = new Map<string, { mass: number; candidates: Candidate[]; seen: Set<string> }>()
  for (const e of entries) {
    const formula = e.formula.replace(/\s+/g, '')
    if (!formula) continue
    let acc = byFormula.get(formula)
    if (!acc) {
      const mass = e.mass != null && e.mass > 0 ? e.mass : formulaMass(formula)
      if (mass == null || !(mass > 0)) continue
      acc = { mass, candidates: [], seen: new Set() }
      byFormula.set(formula, acc)
    }
    for (const c of e.candidates ?? []) {
      // 有编号按编号去重，没有按名称
      const key = c.id || c.name
      if (key && !acc.seen.has(key)) {
        acc.seen.add(key)
        acc.candidates.push(c)
      }
    }
  }
  const rows = [...byFormula.entries()].sort((a, b) => a[1].mass - b[1].mass)
  return {
    ...meta,
    mass: Float64Array.from(rows, (r) => r[1].mass),
    formula: rows.map((r) => r[0]),
    candidates: rows.map((r) => r[1].candidates),
  }
}

const ID_ALIASES = ['id', 'hmdb id', 'hmdb_id', 'accession', 'compound id', 'compound_id']
const NAME_ALIASES = ['name', 'compound', 'compound name', 'candidate']
const FORMULA_ALIASES = ['formula', 'neutral formula', 'molecular formula']
const INCHI_ALIASES = ['inchi']
const MASS_ALIASES = [
  'mass',
  'monoisotopic mass',
  'monoisotopic_mass',
  'exact mass',
  'exact_mass',
  'neutral mass',
]

export type AnnotationDbCsvErrorCode = 'empty' | 'noFormulaColumn' | 'noRows'

/** 库 CSV 不可用。message 为英文（日志用），界面按 code 翻译 */
export class AnnotationDbCsvError extends Error {
  constructor(
    message: string,
    readonly code: AnnotationDbCsvErrorCode,
  ) {
    super(message)
    this.name = 'AnnotationDbCsvError'
  }
}

/** 无效的候选名（旧格式里的占位符） */
function isBlank(v: string): boolean {
  return !v || v === '-' || v.toLowerCase() === 'nan'
}

export function parseAnnotationDbCsv(
  text: string,
  meta: { id: string; label: string; version: string },
): AnnotationDb {
  const lines = csvLines(text)
  if (lines.length < 2) throw new AnnotationDbCsvError('Annotation database CSV is empty.', 'empty')
  const delimiter = detectDelimiter(lines[0]!)
  const headers = splitCsvLine(lines[0]!, delimiter)
  const formulaCol = findColumn(headers, FORMULA_ALIASES)
  if (formulaCol < 0) {
    throw new AnnotationDbCsvError(
      'Annotation database CSV has no formula column.',
      'noFormulaColumn',
    )
  }
  const idCol = findColumn(headers, ID_ALIASES)
  const nameCol = findColumn(headers, NAME_ALIASES)
  const inchiCol = findColumn(headers, INCHI_ALIASES)
  const massCol = findColumn(headers, MASS_ALIASES)
  // 旧格式：一行带 Candidate_1..N 多个候选名
  const numberedNameCols = headers
    .map((h, i) => ({ i, n: normalizeHeader(h).match(/^candidate[_\s-]*(\d+)$/)?.[1] }))
    .filter((c) => c.n != null)
    .sort((a, b) => Number(a.n) - Number(b.n))
    .map((c) => c.i)

  function* entries(): Generator<DbEntryInput> {
    for (let li = 1; li < lines.length; li++) {
      const f = splitCsvLine(lines[li]!, delimiter)
      const cell = (i: number) => (i >= 0 ? (f[i] ?? '') : '')
      const id = cell(idCol)
      const inchi = cell(inchiCol)
      const names = [nameCol, ...numberedNameCols].map(cell).filter((v) => !isBlank(v))
      // 只有编号、没有名称时用编号当名称，保证每个候选都有可显示的名字
      if (names.length === 0 && id) names.push(id)
      yield {
        formula: cell(formulaCol),
        mass: massCol >= 0 ? parseNumberCell(f[massCol]) : null,
        // 编号和 InChI 属于这一行的第一个名称；旧格式里其余候选名只有名称
        candidates: names.map((name, k) =>
          k === 0 ? { id, name, inchi } : { id: '', name, inchi: '' },
        ),
      }
    }
  }
  const db = buildAnnotationDb(meta, entries())
  if (db.formula.length === 0) {
    throw new AnnotationDbCsvError('Annotation database CSV has no usable formulas.', 'noRows')
  }
  return db
}

/** 用户选择的本地库 CSV：库名取文件名 */
export function parseUserDbCsv(fileName: string, text: string): AnnotationDb {
  return parseAnnotationDbCsv(text, { id: 'custom', label: fileName, version: '' })
}

export function dbInfoOf(db: AnnotationDb): AnnotationDbInfo {
  return { label: db.label, count: db.formula.length }
}

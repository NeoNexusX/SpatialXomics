/**
 * SI_DB 库 CSV（ID,Name,Formula,InChI,Mass,Origin）的纯解析。
 *
 * 复用 vizworkbench 注释库的 CSV 小工具（BOM / 分隔符 / 引号字段 / 表头别名）：
 * 那是同一文件族（用户上传的注释库就是 HMDB 导出）且已被线上验证。纯同步函数，
 * 便于单测；将来若要在 worker 里解析全量 39MB 文件，直接复用本函数即可。
 */
import {
  csvLines,
  detectDelimiter,
  findColumn,
  parseNumberCell,
  splitCsvLine,
} from '@/features/vizworkbench/utils/annotation/csv'

/** HMDB 行。用 type 别名（而非 interface），才能赋给 Record 形状的 DatabaseRow */
export type HmdbRow = {
  /** HMDB 编号，如 HMDB0240254 */
  id: string
  name: string
  formula: string
  inchi: string
  /** 单同位素中性质量；缺失 / 无效为 NaN */
  mass: number
  /** 化合物来源等级（endogenous / exogenous / expected / unknown），rank-annotation-db.mjs 标注 */
  origin: string
}

/** 表头别名，与注释库（annotationDb.ts）保持一致 */
const ID_ALIASES = ['id', 'hmdb id', 'hmdb_id', 'accession', 'compound id', 'compound_id']
const NAME_ALIASES = ['name', 'compound', 'compound name']
const FORMULA_ALIASES = ['formula', 'neutral formula', 'molecular formula']
const INCHI_ALIASES = ['inchi']
const MASS_ALIASES = ['mass', 'monoisotopic mass', 'monoisotopic_mass', 'exact mass', 'neutral mass']
const ORIGIN_ALIASES = ['origin']

export type HmdbCsvErrorCode = 'empty' | 'noIdColumn' | 'noRows'

/** 库 CSV 不可用。message 为英文（日志用），界面按 code 翻译 */
export class HmdbCsvError extends Error {
  constructor(
    message: string,
    readonly code: HmdbCsvErrorCode,
  ) {
    super(message)
    this.name = 'HmdbCsvError'
  }
}

export function parseHmdbCsv(text: string): HmdbRow[] {
  const lines = csvLines(text)
  if (lines.length < 2) throw new HmdbCsvError('HMDB CSV is empty.', 'empty')
  const delimiter = detectDelimiter(lines[0]!)
  const headers = splitCsvLine(lines[0]!, delimiter)
  const idCol = findColumn(headers, ID_ALIASES)
  if (idCol < 0) throw new HmdbCsvError('HMDB CSV has no id column.', 'noIdColumn')
  const nameCol = findColumn(headers, NAME_ALIASES)
  const formulaCol = findColumn(headers, FORMULA_ALIASES)
  const inchiCol = findColumn(headers, INCHI_ALIASES)
  const massCol = findColumn(headers, MASS_ALIASES)
  const originCol = findColumn(headers, ORIGIN_ALIASES)

  const rows: HmdbRow[] = []
  for (let li = 1; li < lines.length; li++) {
    const f = splitCsvLine(lines[li]!, delimiter)
    const cell = (i: number) => (i >= 0 ? (f[i] ?? '') : '')
    const id = cell(idCol).trim()
    const name = cell(nameCol).trim()
    // 编号与名称都为空的行（尾部空行、残缺行）没有展示价值，跳过
    if (!id && !name) continue
    rows.push({
      id,
      name,
      formula: cell(formulaCol).trim(),
      inchi: cell(inchiCol).trim(),
      mass: massCol >= 0 ? parseNumberCell(f[massCol]) : NaN,
      origin: cell(originCol).trim(),
    })
  }
  if (rows.length === 0) throw new HmdbCsvError('HMDB CSV has no usable rows.', 'noRows')
  return rows
}

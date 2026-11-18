/**
 * 溶剂复合串的最小单元：`数值 单位 组分名`，如 `50% Acetonitrile (ACN)`,
 * `1 mM Acetic acid`, `350 μM Ammonium fluoride`。整条溶剂串用 ", " 连接。
 *
 * 词表（SOLVENTS）只是组分名；单位是另一层信息：% 是组成比例（≤100），
 * mM/μM/mg/mL 是浓度。上传表单和数据集元信息弹窗共用这里的解析/格式化，
 * 注释分析也用它从条目里剥出组分名。
 */

/**
 * 可选单位。顺序即下拉顺序。
 * 不含 mg / μg：绝对质量不是组成单位，溶剂体系里必须带体积（mg/mL、μg/mL）
 * 才有意义。解析仍接受它们，只是为了正确读取历史数据里的自由文本。
 * 列表之外的写法由表单的 Other 自填，解析器按「数值 + 单位词 + 组分名」兜底。
 */
export const SOLVENT_UNITS = ['%', 'mM', 'μM', 'nM', 'M', 'mg/mL', 'μg/mL'] as const

export type SolventUnit = (typeof SOLVENT_UNITS)[number]

/** 历史数据里可能出现的绝对质量单位：解析兼容，但不再提供录入 */
const LEGACY_MASS_UNITS = ['mg', 'μg'] as const

/** 解析时接受的单位别名（历史数据里可能有 uM / µM 写法） */
const ACCEPTED_UNITS = ['%', 'mg/mL', 'μg/mL', 'µg/mL', 'mM', 'μM', 'µM', 'uM', 'nM', ...LEGACY_MASS_UNITS, 'µg', 'M']

// 长单位排在短单位前（mg/mL 必须先于 mg 匹配），M 必须最后：
// 否则 `mM` 会在 `M` 上提前命中，name 里留下多余的 m。
const UNIT_PATTERN = ACCEPTED_UNITS.join('|')

// 已知单位后必须跟空白或行尾，防止 `mg` 把自定义单位 `mg/kg` 截成 `mg` + `/kg …`
const ENTRY_RE = new RegExp(`^(\\d+(?:\\.\\d+)?|\\.\\d+)\\s*(${UNIT_PATTERN})(?=\\s|$)\\s+(.+)$`, 'u')

// 百分比与组分名之间允许无空格（历史写法 `50%Water`）
const PERCENT_TIGHT_RE = /^(\d+(?:\.\d+)?|\.\d+)\s*(%)\s*(.+)$/u

// 自填单位的兜底：数值后的第一个非空白词即单位（如 mg/kg、v/v、w/w）；
// 单位词必须含字母/µ/μ/%，避免把 `1:1 MeOH` 这类比例写法误认成单位。
const CUSTOM_ENTRY_RE = /^(\d+(?:\.\d+)?|\.\d+)\s*(?=\S*[A-Za-zµμ%])(\S+)\s+(.+)$/u

export interface SolventEntry {
  value: number
  /** 归一后的单位：uM/µM → μM，µg → μg；自定义单位原样保留 */
  unit: string
  name: string
}

function canonicalUnit(unit: string): string {
  switch (unit) {
    case 'uM':
    case 'µM':
      return 'μM'
    case 'µg':
      return 'μg'
    case 'µg/mL':
      return 'μg/mL'
    default:
      return unit
  }
}

/**
 * 解析单条溶剂条目。自由文本（如 `H2O/MeOH (1:1)`）没有「数值+单位」前缀，
 * 返回 null，调用方应按原文处理。单位与组分名之间允许无空格（`50%Water`）。
 */
export function parseSolventEntry(entry: string): SolventEntry | null {
  const trimmed = entry.trim()
  const m = ENTRY_RE.exec(trimmed) ?? PERCENT_TIGHT_RE.exec(trimmed) ?? CUSTOM_ENTRY_RE.exec(trimmed)
  if (!m) return null
  const name = (m[3] ?? '').trim()
  if (!name) return null
  return { value: Number(m[1]), unit: canonicalUnit(m[2] ?? ''), name }
}

/** 规范格式：`50% Water`、`1 mM Acetic acid`。百分比与数字之间不加空格。 */
export function formatSolventEntry(value: number, unit: string, name: string): string {
  const quantity = unit === '%' ? `${value}%` : `${value} ${unit}`
  return `${quantity} ${name.trim()}`
}

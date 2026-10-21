/**
 * 通用数据库浏览页（/database）的数据源契约。
 *
 * 页面本身不认识任何具体数据库：顶部 tab 遍历 sources/index.ts 的注册表，
 * 表格列、搜索提示、数据获取全部由 DatabaseSource 描述符驱动。新增一个数据库 =
 * 新建 source 文件并注册进数组，页面 / 表格 / 列表状态零改动。
 *
 * 行数据刻意宽松（键值均为 string | number）：各库在自己的 source 里定义精确的
 * 行类型，表格只按列定义渲染。文案一律用 `() => t('...')` 的函数形式而非 key
 * 字符串，t() 的 key 保持静态字面量，与 datasets/constants/vocabLabels.ts 的
 * 约定一致（可被类型检查与 ESLint 校验，切语言时随渲染刷新）。
 */

/** 行数据：键为列 key；各库的精确行类型需满足此形状 */
export type DatabaseRow = Record<string, string | number>

/** 列定义：表格由它驱动 */
export interface DatabaseColumn {
  /** 行数据里的字段名 */
  key: string
  /** 列头文字（函数形式保证切语言时刷新；内部 t() 的 key 必须是静态字面量） */
  label: () => string
  /** 等宽字体（编号 / 分子式 / InChI 这类机器可读文本） */
  mono?: boolean
  /** 单元格格式化，如质量 → toFixed(4)、无效值 '—'；缺省 String(value) */
  format?: (value: string | number) => string
  /** 列宽（colgroup 的 width，如 '20%'）；缺省各列均分 */
  width?: string
  /** 单元格文字过长时截断，旁边给一个复制按钮（名称 / InChI 用） */
  copyable?: boolean
  /** 外链列：由行数据算出条目页 URL，新窗口打开；返回 null 显示 '—'（HMDB 条目页用） */
  link?: (row: DatabaseRow) => string | null
  /** PubChem 检索列：点击按钮用该行这个字段的值（如 'name'）打开 PubChemDialog */
  pubchemField?: string
}

export interface DatabaseListParams {
  /** 关键词；语义由各 fetcher 自定（SI_DB 会把它映射到编号/名称/分子式之一，见 api/siDb.ts） */
  keyword?: string
  /** 额外筛选控件的当前值；键与 filterControls 的 key 对应，语义由 fetcher 解释 */
  filters?: DatabaseFilterValues
  /** 1 基页码 */
  page: number
  size: number
}

/** 数值区间值（如质量范围）；min/max 可只填一边 */
export interface DatabaseRangeValue {
  min?: number
  max?: number
}

/** 额外筛选控件的当前值：select 为单值，number-range 为区间 */
export type DatabaseFilterValue = string | DatabaseRangeValue
export type DatabaseFilterValues = Record<string, DatabaseFilterValue>

/** select 控件选项（origin 这类词表：值固定写死、文案走 i18n） */
export interface DatabaseSelectOption {
  value: string
  label: () => string
}

/** select 控件：离散词表（如 origin），即选即搜 */
export interface DatabaseSelectControl {
  kind: 'select'
  /** 筛选值在 DatabaseFilterValues 里的键 */
  key: string
  /** 无障碍标签 */
  label: () => string
  /** 重置项（不筛选）的占位文字 */
  allLabel: () => string
  options: DatabaseSelectOption[]
}

/** number-range 控件：数值区间（如质量），可只填一边，随「搜索」提交 */
export interface DatabaseRangeControl {
  kind: 'number-range'
  key: string
  label: () => string
  minPlaceholder: () => string
  maxPlaceholder: () => string
}

/** 工具栏上关键词之外的筛选控件 */
export type DatabaseFilterControl = DatabaseSelectControl | DatabaseRangeControl

/** 分页信封的 meta，与 datasetApi / userAdminApi 的服务端分页响应一致 */
export interface DatabasePageMeta {
  current_page: number
  total_pages: number
  total_records: number
  /** SI_DB 等新接口额外回传的本页行数（旧接口没有，可缺省） */
  current_records?: number
}

/** 整库下载入口（如 SI_DB 的全量 CSV）。成功提示由 run 自理；失败抛本地化 Error，由调用方 toast */
export interface DatabaseDownloadAction {
  label: () => string
  run: () => Promise<void>
}

/**
 * 注释面板「从平台库导入」入口：拉整库 CSV 文本。与 download（交给浏览器下载）
 * 不同，这里要读内容，走 fetch + 同源代理（见 api/siDbApi.ts 的 fetchSiDbCsv）。
 */
export interface DatabaseCsvImport {
  /**
   * 下载整库 CSV 文本；onProgress 回报累计已下载字节数与总字节数（未知为 0），
   * 供导入按钮显示下载百分比。失败抛原始错误，由调用方换一句话文案提示。
   */
  fetch: (onProgress?: (loaded: number, total: number) => void) => Promise<{ fileName: string; text: string }>
}

export interface DatabaseListResult {
  data: DatabaseRow[]
  meta: DatabasePageMeta
}

/** 数据源描述符：注册进 DATABASE_SOURCES 即出现在页面 tab 中 */
export interface DatabaseSource {
  /** tab 标识（须在注册表内唯一） */
  id: string
  /** tab 文字 */
  label: () => string
  /** 搜索框 placeholder */
  searchPlaceholder: () => string
  /** 工具栏角落的数据来源提示；可省略 */
  note?: () => string
  /** 用哪一列的值当行 key（须唯一）；缺省用第一列 */
  rowKey?: string
  columns: DatabaseColumn[]
  /** 工具栏的额外筛选控件；缺省则只有关键词搜索 */
  filterControls?: DatabaseFilterControl[]
  /** 整库下载按钮；缺省不渲染 */
  download?: DatabaseDownloadAction
  /** 注释面板「从平台库导入」可用的库；缺省不出现在注释导入菜单 */
  csvImport?: DatabaseCsvImport
  fetcher: DatabaseFetcher
}

/**
 * 分页数据获取契约。
 *
 * SI_DB 已有完整实现：api/siDb.ts 的 listSiDbPage——走后端 POST /annotations/
 * si-db/list（契约见后端 Swagger /docs 搜 annotation），服务不可用时上抛一句话
 * 本地化错误、由页面的错误态 + 重试承接。新数据库只需实现本契约并注册进
 * sources/index.ts。
 */
export type DatabaseFetcher = (params: DatabaseListParams) => Promise<DatabaseListResult>

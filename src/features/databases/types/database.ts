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
  /** 长文本列：单元格截断显示，行尾按钮展开全文 + 复制（InChI 用） */
  expandable?: boolean
}

export interface DatabaseListParams {
  /** 关键词；语义由各 fetcher 自定（HMDB 为 ID/名称/分子式上的不区分大小写子串） */
  keyword?: string
  /** 1 基页码 */
  page: number
  size: number
}

/** 分页信封的 meta，与 datasetApi / userAdminApi 的服务端分页响应一致 */
export interface DatabasePageMeta {
  current_page: number
  total_pages: number
  total_records: number
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
  fetcher: DatabaseFetcher
}

/**
 * 分页数据获取契约。
 *
 * HMDB 的当前实现是过渡期的本地 CSV 适配器（api/hmdbCsv.ts 的 listHmdbFromCsv：
 * fetch 静态样本 CSV → 内存分页 / 关键词搜索）。后端就绪后按下面契约提供端点，
 * 新增一个 fetcher 实现并在 source 里替换即可，页面层零改动：
 *
 *   GET /api/databases/hmdb?page={page}&size={size}&keyword={keyword}（公开免登录）
 *   200 → { data: [ ...rows ],
 *           meta: { current_page, total_pages, total_records } }
 *
 * FastAPI / snake_case 字段、错误体 { detail }（httpClient 的 error_catch 已统一
 * 解析），与 datasetApi / userAdminApi 的分页信封一致。
 */
export type DatabaseFetcher = (params: DatabaseListParams) => Promise<DatabaseListResult>

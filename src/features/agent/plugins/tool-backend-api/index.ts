/**
 * 后端 API 只读工具集：复用现有 datasetApi / quotaApi 封装（走 auth_api JWT）。
 *
 * 结果 JSON 摘要化后由 ToolRuntime 统一截断到 TOOL_RESULT_CHARS。
 * axios 错误（含 401 未登录）转 isError:true 结果回喂模型，不中断 turn。
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '../tools'
import {
  listFiles,
  listUserFiles,
  getFileMetadata,
  listMyProcesses,
} from '@/features/datasets/api/datasetApi'
import { getUserQuota } from '@/shared/api/quotaApi'

/** 列表响应的统一形态：表头（总数、页码）+ 前 20 行。后端返回 { data: [...], meta: {...} } */
function summarizeList(body: any, line: (item: any) => (string | false | undefined)[]): string {
  const items: any[] = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : []
  const meta = body?.meta
  const lines = items.slice(0, 20).map((item) => `- ${line(item).filter(Boolean).join(' | ')}`)
  const total = meta?.total_records ?? items.length
  return `total: ${total}${meta ? ` | page: ${meta.current_page} / ${meta.total_pages}` : ''}\n${lines.join('\n') || '(empty)'}`
}

const fileLine = (f: any) => [
  `public_id=${f.public_id ?? f.id}`,
  f.filename ?? f.name,
  f.size != null && `${(Number(f.size) / 1024 / 1024).toFixed(1)}MB`,
  (f.uploaded_at || f.created_at) && String(f.uploaded_at ?? f.created_at).slice(0, 10),
  f.status,
]

const processLine = (p: any) => [
  `#${p.id ?? p.run_id}`,
  p.type ?? p.algorithm,
  p.status,
  p.created_at && String(p.created_at).slice(0, 16),
]

/** 对象摘要化：只保留一层字段 */
function summarizeFields(body: any, maxFields: number, maxChars: number): string {
  if (!body || typeof body !== 'object') return String(body)
  return Object.entries(body)
    .slice(0, maxFields)
    .map(
      ([k, v]) =>
        `- ${k}: ${typeof v === 'object' ? JSON.stringify(v).slice(0, maxChars) : String(v).slice(0, maxChars)}`,
    )
    .join('\n')
}

/** axios 错误信息提取 */
function axiosErrorMessage(err: any): string {
  const status = err?.response?.status
  const detail = err?.response?.data?.detail ?? err?.response?.data?.message ?? err?.message
  return status ? `HTTP ${status}: ${detail}` : String(detail ?? err)
}

/** 错误转成模型能读的文本，抛给 ToolRuntime 变成 isError 结果 */
async function request<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (err) {
    throw new Error(axiosErrorMessage(err))
  }
}

const pageParameters = {
  page: { type: 'integer', description: 'Page number starting at 1, default 1.' },
  size: { type: 'integer', description: 'Page size, default 10, clamped 1–20.' },
} as const

const pageOf = (args: { page?: number; size?: number }) => ({
  page: Math.max(args.page ?? 1, 1),
  size: Math.min(Math.max(args.size ?? 10, 1), 20),
})

/** 未登录时 auth_api 请求会 401，工具层转为 isError 结果，模型据此提示用户登录。 */
export const name = 'tool-backend-api'
export const inject = ['tools']

export function apply(ctx: Context) {
  /**
   * list_files —— 平台公开数据集列表（分页、只读）。
   *
   * 作用：浏览公开数据。摘要形态：total | page 表头 + 前 20 行（public_id、文件名、
   * 大小、日期、状态）。复用 datasetApi 的 listFiles（走 auth_api JWT）。
   *
   * 参数：
   * - page (integer, 可选)：页码，默认 1
   * - size (integer, 可选)：页大小，默认 10、cap 20
   */
  ctx.tools.register(
    defineTool({
      category: 'files',
      name: 'list_files',
      description:
        'Browse publicly available datasets on the platform. Returns a paginated summary of file ' +
        'identifiers, names, sizes, dates and statuses; advance with page. Read-only; this lists ' +
        'entries, not file contents.',
      parameters: pageParameters,
      async execute(args, exec) {
        const { page, size } = pageOf(args)
        const body = await request(() => listFiles({}, page, size, true, undefined, exec.signal))
        return summarizeList(body, fileLine)
      },
    }),
  )

  /**
   * list_my_files —— 当前用户已上传的数据集列表（需登录）。
   *
   * 作用：用户询问自己的文件时用。摘要形态同 list_files；未登录时 auth_api 401 转
   * isError 结果，模型据此提示用户登录。
   *
   * 参数：
   * - page (integer, 可选)：页码，默认 1
   * - size (integer, 可选)：页大小，默认 10、cap 20
   */
  ctx.tools.register(
    defineTool({
      category: 'files',
      name: 'list_my_files',
      description:
        'List datasets uploaded by the signed-in user. Returns paginated file summaries; follow up ' +
        'with get_file_metadata using a returned public_id. Requires login — treat authorization ' +
        'errors as a sign-in issue, not as an empty list.',
      parameters: pageParameters,
      async execute(args, exec) {
        const { page, size } = pageOf(args)
        const body = await request(() => listUserFiles({}, page, size, undefined, exec.signal))
        return summarizeList(body, fileLine)
      },
    }),
  )

  /**
   * get_file_metadata —— 按 public_id 取单个数据集元数据（需登录）。
   *
   * 作用：仪器、样本、上传信息等一层字段摘要（≤30 字段、每字段值 ≤120 字符）。
   * 在 list_files / list_my_files 之后检视某个文件时用。
   *
   * 参数：
   * - fileId (string, 必填)：文件列表中的 public_id，字符串原样保留（含前导零）
   */
  ctx.tools.register(
    defineTool({
      category: 'files',
      name: 'get_file_metadata',
      description:
        'Retrieve metadata for one dataset by its exact public_id from a file list: a bounded ' +
        'single-level field summary of instrument, sample and upload information. Requires login; ' +
        'pass public_id as a string, preserving leading zeros.',
      parameters: {
        fileId: {
          type: 'string',
          required: true,
          description:
            'Exact public_id from the file list; keep it a string including leading zeros.',
        },
      },
      async execute(args, exec) {
        const body = await request(() => getFileMetadata(args.fileId!, exec.signal))
        return summarizeFields(body, 30, 120) || '(empty metadata)'
      },
    }),
  )

  /**
   * list_my_processes —— 当前用户分析任务/进程列表及状态（需登录）。
   *
   * 作用：用户询问自己的分析任务时用。行摘要：#id、类型/算法、状态、创建时间。
   *
   * 参数：
   * - page (integer, 可选)：页码，默认 1
   * - size (integer, 可选)：页大小，默认 10、cap 20
   */
  ctx.tools.register(
    defineTool({
      category: 'files',
      name: 'list_my_processes',
      description:
        "List the signed-in user's analysis processes with status. Returns a paginated summary of " +
        'process id, type/algorithm, status and creation time. Requires login; does not include full ' +
        'task inputs or result files.',
      parameters: pageParameters,
      async execute(args, exec) {
        const { page, size } = pageOf(args)
        const body = await request(() => listMyProcesses(page, size, {}, exec.signal))
        return summarizeList(body, processLine)
      },
    }),
  )

  /**
   * get_user_quota —— 当前用户存储与处理配额用量（需登录）。
   *
   * 作用：一层字段摘要（≤20 字段、每字段值 ≤100 字符）。未登录时同上转 isError。
   *
   * 参数：无
   */
  ctx.tools.register(
    defineTool({
      category: 'files',
      name: 'get_user_quota',
      description:
        "Retrieve the signed-in user's storage and processing quota usage as a bounded field " +
        'summary. Requires login; this only reads quota information — it does not request or change ' +
        'quota.',
      parameters: {},
      async execute(_args, exec) {
        const body = await request(() => getUserQuota(exec.signal))
        return summarizeFields(body, 20, 100)
      },
    }),
  )
}

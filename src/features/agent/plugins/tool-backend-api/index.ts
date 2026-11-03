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
  page: { type: 'integer', description: 'Page number (default 1)' },
  size: { type: 'integer', description: 'Page size (default 10, max 20)' },
} as const

const pageOf = (args: { page?: number; size?: number }) => ({
  page: Math.max(args.page ?? 1, 1),
  size: Math.min(Math.max(args.size ?? 10, 1), 20),
})

/** 未登录时 auth_api 请求会 401，工具层转为 isError 结果，模型据此提示用户登录。 */
export const name = 'tool-backend-api'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(
    defineTool({
      category: 'files',
      name: 'list_files',
      description:
        'List publicly available datasets on the platform (paginated, read-only). Use for browsing public data.',
      parameters: pageParameters,
      async execute(args, exec) {
        const { page, size } = pageOf(args)
        const body = await request(() => listFiles({}, page, size, true, undefined, exec.signal))
        return summarizeList(body, fileLine)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      category: 'files',
      name: 'list_my_files',
      description:
        'List the current user uploaded datasets (requires login). Use when the user asks about their own files.',
      parameters: pageParameters,
      async execute(args, exec) {
        const { page, size } = pageOf(args)
        const body = await request(() => listUserFiles({}, page, size, undefined, exec.signal))
        return summarizeList(body, fileLine)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      category: 'files',
      name: 'get_file_metadata',
      description:
        'Get metadata of a dataset by public_id (instrument, sample, upload info; requires login). Use after list_files / list_my_files to inspect one file.',
      parameters: {
        fileId: {
          type: 'string',
          required: true,
          description:
            'Exact public_id from the file list; preserve the string, including leading zeros',
        },
      },
      async execute(args, exec) {
        const body = await request(() => getFileMetadata(args.fileId!, exec.signal))
        return summarizeFields(body, 30, 120) || '(empty metadata)'
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      category: 'files',
      name: 'list_my_processes',
      description:
        'List the current user analysis tasks / processes with status (requires login). Use when the user asks about their analyses.',
      parameters: pageParameters,
      async execute(args, exec) {
        const { page, size } = pageOf(args)
        const body = await request(() => listMyProcesses(page, size, {}, exec.signal))
        return summarizeList(body, processLine)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      category: 'files',
      name: 'get_user_quota',
      description: 'Get the current user storage and processing quota usage (requires login).',
      parameters: {},
      async execute(_args, exec) {
        const body = await request(() => getUserQuota(exec.signal))
        return summarizeFields(body, 20, 100)
      },
    }),
  )
}

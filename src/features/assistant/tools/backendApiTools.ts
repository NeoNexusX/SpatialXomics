/**
 * 后端 API 只读工具集：复用现有 datasetApi / quotaApi 封装（走 auth_api JWT）。
 *
 * 结果 JSON 摘要化后由 ToolRuntime 统一截断到 TOOL_RESULT_CHARS。
 * axios 错误（含 401 未登录）转 isError:true 结果回喂模型，不中断 turn。
 */

import type { Context, Plugin } from '@deepseek-ai/cordis'
import { defineTool } from './defineTool'
import {
  listFiles,
  listUserFiles,
  getFileMetadata,
  listMyProcesses,
} from '@/features/datasets/api/datasetApi'
import { getUserQuota } from '@/shared/api/quotaApi'

/** 列表项摘要化：只保留模型需要的字段 */
function summarizeFileList(body: any): string {
  // 后端返回 { data: [...], meta: {...} }
  const items: any[] = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : []
  const meta = body?.meta
  const lines = items.slice(0, 20).map((f: any) => {
    const parts = [`#${f.id}`]
    if (f.filename || f.name) parts.push(f.filename ?? f.name)
    if (f.size != null) parts.push(`${(Number(f.size) / 1024 / 1024).toFixed(1)}MB`)
    if (f.created_at) parts.push(String(f.created_at).slice(0, 10))
    if (f.status) parts.push(f.status)
    return `- ${parts.join(' | ')}`
  })
  const total = meta?.total_records ?? items.length
  return `total: ${total}\n${lines.join('\n') || '(empty)'}`
}

function summarizeProcessList(body: any): string {
  const items: any[] = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : []
  const meta = body?.meta
  const lines = items.slice(0, 20).map((p: any) => {
    const parts = [`#${p.id ?? p.run_id}`]
    if (p.type ?? p.algorithm) parts.push(p.type ?? p.algorithm)
    if (p.status) parts.push(p.status)
    if (p.created_at) parts.push(String(p.created_at).slice(0, 16))
    return `- ${parts.join(' | ')}`
  })
  const total = meta?.total_records ?? items.length
  return `total: ${total}\n${lines.join('\n') || '(empty)'}`
}

function summarizeMetadata(body: any): string {
  if (!body || typeof body !== 'object') return String(body)
  // 摘要化：只保留一层字段
  const lines = Object.entries(body)
    .slice(0, 30)
    .map(([k, v]) => `- ${k}: ${typeof v === 'object' ? JSON.stringify(v).slice(0, 120) : String(v).slice(0, 120)}`)
  return lines.join('\n') || '(empty metadata)'
}

function summarizeQuota(body: any): string {
  if (!body || typeof body !== 'object') return String(body)
  return Object.entries(body)
    .slice(0, 20)
    .map(([k, v]) => `- ${k}: ${typeof v === 'object' ? JSON.stringify(v).slice(0, 100) : String(v)}`)
    .join('\n')
}

/** axios 错误信息提取 */
function axiosErrorMessage(err: any): string {
  const status = err?.response?.status
  const detail = err?.response?.data?.detail ?? err?.response?.data?.message ?? err?.message
  return status ? `HTTP ${status}: ${detail}` : String(detail ?? err)
}

/**
 * 后端 API 工具插件。
 *
 * 在 bootstrap 中：ctx.plugin(backendApiTools)
 * 注意：未登录时 auth_api 请求会 401，工具层转为 isError 结果，模型据此提示用户登录。
 */
export const backendApiTools: Plugin.Function<void> = (ctx: Context) => {
  ctx.tools.register(
    defineTool({
      category: 'files',
      name: 'list_files',
      description:
        'List publicly available datasets on the platform (paginated, read-only). Use for browsing public data.',
      parameters: {
        page: { type: 'integer', description: 'Page number (default 1)' },
        size: { type: 'integer', description: 'Page size (default 10, max 20)' },
      },
      async execute(args) {
        try {
          const page = Math.max(args.page ?? 1, 1)
          const size = Math.min(Math.max(args.size ?? 10, 1), 20)
          const body = await listFiles({}, page, size, true)
          return summarizeFileList(body)
        } catch (err) {
          throw new Error(axiosErrorMessage(err))
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      category: 'files',
      name: 'list_my_files',
      description:
        'List the current user uploaded datasets (requires login). Use when the user asks about their own files.',
      parameters: {
        page: { type: 'integer', description: 'Page number (default 1)' },
        size: { type: 'integer', description: 'Page size (default 10, max 20)' },
      },
      async execute(args) {
        try {
          const page = Math.max(args.page ?? 1, 1)
          const size = Math.min(Math.max(args.size ?? 10, 1), 20)
          const body = await listUserFiles({}, page, size)
          return summarizeFileList(body)
        } catch (err) {
          throw new Error(axiosErrorMessage(err))
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      category: 'files',
      name: 'get_file_metadata',
      description:
        'Get metadata of a dataset by file id (instrument, sample, upload info). Use after list_files / list_my_files to inspect one file.',
      parameters: {
        fileId: { type: 'string', required: true, description: 'Numeric file id' },
      },
      async execute(args) {
        try {
          const body = await getFileMetadata(args.fileId!)
          return summarizeMetadata(body)
        } catch (err) {
          throw new Error(axiosErrorMessage(err))
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      category: 'files',
      name: 'list_my_processes',
      description:
        'List the current user analysis tasks / processes with status (requires login). Use when the user asks about their analyses.',
      parameters: {
        page: { type: 'integer', description: 'Page number (default 1)' },
        size: { type: 'integer', description: 'Page size (default 10, max 20)' },
      },
      async execute(args) {
        try {
          const page = Math.max(args.page ?? 1, 1)
          const size = Math.min(Math.max(args.size ?? 10, 1), 20)
          const body = await listMyProcesses(page, size)
          return summarizeProcessList(body)
        } catch (err) {
          throw new Error(axiosErrorMessage(err))
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      category: 'files',
      name: 'get_user_quota',
      description:
        'Get the current user storage and processing quota usage (requires login).',
      parameters: {},
      async execute() {
        try {
          const body = await getUserQuota()
          return summarizeQuota(body)
        } catch (err) {
          throw new Error(axiosErrorMessage(err))
        }
      },
    }),
  )
}

// cordis 4：fiber 内访问兄弟服务（ctx.tools）必须声明 inject，
// 否则 fiber 静默失败、工具一个都注册不上（机制同 agentLoopProvider 的 ctx.inject 包裹）。
backendApiTools.inject = ['tools']

/**
 * API 模块统一用这里的函数处理响应：调用方拿到的总是后端返回的数据本身，
 * 列表总是 { data, meta }。只有需要响应头或状态码时才直接读 axios 响应。
 */

/** 服务端分页接口的 meta */
export interface PageMeta {
  current_page: number
  total_pages: number
  total_records: number
}

export interface Page<T> {
  data: T[]
  meta: PageMeta
}

/** 取出 axios 响应体 */
export function unwrap<T>(request: Promise<{ data: T }>): Promise<T> {
  return request.then((res) => res.data)
}

/**
 * 把列表接口的返回统一成 { data, meta }。多数接口返回 { data, meta }，
 * 少数返回纯数组或 { items }；缺 meta 时按只有一页处理。
 */
export function toPage<T>(body: unknown): Page<T> {
  const raw = (body ?? {}) as { data?: unknown; items?: unknown; meta?: Partial<PageMeta> }
  const data = ([body, raw.data, raw.items].find(Array.isArray) ?? []) as T[]
  const meta = raw.meta ?? {}
  return {
    data,
    meta: {
      current_page: meta.current_page || 1,
      total_pages: meta.total_pages || 1,
      total_records: meta.total_records ?? data.length,
    },
  }
}

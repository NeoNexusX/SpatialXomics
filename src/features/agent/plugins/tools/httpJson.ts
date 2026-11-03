/**
 * 知识源工具共享的 fetch 基建：
 * - getJson：在线 API 的 JSON fetch + 可读错误（含 CORS 提示）；
 * - createLazyJsonLoader：同源离线索引（public/data/）的懒加载器工厂。
 *
 * 供知识库、文献、生物信息等工具复用。
 * 约定：无 key、只读；网络/上游错误抛 Error → ToolRuntime 转 isError
 * 结果回喂模型，不中断 turn。
 */

import { abortable } from '../llm'

/** fetch + JSON + 可读错误（含 CORS 提示） */
export async function getJson(url: string, init?: RequestInit): Promise<any> {
  init?.signal?.throwIfAborted()
  let res: Response
  try {
    const headers = new Headers(init?.headers)
    if (!headers.has('Accept')) headers.set('Accept', 'application/json')
    res = await fetch(url, { ...init, headers })
  } catch (err) {
    init?.signal?.throwIfAborted()
    throw new Error(
      `Cannot reach the external database (network/CORS): ${(err as Error)?.message || 'network error'}`,
    )
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // PubChem/知识库 404 常见语义：查无此条目
    if (res.status === 404) throw new Error('Not found in database (HTTP 404)')
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

/**
 * 同源离线索引的懒加载器工厂（public/data/ 下的静态 JSON：LIPID MAPS /
 * HMDB / KEGG 索引共用此模式，别再手写第四份）。
 *
 * - 模块级单次缓存：返回的函数反复调用共享同一个 Promise；
 * - 失败重置：加载失败（网络/404/中止）后清缓存，下次调用可重试；
 * - 并发调用共享下载，但每位调用者可独立取消等待；最后一位取消时中止下载。
 */
export function createLazyJsonLoader<T>(
  file: string,
  notFoundMessage: (status: number) => string,
): (signal?: AbortSignal) => Promise<T> {
  let cached: { value: T } | undefined
  type Pending = { promise: Promise<T>; controller: AbortController; users: number }
  let pending: Pending | undefined
  return async (signal?: AbortSignal) => {
    signal?.throwIfAborted()
    if (cached) return cached.value
    if (!pending) {
      const controller = new AbortController()
      const request: Pending = {
        controller,
        users: 0,
        promise: Promise.resolve(undefined as T),
      }
      request.promise = fetch(`${import.meta.env.BASE_URL}data/${file}`, {
        signal: controller.signal,
      })
        .then((r) => {
          if (!r.ok) throw new Error(notFoundMessage(r.status))
          return r.json().catch(() => {
            controller.signal.throwIfAborted()
            throw new Error(
              `Invalid JSON index data/${file}; check that the index is deployed and is not served as an HTML fallback`,
            )
          }) as Promise<T>
        })
        .then((value) => {
          controller.signal.throwIfAborted()
          cached = { value }
          return value
        })
        .finally(() => {
          if (pending === request) pending = undefined
        })
      // A caller can cancel before abortable() attaches its observer in a microtask.
      // The shared download still needs a rejection observer in that case.
      void request.promise.catch(() => {})
      pending = request
    }
    const request = pending
    request.users++
    try {
      return await (signal ? abortable(() => request.promise, signal) : request.promise)
    } finally {
      if (--request.users === 0 && pending === request) {
        pending = undefined
        request.controller.abort()
      }
    }
  }
}

/** 列表去空 + 截断 */
export function take(list: unknown[], n: number): unknown[] {
  return Array.isArray(list) ? list.filter((x) => x != null && x !== '').slice(0, n) : []
}

/** 安全截断字符串（摘要用） */
export function excerpt(s: unknown, max = 600): string {
  const str = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : ''
  return str.length > max ? `${str.slice(0, max)}…` : str
}

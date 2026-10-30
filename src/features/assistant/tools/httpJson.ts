/**
 * 知识源工具共享的 fetch 基建：
 * - getJson：在线 API 的 JSON fetch + 可读错误（含 CORS 提示）；
 * - createLazyJsonLoader：同源离线索引（public/data/）的懒加载器工厂。
 *
 * 从 knowledgeTools.ts 抽出，供文献/生物信息/谱库等工具复用。
 * 约定：无 key、只读；网络/上游错误抛 Error → ToolRuntime 转 isError
 * 结果回喂模型，不中断 turn。
 */

/** fetch + JSON + 可读错误（含 CORS 提示） */
export async function getJson(url: string, init?: RequestInit): Promise<any> {
  let res: Response
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, ...init })
  } catch (err) {
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
 * - signal 只影响「发起中的那次 fetch」：缓存命中时忽略（中止后重试即
 *   重建）；已完成的缓存对后续调用恒可用。
 */
export function createLazyJsonLoader<T>(
  file: string,
  notFoundMessage: (status: number) => string,
): (signal?: AbortSignal) => Promise<T> {
  let cached: Promise<T> | null = null
  return (signal?: AbortSignal) => {
    cached ??= fetch(`${import.meta.env.BASE_URL}data/${file}`, { signal })
      .then((r) => {
        if (!r.ok) throw new Error(notFoundMessage(r.status))
        return r.json() as Promise<T>
      })
      .catch((err: unknown) => {
        cached = null
        throw err
      })
    return cached
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

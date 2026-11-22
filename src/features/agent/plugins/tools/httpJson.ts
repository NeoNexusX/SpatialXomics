/**
 * 知识源工具共享的 fetch 基建：
 * - getJson：在线 API 的 JSON fetch + 可读错误（含 CORS 提示）。
 * - getText：同上但返回文本（XML/纯文本端点，如 PubMed efetch）。
 *
 * 供知识库、文献、生物信息等工具复用。
 * 约定：无 key、只读；网络/上游错误抛 Error → ToolRuntime 转 isError
 * 结果回喂模型，不中断 turn。
 */

/** fetch + 状态检查 + 可读错误（含 CORS 提示），JSON 与文本端点共用 */
async function fetchChecked(url: string, accept: string, init?: RequestInit): Promise<Response> {
  init?.signal?.throwIfAborted()
  let res: Response
  try {
    const headers = new Headers(init?.headers)
    if (!headers.has('Accept')) headers.set('Accept', accept)
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
  return res
}

/** fetch + JSON + 可读错误（含 CORS 提示） */
export async function getJson(url: string, init?: RequestInit): Promise<any> {
  return (await fetchChecked(url, 'application/json', init)).json()
}

/** fetch + 文本 + 可读错误；用于返回 XML 或纯文本的上游端点 */
export async function getText(url: string, init?: RequestInit): Promise<string> {
  return (await fetchChecked(url, 'text/plain, application/xml, text/xml', init)).text()
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

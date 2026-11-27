/**
 * zarr 对象的 HTTP 读取（CDN 公共读，无签名、无凭据）。
 *
 * GET /processes/{run_id}/zarr 返回 zarr 根目录的 CDN URL（尾带 /），对象地址 =
 * 根 URL + zarr 内相对路径（zarr.json、chunk key……）。ZarrStore 与
 * ClusteringZarrStore 的所有读取都只经过 getObjectArrayBuffer 这一个出口。
 *
 * - 不带 cookie、不加自定义请求头：属于 CORS 简单请求，不触发 OPTIONS 预检，
 *   CDN 只需返回 Access-Control-Allow-Origin
 * - 404 → not_found：稀疏 chunk、可选数组、尚未聚类，由上层回退；
 *   403 → forbidden，绝不能当 404 处理，否则读不到的 chunk 会被静默填成 fill_value
 * - 超时 / 限流 / 5xx / 网络错误重试两次（指数退避），其余 4xx 不重试
 * - zarr.json 是元数据：聚类后会新增、根节点可能被改写，用 no-cache 每次回验
 *   （未变化时 304）；chunk 写完不再修改，走浏览器默认 HTTP 缓存
 */

export class ZarrFetchError extends Error {
  code: 'not_found' | 'forbidden' | 'network' | 'http'
  url: string
  status?: number

  constructor(code: ZarrFetchError['code'], message: string, url: string, status?: number) {
    super(message)
    this.name = 'ZarrFetchError'
    this.code = code
    this.url = url
    this.status = status
  }
}

export interface ZarrObjectSource {
  /** relativePath 相对 zarr 根目录，如 'zarr.json'、'ion_image/intensity/c/0' */
  getObjectArrayBuffer(relativePath: string): Promise<ArrayBuffer>
}

const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504])
const MAX_RETRIES = 2
const RETRY_BASE_MS = 300

function sleep(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * 2 ** attempt))
}

export function createZarrHttpClient(zarrUrl: string): ZarrObjectSource {
  if (!zarrUrl) throw new Error('[zarrHttpClient] zarrUrl is required')
  const root = zarrUrl.endsWith('/') ? zarrUrl : `${zarrUrl}/`

  async function getObjectArrayBuffer(relativePath: string): Promise<ArrayBuffer> {
    if (!relativePath) throw new Error('[zarrHttpClient] relativePath is required')
    const url = root + relativePath.replace(/^\/+/, '')
    const cache: RequestCache = url.endsWith('zarr.json') ? 'no-cache' : 'default'

    for (let attempt = 0; ; attempt++) {
      const canRetry = attempt < MAX_RETRIES
      let res: Response
      try {
        res = await fetch(url, { credentials: 'omit', cache })
        if (res.ok) return await res.arrayBuffer()
      } catch {
        // 浏览器里 CORS 被拒和断网都只给一个 TypeError，两者区分不了
        if (canRetry) {
          await sleep(attempt)
          continue
        }
        throw new ZarrFetchError('network', `[zarrHttpClient] network/CORS error: ${url}`, url)
      }

      res.body?.cancel().catch(() => {})
      if (res.status === 404) {
        throw new ZarrFetchError('not_found', `[zarrHttpClient] object not found: ${url}`, url, 404)
      }
      if (res.status === 403) {
        throw new ZarrFetchError('forbidden', `[zarrHttpClient] access forbidden: ${url}`, url, 403)
      }
      if (canRetry && RETRY_STATUS.has(res.status)) {
        await sleep(attempt)
        continue
      }
      throw new ZarrFetchError(
        'http',
        `[zarrHttpClient] HTTP ${res.status}: ${url}`,
        url,
        res.status,
      )
    }
  }

  return { getObjectArrayBuffer }
}

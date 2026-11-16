/**
 * Alibaba Cloud OSS client wrapper (browser-side + STS temporary credentials).
 *
 * Key points:
 * - Initialized with an STS token; defaults to secure: true
 * - Exposes a single `getObjectArrayBuffer(key)` that all zarr reads go through
 * - Normalizes CORS / 403 / 404 / token-expired errors so the UI layer can
 *   switch on a single `.code` field
 * - Never prints token cleartext
 */

import type OSS from 'ali-oss'
import type { ZarrAccessResponse } from './types/zarr'

/** Unified error type; the UI layer switches on `.code` to render a hint. */
export class OssError extends Error {
  code: 'cors' | 'forbidden' | 'not_found' | 'token_expired' | 'unknown'
  status?: number
  objectKey: string

  constructor(
    code: OssError['code'],
    message: string,
    objectKey: string,
    status?: number,
  ) {
    super(message)
    this.name = 'OssError'
    this.code = code
    this.objectKey = objectKey
    this.status = status
  }
}

export interface OssClient {
  getObjectArrayBuffer(key: string): Promise<ArrayBuffer>
}

/** Object key of a path inside a zarr folder. */
export function ossKey(folder: string, relativePath: string): string {
  const rel = relativePath.replace(/^\/+/, '')
  if (!folder) return rel
  return folder.endsWith('/') ? `${folder}${rel}` : `${folder}/${rel}`
}

function classifyError(err: unknown, objectKey: string): OssError {
  const anyErr = err as {
    code?: string | number
    status?: number
    message?: string
    name?: string
  }
  const status = anyErr.status
  const code = String(anyErr.code ?? '').toLowerCase()
  const msg = anyErr.message ?? String(err)

  if (status === 404 || code === 'nosuchkey' || code === 'objectnotfound') {
    return new OssError('not_found', `OSS object not found: ${objectKey}`, objectKey, 404)
  }
  if (status === 403 || code === 'forbidden' || code === 'accessdenied') {
    return new OssError(
      'forbidden',
      `OSS access forbidden for ${objectKey}. This may be due to an expired STS token, insufficient permissions, or a missing CORS configuration.`,
      objectKey,
      403,
    )
  }
  if (
    code === 'securitytokenexpired' ||
    code === 'invalidsecuritytoken' ||
    code === 'expiredtoken'
  ) {
    return new OssError(
      'token_expired',
      `STS token expired when accessing ${objectKey}`,
      objectKey,
      status,
    )
  }
  // Browser fetch on CORS rejection typically reports status=0 / NetworkError.
  if (
    code === 'neterror' ||
    code === 'networkerror' ||
    status === 0 ||
    /failed to fetch|networkerror|cors/i.test(msg)
  ) {
    return new OssError(
      'cors',
      `OSS CORS / network error when accessing ${objectKey}. Please check the OSS Bucket CORS configuration.`,
      objectKey,
      status,
    )
  }
  return new OssError('unknown', msg, objectKey, status)
}

/**
 * Create an OSS client bound to one STS credential set.
 *
 * STS tokens are short-lived; without `refresh` the credentials are baked
 * into the ali-oss client forever and every read after expiry fails with
 * 403/token_expired until the user reloads the page. When a `refresh`
 * callback is supplied (re-fetch `GET /processes/{run_id}/zarr`), the client
 * refreshes credentials proactively just before the token's `Expiration`
 * (minus a safety margin) and reactively — retrying each failed read once —
 * when a token_expired/forbidden error still slips through (clock skew,
 * revoked token).
 */
export function createOssClient(
  access: ZarrAccessResponse,
  opts: { refresh?: () => Promise<ZarrAccessResponse> } = {},
): OssClient {
  if (!access?.sts_token?.AccessKeyId) {
    throw new Error('[ossClient] invalid ZarrAccessResponse: missing sts_token.AccessKeyId')
  }

  /** Refresh this many ms before the STS Expiration. */
  const EXPIRY_MARGIN_MS = 60_000
  let expiresAt = resolveExpiry(access)
  /** Deduplicates concurrent refreshes: one backend round-trip, many waiters. */
  let refreshPromise: Promise<void> | null = null

  function resolveExpiry(a: ZarrAccessResponse): number {
    const parsed = Date.parse(a.sts_token.Expiration)
    if (Number.isFinite(parsed)) return parsed
    return Date.now() + (a.expires_in || 0) * 1000
  }

  // Deferred: ali-oss is a large dependency — import it lazily on first use
  // instead of at module load time. The client is created once and reused
  // (and rebuilt when STS credentials are refreshed).
  let clientPromise: Promise<OSS> | null = null
  function buildClient(a: ZarrAccessResponse): Promise<OSS> {
    return import('ali-oss').then(
      (mod) =>
        new mod.default({
          region: `oss-${a.region}`,
          bucket: a.bucket,
          accessKeyId: a.sts_token.AccessKeyId,
          accessKeySecret: a.sts_token.AccessKeySecret,
          stsToken: a.sts_token.SecurityToken,
          authorizationV4: true,
          secure: true,
        }),
    )
  }
  function getClient(): Promise<OSS> {
    if (!clientPromise) clientPromise = buildClient(access)
    return clientPromise
  }

  /** Refresh STS credentials (deduplicated) and rebuild the client. */
  async function refreshCredentials(): Promise<void> {
    if (!opts.refresh) return
    if (!refreshPromise) {
      refreshPromise = (async () => {
        access = await opts.refresh!()
        expiresAt = resolveExpiry(access)
        clientPromise = buildClient(access)
        await clientPromise
      })().finally(() => {
        refreshPromise = null
      })
    }
    return refreshPromise
  }

  /** Proactive refresh when the token is at/inside the expiry margin. */
  async function ensureFreshCredentials(): Promise<void> {
    if (!opts.refresh) return
    if (Date.now() >= expiresAt - EXPIRY_MARGIN_MS) await refreshCredentials()
  }

  async function getObjectArrayBuffer(key: string): Promise<ArrayBuffer> {
    if (!key) throw new Error('[ossClient] getObjectArrayBuffer: key is required')
    await ensureFreshCredentials()
    for (let attempt = 0; ; attempt++) {
      const client = await getClient()
      try {
        const result = await client.get(key)
        const content = result.content

        // In the browser, `content` is a Blob.
        if (content instanceof Blob) {
          return await content.arrayBuffer()
        }
        // In Node / Buffer-backed environments, `content` is an ArrayBuffer.
        if (content instanceof ArrayBuffer) {
          return content
        }
        if (content instanceof Uint8Array) {
          return (content.buffer as ArrayBuffer).slice(content.byteOffset, content.byteOffset + content.byteLength)
        }
        // Fallback: try duck-typed arrayBuffer() in case of a custom implementation.
        const anyContent = content as { arrayBuffer?(): Promise<ArrayBuffer> }
        if (anyContent.arrayBuffer) {
          return await anyContent.arrayBuffer()
        }
        throw new Error('[ossClient] unexpected ali-oss get() content type')
      } catch (err) {
        const classified = classifyError(err, key)
        // One reactive retry with fresh credentials when the error indicates
        // the baked-in STS token expired (403 forbidden is how ali-oss often
        // surfaces it). Anything else, or a second failure, propagates.
        if (
          attempt === 0 &&
          opts.refresh &&
          (classified.code === 'token_expired' || classified.code === 'forbidden')
        ) {
          await refreshCredentials()
          continue
        }
        throw classified
      }
    }
  }

  return { getObjectArrayBuffer }
}

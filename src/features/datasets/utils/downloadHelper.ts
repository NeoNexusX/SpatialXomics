import { getDownloadMetadata, getDownloadRaw, getDownloadRawNoauth } from '@/features/datasets/api/datasetApi'
import type { DownloadRawEntry } from '@/features/datasets/types/dataset'
import { t } from '@/i18n'

async function pollDownloadUrl(
  publicId: string,
  options?: {
    interval?: number
    maxRetries?: number
  },
): Promise<{ ossUrl: string; rawFilename?: string }> {
  const interval = options?.interval ?? 2000
  const maxRetries = options?.maxRetries ?? 30

  for (let i = 0; i <= maxRetries; i++) {
    // getDownloadMetadata 已返回解包后的响应体；轮询期 oss_download_url 可能是 '<PACKING>'
    const meta = await getDownloadMetadata(publicId)
    const ossUrl = meta.oss_download_url

    if (ossUrl && ossUrl !== '<PACKING>') {
      return { ossUrl, rawFilename: meta.filename ?? undefined }
    }

    if (i < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, interval))
    }
  }

  throw new Error(t('datasets.download.timeout'))
}

/**
 * OSS download: poll for oss_download_url → trigger browser download.
 */
export async function ossDownloadAndSave(
  publicId: string,
  options?: { getFallbackFilename?: () => string | undefined },
) {
  const { ossUrl, rawFilename } = await pollDownloadUrl(publicId)

  const filename: string = rawFilename
    ? rawFilename.toLowerCase().endsWith('.zip')
      ? rawFilename
      : `${rawFilename}.zip`
    : options?.getFallbackFilename?.() || `${publicId}.zip`

  const link = document.createElement('a')
  link.href = ossUrl
  link.setAttribute('download', filename)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

/**
 * Trigger a browser download inside its own browsing context via a hidden iframe.
 *
 * Each download gets a dedicated iframe, so starting the next download cannot
 * abort a still-in-flight previous one. Clicking several top-level <a> elements
 * in the same window did have that failure mode: the second navigation cancels
 * the first before its response commits, which on slower links (e.g. a farther
 * OSS region) silently dropped the first file (imzML) while the last one (ibd)
 * won.
 *
 * The download and its filename both come from the OSS pre-signed URL's
 * `Content-Disposition: attachment` header — the cross-origin `download`
 * attribute is ignored by browsers, so no anchor is needed.
 *
 * The iframe is removed only after the response has had time to detach to the
 * browser's download manager; removing it earlier would cancel the transfer.
 */
function triggerIframeDownload(url: string): void {
  const iframe = document.createElement('iframe')
  iframe.style.display = 'none'
  iframe.src = url
  document.body.appendChild(iframe)
  window.setTimeout(() => iframe.remove(), 60_000)
}

/** 每个 pre-signed URL 各起一个隐藏 iframe 触发下载；无 URL 视为后端未就绪，抛错让上层提示。 */
function downloadEntries(files: DownloadRawEntry[] | undefined) {
  if (!files || !files.length) {
    throw new Error(t('datasets.download.noUrls'))
  }
  for (const entry of files) {
    triggerIframeDownload(entry.url)
  }
}

/**
 * RAW pre-signed download: GET /files/{public_id}/download_raw → imzML + ibd URLs.
 * No polling — pre-signed URLs are returned immediately.
 * Each file downloads in its own hidden iframe so they can't cancel each other.
 */
export async function ossDownloadRaw(
  publicId: string,
  options?: { isPublic?: boolean },
) {
  const { files } = await getDownloadRaw(publicId, options?.isPublic ?? false)
  downloadEntries(files)
}

/**
 * RAW pre-signed download via the no-auth endpoint (public collection page).
 * Same iframe strategy; backend only serves is_public files.
 */
export async function ossDownloadRawNoauth(publicId: string) {
  const { files } = await getDownloadRawNoauth(publicId)
  downloadEntries(files)
}

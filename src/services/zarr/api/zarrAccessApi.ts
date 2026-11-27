/**
 * Zarr access backend API.
 *
 * Backend endpoint:
 *   GET /processes/{run_id}/zarr  →  { zarr_url }
 *
 * zarr_url is the CDN URL of the run's zarr root directory. Its domain is
 * configured by the backend per environment (test server: gdn, production:
 * cdn) and used as-is; objects are read from it by zarrHttpClient without
 * credentials.
 */

import { auth_api } from '@/shared/api/httpClient'
import { unwrap } from '@/shared/api/response'

interface ZarrAccessResponse {
  /** zarr 根目录的 CDN URL（尾带 /），如 "https://cdn.example.com/processed/run_a1b2c3_45.zarr/" */
  zarr_url: string
}

/**
 * Fetch the zarr root URL for a given run.
 *
 * A run has exactly one zarr: algorithm results and clustering results
 * (analysis/umap group) live in the same directory.
 *
 * The URL must be an absolute https URL: a CDN domain configured without a
 * scheme would otherwise resolve as a path relative to the current page.
 * The trailing slash is normalized so object paths can be appended.
 */
export async function getZarrUrl(runId: string): Promise<string> {
  if (!runId) throw new Error('[zarrAccessApi] runId is required')
  const data = await unwrap(auth_api.get<ZarrAccessResponse>(`/processes/${runId}/zarr`))
  let url: URL
  try {
    url = new URL(data?.zarr_url ?? '')
  } catch {
    throw new Error('[zarrAccessApi] invalid zarr access response: missing or relative zarr_url')
  }
  if (url.protocol !== 'https:') {
    throw new Error(`[zarrAccessApi] zarr_url must use https: ${url.href}`)
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.href
}

/**
 * Zarr OSS access backend API.
 *
 * Backend endpoint:
 *   GET /processes/{run_id}/zarr
 *
 * Returns an Alibaba Cloud OSS STS token + the zarr directory prefix.
 * The STS token is signed and issued by the backend; the frontend never
 * hardcodes it, and must never print the cleartext in logs.
 */

import { auth_api } from '@/shared/api/httpClient'
import { unwrap } from '@/shared/api/response'
import type { ZarrAccessResponse } from '../types/zarr'

/**
 * Fetch the zarr OSS access credentials for a given run.
 * Note: do not console.log the raw response - the STS secret fields
 * (AccessKeySecret, SecurityToken) are sensitive.
 *
 * A run has exactly one zarr: algorithm results and clustering results
 * (analysis/umap group) live in the same directory. The legacy
 * `zarr_type=clustering` parameter was removed by the backend.
 */
export async function getZarrAccess(runId: string): Promise<ZarrAccessResponse> {
  if (!runId) throw new Error('[zarrAccessApi] runId is required')
  const data = await unwrap(auth_api.get<ZarrAccessResponse>(`/processes/${runId}/zarr`))
  if (!data?.sts_token?.AccessKeyId) {
    throw new Error('[zarrAccessApi] invalid zarr access response: missing sts_token')
  }
  return data
}

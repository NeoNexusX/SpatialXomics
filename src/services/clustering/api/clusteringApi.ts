/**
 * UMAP / KMeans clustering backend API.
 *
 * Backend endpoint:
 *   POST /processes/{run_id}/clustering
 *
 * The frontend treats POST as create-or-fetch for the backend UMAP task and
 * reuses it as a status check while processing. KMeans itself runs locally in
 * the browser. The UI treats a successful UMAP Zarr load as the final
 * readiness gate and stops POST polling on completed/failed.
 */

import { auth_api } from '@/shared/api/httpClient'
import { unwrap } from '@/shared/api/response'
import type { ClusteringTaskResponse } from '../types/clustering'

/**
 * Create-or-fetch the backend UMAP task for a run. While it is processing the
 * caller may invoke this again and inspect `clustering_status`.
 */
export async function createClustering(runId: string): Promise<ClusteringTaskResponse> {
  if (!runId) throw new Error('[clusteringApi] runId is required')
  const data = await unwrap(auth_api.post<ClusteringTaskResponse>(`/processes/${runId}/clustering`))
  if (!data || data.id == null) {
    throw new Error('[clusteringApi] invalid clustering response: missing id')
  }
  return data
}

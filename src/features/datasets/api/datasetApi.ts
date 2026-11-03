import { auth_api, api } from '@/shared/api/httpClient'
import { authStorage } from '@/shared/auth/authStorage'
import { getConfig } from '@/shared/config/runtimeConfig'
import type {
  DownloadRawResponse,
  FilePublicId,
  ProcessingStats,
} from '@/features/datasets/types/dataset'

// 约定：本模块所有函数都返回**解包后的响应体**（res.data），调用方不再处理 axios 信封。

// GET /files/{public_id}/download — ZIP 打包下载；只消费 oss_download_url 与 filename，
// 不再声明或读取 file_id/path 等字段
export interface DownloadZipResponse {
  /** 轮询期可能为 '<PACKING>' 占位值 */
  oss_download_url: string
  filename?: string | null
}

export async function getDownloadMetadata(publicId: FilePublicId): Promise<DownloadZipResponse> {
  const res = await auth_api.get(`/files/${publicId}/download`)
  return res.data
}

// GET /files/{public_id}/metadata — 元数据：后端强制登录（匿名一律 401，不看 is_public），
// 任意登录用户可看（含私有）。已登录走 auth_api（过期 token 401 由全局拦截处理）；
// 匿名走 api + skipAuthRedirect，由调用方（useDatasetDetail）把 401 转成就地登录引导
export async function getFileMetadata(publicId: FilePublicId, signal?: AbortSignal) {
  const authed = !!authStorage.getToken()
  const res = authed
    ? await auth_api.get(`/files/${publicId}/metadata`, ...(signal ? [{ signal }] : []))
    : await api.get(`/files/${publicId}/metadata`, {
        skipAuthRedirect: true,
        ...(signal ? { signal } : {}),
      } as any)
  return res.data
}

// GET /files/{public_id}/download_raw - pre-signed URLs for imzML + ibd, zero polling
export async function getDownloadRaw(
  publicId: FilePublicId,
  isPublic = false,
): Promise<DownloadRawResponse> {
  const client = isPublic ? api : auth_api
  const res = await client.get(`/files/${publicId}/download_raw`)
  return res.data
}

// GET /files/{public_id}/download_raw_noauth — 公开集合页专用（免登录）。
// 后端仅对 is_public 文件放行，私有文件 404。
export async function getDownloadRawNoauth(publicId: FilePublicId): Promise<DownloadRawResponse> {
  const res = await api.get(`/files/${publicId}/download_raw_noauth`)
  return res.data
}

// DELETE /files/{public_id} — 响应回传 public_id
export async function deleteFile(publicId: FilePublicId): Promise<{ public_id: string }> {
  const res = await auth_api.delete(`/files/${publicId}`)
  return res.data
}

// PUT /files/{public_id}/set_public — 响应回传 public_id
export async function setFilePublic(publicId: FilePublicId): Promise<{ public_id: string }> {
  const res = await auth_api.put(`/files/${publicId}/set_public`)
  return res.data
}

// PATCH /files/{public_id} — 文件元数据部分更新（键为后端 snake_case）。
// 可改：样本属性 9 个（含 solvent）+ spectrum_mode + storage_mode；is_public/
// experiment_type/filename 等系统字段禁改。权限：任一文件持有者。响应为更新后的 FilePublic。
export interface FileMetadataPatch {
  organism?: string
  organism_part?: string
  condition?: string
  sample_growth_conditions?: string
  sample_stabilization?: string
  tissue_modification?: string
  maldi_matrix?: string
  maldi_matrix_application?: string
  solvent?: string // "N% Name, ..." 复合串，与上传表单同构
  spectrum_mode?: string // 'profile' | 'centroid'
  storage_mode?: string // 'continuous' | 'processed'
}

export async function patchFileMetadata(publicId: FilePublicId, patch: FileMetadataPatch) {
  const res = await auth_api.patch(`/files/${publicId}`, patch)
  return res.data
}

/** 文件列表服务端排序（sort_by/order 白名单与后端一致，非法值 422） */
export interface FileListSort {
  sortBy: 'uploaded_at' | 'size'
  order: 'asc' | 'desc'
}

// POST /files/list_files?page={page}&size={size}&sort_by={sort_by}&order={order}
// Backend expects a JSON body of filter attributes; returns { data: [...], meta: {...} }.
// 排序/分页参数走 query string，过滤条件仍在请求体；同值行按 public_id 倒序兜底。
export async function listFiles(
  filters: Record<string, any> = {},
  page = 1,
  size = getConfig().pagination.defaultPageSize,
  isPublic = false,
  sort?: FileListSort,
  signal?: AbortSignal,
) {
  const client = isPublic ? api : auth_api
  const res = await client.post('/files/list_files', filters, {
    ...(signal ? { signal } : {}),
    params: { page, size, sort_by: sort?.sortBy, order: sort?.order },
  })
  return res.data
}

// List files for the current user (backend separates public vs user scope)
// POST /files/list_user_files?page={page}&size={size}&sort_by={sort_by}&order={order}
export async function listUserFiles(
  filters: Record<string, any> = {},
  page = 1,
  size = getConfig().pagination.defaultPageSize,
  sort?: FileListSort,
  signal?: AbortSignal,
) {
  const res = await auth_api.post('/files/list_user_files', filters, {
    ...(signal ? { signal } : {}),
    params: { page, size, sort_by: sort?.sortBy, order: sort?.order },
  })
  return res.data
}

// POST /processes - Create Process（源文件以 public_id 标识，禁止任何数字转换）
export async function createProcess(payload: {
  file_public_id: FilePublicId
  algorithms: Record<string, any>
}) {
  const res = await auth_api.post('/processes', payload)
  return res.data
}

// POST /processes/raw-convert - 一键 Zarr 可视化（无需配置预处理参数）
export async function rawConvertProcess(publicId: FilePublicId) {
  const res = await auth_api.post('/processes/raw-convert', { file_public_id: publicId })
  return res.data
}

// POST /processes/mine?page=&size= - List my processes (paginated, fuzzy filter)
// RunFilter body 必填（后端 breaking change：不发 body 会 422），不筛选时也要发 {}
export interface ProcessRunFilter {
  /** 对源文件名模糊匹配（LIKE %xxx%） */
  filename?: string
  /** 对算法参数 params_json 模糊匹配（直转 run 的 __RAW_CONVERT__ 标记也参与匹配） */
  params?: string
}

// 后端返回 { data: [...], meta: { current_page, total_pages, total_records } }
export async function listMyProcesses(
  page = 1,
  size = 10,
  filter: ProcessRunFilter = {},
  signal?: AbortSignal,
) {
  const res = await auth_api.post('/processes/mine', filter, {
    params: { page, size },
    ...(signal ? { signal } : {}),
  })
  const body = res.data
  // 兼容纯数组返回（无分页信息时）
  if (Array.isArray(body))
    return { data: body, meta: { current_page: 1, total_pages: 1, total_records: body.length } }
  if (body && Array.isArray(body.data)) return body
  return { data: [], meta: { current_page: 1, total_pages: 1, total_records: 0 } }
}

// GET /stats/processing - Processing statistics for current user
export async function getProcessingStats(): Promise<ProcessingStats> {
  const res = await auth_api.get('/stats/processing')
  return res.data
}

// DELETE /processes/{run_id} - Delete a process/result
export async function deleteProcess(runId: string | number) {
  const res = await auth_api.delete(`/processes/${runId}`)
  return res.data
}

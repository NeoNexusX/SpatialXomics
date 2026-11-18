import { auth_api, api } from '@/shared/api/httpClient'
import { toPage, unwrap, type Page } from '@/shared/api/response'
import { authStorage } from '@/shared/auth/authStorage'
import { getConfig } from '@/shared/config/runtimeConfig'
import type {
  DownloadRawResponse,
  FilePublicId,
  FilePublicResponse,
  ProcessItem,
  ProcessingStats,
} from '@/features/datasets/types/dataset'
import { isDirectRun } from '@/shared/utils/processRun'

// GET /files/{public_id}/download — ZIP 打包下载；只消费 oss_download_url 与 filename，
// 不再声明或读取 file_id/path 等字段
export interface DownloadZipResponse {
  /** 轮询期可能为 '<PACKING>' 占位值 */
  oss_download_url: string
  filename?: string | null
}

export async function getDownloadMetadata(publicId: FilePublicId): Promise<DownloadZipResponse> {
  return unwrap(auth_api.get(`/files/${publicId}/download`))
}

// GET /files/{public_id}/metadata — 元数据：后端强制登录（匿名一律 401，不看 is_public），
// 任意登录用户可看（含私有）。已登录走 auth_api（过期 token 401 由全局拦截处理）；
// 匿名走 api + skipAuthRedirect，由调用方（useDatasetDetail）把 401 转成就地登录引导
export async function getFileMetadata(publicId: FilePublicId, signal?: AbortSignal) {
  const authed = !!authStorage.getToken()
  return unwrap(
    authed
      ? auth_api.get(`/files/${publicId}/metadata`, ...(signal ? [{ signal }] : []))
      : api.get(`/files/${publicId}/metadata`, {
          skipAuthRedirect: true,
          ...(signal ? { signal } : {}),
        } as any),
  )
}

// GET /files/{public_id}/download_raw - pre-signed URLs for imzML + ibd, zero polling
export async function getDownloadRaw(
  publicId: FilePublicId,
  isPublic = false,
): Promise<DownloadRawResponse> {
  const client = isPublic ? api : auth_api
  return unwrap(client.get(`/files/${publicId}/download_raw`))
}

// GET /files/{public_id}/download_raw_noauth — 公开集合页专用（免登录）。
// 后端仅对 is_public 文件放行，私有文件 404。
export async function getDownloadRawNoauth(publicId: FilePublicId): Promise<DownloadRawResponse> {
  return unwrap(api.get(`/files/${publicId}/download_raw_noauth`))
}

// DELETE /files/{public_id} — 响应回传 public_id
export async function deleteFile(publicId: FilePublicId): Promise<{ public_id: string }> {
  return unwrap(auth_api.delete(`/files/${publicId}`))
}

// PUT /files/{public_id}/set_public — 响应回传 public_id
export async function setFilePublic(publicId: FilePublicId): Promise<{ public_id: string }> {
  return unwrap(auth_api.put(`/files/${publicId}/set_public`))
}

// PATCH /files/{public_id} — 文件元数据部分更新（键为后端 snake_case）。
// 可改：样本属性 9 个（含 solvent）+ 仪器参数 7 个；is_public/experiment_type/
// filename 等系统字段禁改。spectrum_mode / storage_mode 已不可改（请求里带着会
// 被后端静默忽略），不再声明。权限：任一文件持有者。响应为更新后的 FilePublic。
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
  polarity?: string // e.g. Positive / Negative
  ionisation_source?: string // e.g. MALDI / ESI / DESI
  analyzer?: string // e.g. TOF / Orbitrap / FTICR
  pixel_size_horizontal?: number // μm，>= 0
  pixel_size_vertical?: number // μm，>= 0
  resolving_power?: number // >= 0，无单位
  mz?: number // 质荷比，>= 0
}

export async function patchFileMetadata(
  publicId: FilePublicId,
  patch: FileMetadataPatch,
): Promise<FilePublicResponse> {
  return unwrap(auth_api.patch<FilePublicResponse>(`/files/${publicId}`, patch))
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
  const body = await unwrap(
    client.post('/files/list_files', filters, {
      ...(signal ? { signal } : {}),
      params: { page, size, sort_by: sort?.sortBy, order: sort?.order },
    }),
  )
  return toPage(body)
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
  const body = await unwrap(
    auth_api.post('/files/list_user_files', filters, {
      ...(signal ? { signal } : {}),
      params: { page, size, sort_by: sort?.sortBy, order: sort?.order },
    }),
  )
  return toPage(body)
}

/** 新建（或复用已有）处理任务的返回 */
export interface CreatedProcess {
  id: number
  user_id: number
}

// POST /processes - Create Process（源文件以 public_id 标识，禁止任何数字转换）
export async function createProcess(payload: {
  file_public_id: FilePublicId
  algorithms: Record<string, any>
}): Promise<CreatedProcess> {
  return unwrap(auth_api.post('/processes', payload))
}

// POST /processes/raw-convert - 一键 Zarr 可视化（无需配置预处理参数）
export async function rawConvertProcess(publicId: FilePublicId): Promise<CreatedProcess> {
  return unwrap(auth_api.post('/processes/raw-convert', { file_public_id: publicId }))
}

// POST /processes/mine?page=&size= - List my processes (paginated, fuzzy filter)
// RunFilter body 必填（后端 breaking change：不发 body 会 422），不筛选时也要发 {}
export interface ProcessRunFilter {
  /** 对源文件名模糊匹配（LIKE %xxx%） */
  filename?: string
  /** 对算法参数 params_json 模糊匹配（直转 run 的 __RAW_CONVERT__ 标记也参与匹配） */
  params?: string
}

// 后端返回 { data: [...], meta: { current_page, total_pages, total_records } }，偶尔是纯数组
export async function listMyProcesses(
  page = 1,
  size = 10,
  filter: ProcessRunFilter = {},
  signal?: AbortSignal,
): Promise<Page<ProcessItem>> {
  const body = await unwrap(
    auth_api.post('/processes/mine', filter, {
      params: { page, size },
      ...(signal ? { signal } : {}),
    }),
  )
  return toPage(body)
}

// GET /stats/processing - Processing statistics for current user
export async function getProcessingStats(): Promise<ProcessingStats> {
  return unwrap(auth_api.get('/stats/processing'))
}

/** 新建分析入口的配额上限：非直转任务达到此数量后禁止再创建 */
export const ANALYSIS_LIMIT = 5

const QUOTA_PAGE_SIZE = 100

/**
 * 统计当前用户的非直转处理任务数量（所有状态都计入，直转任务排除）。
 *
 * /processes/mine 返回全部状态的任务记录，processing 也在其中；逐条判断 params_json
 * 是否为直转标记即可。后端没有「排除直转」的服务端过滤条件，只能按页取回再本地过滤。
 * 调用方只需要判断是否达到上限，所以累计到 limit 即提前返回（返回值封顶为 limit），
 * 避免为精确总数翻完所有页。单页大小只是请求值，翻页以响应 meta.total_pages 为准。
 */
export async function countNonDirectProcesses(limit = ANALYSIS_LIMIT): Promise<number> {
  let count = 0
  let page = 1
  let totalPages = 1

  do {
    const result = await listMyProcesses(page, QUOTA_PAGE_SIZE, {})
    totalPages = result.meta.total_pages

    for (const process of result.data) {
      if (!isDirectRun(process.params_json)) count += 1
    }

    if (count >= limit) return limit
    page += 1
  } while (page <= totalPages)

  return count
}

// DELETE /processes/{run_id} - Delete a process/result
export async function deleteProcess(runId: string | number) {
  return unwrap(auth_api.delete(`/processes/${runId}`))
}

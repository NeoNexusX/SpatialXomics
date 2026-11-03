import { api, auth_api, extractBackendError } from '@/shared/api/httpClient'
import { mapCollectionDetail, mapCollectionSummary } from '../mappers/collectionMapper'
import { isCollectionApiError } from '../types/collection'
import { t } from '@/i18n'
import type {
  CollectionApiError,
  CollectionCreatePayload,
  CollectionDetail,
  CollectionListMeta,
  CollectionPatchPayload,
  CollectionSummary,
  MemberRemovalResult,
  PublicCollectionDetail,
} from '../types/collection'

/**
 * Collection API 客户端。约定（同 datasetApi）：所有函数返回解包后的响应体，
 * 并已通过 collectionMapper 转成前端类型；错误统一转成 CollectionApiError
 * （携带 status + 后端 detail 原文），供 composable 判定 409/403/404 细分文案。
 *
 * 除公开页（getPublicCollection 走免登录 api 实例）外全部 auth_api。
 */

function toCollectionApiError(err: any): CollectionApiError {
  const e = new Error(extractBackendError(err, t('common.state.error'))) as CollectionApiError
  e.status = err?.response?.status
  // 409 的 detail 是字符串原文（invalid collection members 等）；422 时是校验数组，String 化即可
  const detail = err?.response?.data?.detail
  e.backendMessage = typeof detail === 'string' ? detail : String(detail ?? e.message)
  return e
}

async function unwrap<T>(fn: () => Promise<{ data: T }>): Promise<T> {
  try {
    return (await fn()).data
  } catch (err) {
    throw toCollectionApiError(err)
  }
}

/**
 * 取用户可读错误文案。CollectionApiError 的 message 已是后端 detail 原文
 * （extractBackendError 在包装时已归一化），不能再走 extractBackendError——
 * 它把非 axios 错误直接替换成 fallback，会吞掉 409 的细分原因。
 */
export function collectionErrorMessage(err: any, fallback: string): string {
  if (isCollectionApiError(err)) return err.message || err.backendMessage || fallback
  return extractBackendError(err, fallback)
}

/** 响应信封防御归一：列表接口可能返回纯数组或 { data } / { items } 信封 */
function normalizeList(body: any): any[] {
  if (Array.isArray(body)) return body
  if (body && Array.isArray(body.data)) return body.data
  if (body && Array.isArray(body.items)) return body.items
  return []
}

/** meta 防御归一：缺字段时退化为单页语义 */
function toListMeta(meta: any): CollectionListMeta {
  return {
    current_page: meta?.current_page ?? 1,
    current_records: meta?.current_records ?? 0,
    total_pages: meta?.total_pages ?? 1,
    total_records: meta?.total_records ?? 0,
  }
}

/** POST /collections/list 与 POST /collections/list_all 的分页响应（{meta, data}，与文件列表一致） */
export interface CollectionListResponse {
  meta: CollectionListMeta
  data: CollectionSummary[]
}

/**
 * 集合列表筛选体（POST body）。不筛选也要发 {}——后端对缺失 body 返回 422；
 * 字段支持单值或数组（数组 = OR），语义见后端接口文档 §4.3：
 * name/title/journal_name/owner_username 模糊、member_type/collection_type 精确、
 * organism 等词表字段为「集合内包含该值」。
 */
export type CollectionListFilters = Record<string, any>

// POST /collections/list?page=&size= — 当前登录用户的集合（owner 过滤），updated_at 倒序；
// 筛选条件走 body（CollectionFilter，不筛选也发 {}），分页走 query
export async function listCollections(
  page: number,
  size: number,
  filters: CollectionListFilters = {},
): Promise<CollectionListResponse> {
  const body = await unwrap<any>(() =>
    auth_api.post('/collections/list', filters, { params: { page, size } }),
  )
  return { meta: toListMeta(body?.meta), data: normalizeList(body).map(mapCollectionSummary) }
}

// POST /collections/list_all?page=&size= — 全库集合（任意登录用户，不做 owner 过滤），
// 用于「浏览全部」；筛选/分页契约与 /collections/list 完全一致
export async function listAllCollections(
  page: number,
  size: number,
  filters: CollectionListFilters = {},
): Promise<CollectionListResponse> {
  const body = await unwrap<any>(() =>
    auth_api.post('/collections/list_all', filters, { params: { page, size } }),
  )
  return { meta: toListMeta(body?.meta), data: normalizeList(body).map(mapCollectionSummary) }
}

// POST /collections — 创建；file_public_ids 顺序 = position，响应为完整 CollectionDetail
export async function createCollection(
  payload: CollectionCreatePayload,
): Promise<CollectionDetail> {
  const body = await unwrap(() => auth_api.post('/collections', payload))
  return mapCollectionDetail(body)
}

// PATCH /collections/{public_id} — 元数据部分更新（exclude_unset），响应为完整 CollectionDetail
export async function updateCollection(
  publicId: string,
  patch: CollectionPatchPayload,
): Promise<CollectionDetail> {
  const body = await unwrap(() => auth_api.patch(`/collections/${publicId}`, patch))
  return mapCollectionDetail(body)
}

// DELETE /collections/{public_id} — 删除集合（不动文件）；响应 {public_id, deleted}
export async function deleteCollection(
  publicId: string,
): Promise<{ publicId: string; deleted: boolean }> {
  const body = await unwrap<any>(() => auth_api.delete(`/collections/${publicId}`))
  return { publicId: body?.public_id ?? publicId, deleted: !!body?.deleted }
}

// POST /collections/{public_id}/members — 批量追加到末尾（幂等：已有/重复 public_id 跳过）
export async function addMembers(
  publicId: string,
  filePublicIds: string[],
): Promise<CollectionDetail> {
  const body = await unwrap(() =>
    auth_api.post(`/collections/${publicId}/members`, { file_public_ids: filePublicIds }),
  )
  return mapCollectionDetail(body)
}

// DELETE /collections/{public_id}/members — 批量移除；响应 removed/skipped（public_id 列表）供对账
export async function removeMembers(
  publicId: string,
  filePublicIds: string[],
): Promise<MemberRemovalResult> {
  const body = await unwrap<any>(() =>
    auth_api.delete(`/collections/${publicId}/members`, { data: { file_public_ids: filePublicIds } }),
  )
  return {
    publicId: body?.public_id ?? publicId,
    removed: body?.removed ?? [],
    skipped: body?.skipped ?? [],
  }
}

// PATCH /collections/{public_id}/members/order — 全量重写调序；数组必须恰好等于当前成员全集
// （含不存在的 public_id 时同样 409，与顺序冲突同口径）
export async function reorderMembers(
  publicId: string,
  filePublicIds: string[],
): Promise<CollectionDetail> {
  const body = await unwrap(() =>
    auth_api.patch(`/collections/${publicId}/members/order`, { file_public_ids: filePublicIds }),
  )
  return mapCollectionDetail(body)
}

// GET /collections/public/{public_id} — 免登录公开页详情（响应无数字 id，见 PublicCollectionDetail）
export async function getPublicCollection(publicId: string): Promise<PublicCollectionDetail> {
  const body = await unwrap(() => api.get(`/collections/public/${publicId}`))
  return mapCollectionDetail(body)
}

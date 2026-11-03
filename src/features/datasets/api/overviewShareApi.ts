import { api, auth_api } from '@/shared/api/httpClient'
import { authStorage } from '@/shared/auth/authStorage'

export interface ShareOverviewResult {
  /** GET /files/{public_id}/metadata 的响应体 */
  metadata: any
}

/**
 * 分享页元数据：后端要求分享内容也需要登录态（匿名访问 401）。
 *
 * - 已登录 → auth_api（带 Authorization；token 失效时由全局 401 处理清凭证并跳登录）
 * - 匿名 → 匿名客户端 + skipAuthRedirect：401 不触发全局跳转，由页面就地渲染
 *   「登录 / 注册」引导（useDatasetDetail.requiresAuth）
 *
 * public_id 不存在/越权由后端 404，前端按死链处理，不硬编码范围。
 */
export async function getShareOverviewMetadata(publicId: string): Promise<ShareOverviewResult> {
  const authed = !!authStorage.getToken()
  const client = authed ? auth_api : api
  const config = authed ? {} : ({ skipAuthRedirect: true } as any)

  const res = await client.get(`/files/${publicId}/metadata`, config)
  return { metadata: res.data }
}

import { auth_api } from '@/shared/api/httpClient'
import { unwrap } from '@/shared/api/response'

/** POST /files/upload 的返回：直传 OSS 用的 STS 凭证和目标位置 */
export interface OssUploadResponse {
  oss_sts_token: {
    AccessKeyId: string
    AccessKeySecret: string
    SecurityToken: string
    Expiration: string
  }
  oss_bucket: string
  oss_path: string
  oss_region_id: string
}

/** POST /files/preflight — 登记上传并返回 public_id；服务器上已有同一文件时 is_reuse 为 true */
export function preflightUpload(payload: Record<string, unknown>, signal?: AbortSignal) {
  return unwrap(
    auth_api.post<{ public_id: string; is_reuse?: boolean }>('/files/preflight', payload, { signal }),
  )
}

/** POST /files/upload — 取直传 OSS 的凭证 */
export function requestOssUpload(filename: string, prePublicId: string) {
  return unwrap(
    auth_api.post<OssUploadResponse>(
      '/files/upload',
      new URLSearchParams({ filename, pre_public_id: prePublicId }),
    ),
  )
}

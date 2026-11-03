import type { Router } from 'vue-router'

/** 分享 token：16 位 public_id，明文出现在链接里 */
export const PUBLIC_ID_RE = /^[A-Za-z0-9]{16}$/

export function isValidPublicId(value: unknown): value is string {
  return typeof value === 'string' && PUBLIC_ID_RE.test(value)
}

/**
 * Build the absolute, short Overview share URL /s/{public_id} from a 16-char
 * public id. 数据集分享统一走这一个入口（overview 页 Share 按钮与列表卡片分享共用）。
 */
export function buildOverviewShareUrl(
  router: Router,
  publicId: string,
  origin: string,
): string | null {
  if (!isValidPublicId(publicId)) return null

  const href = router.resolve({
    name: 'SharedDatasetOverview',
    params: { shareToken: publicId },
  }).href
  return new URL(href, origin).toString()
}

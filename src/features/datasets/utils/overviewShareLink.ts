import type { Router } from 'vue-router'
import { isValidPublicId } from './publicId'

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

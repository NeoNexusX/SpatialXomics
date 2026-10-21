import { getConfig } from '@/shared/config/runtimeConfig'

/** OSS 图片样式后缀（缩略在 OSS 侧按样式名处理） */
const OSS_STYLE = '_preview'

/**
 * 预览图槽位。preview.jpg 必定存在（后端只在 OSS 目录确认非空时才写 image_path）；
 * preview_2/preview_3 仅 UMAP 生成的 continuous 文件才有，加载失败时由调用方回退。
 */
export type PreviewSlot = 'preview.jpg' | 'preview_2.jpg' | 'preview_3.jpg'

/**
 * 直连 base：因部署环境而异（测试服为 OSS 域名，正式服为绑定同一 bucket 的
 * CDN 域名），取自 config.json 的 `oss.previewImageBase`；loadConfig 已保证
 * 缺省时兜底为测试环境域名，因此运行到这里必定有值。
 */
function previewBase(): string {
  return getConfig().oss!.previewImageBase!
}

/**
 * 直连 OSS 预览图 URL。该路径已放开公共读权限，无需再调后端接口换下载 URL。
 *
 * 目录完全取自后端 image_path（FC 回传的 OSS 目录，后端确认非空才写入），
 * 前端不再自行拼接 images/file_{id}。image_path 为空（未生成/失败）时返回
 * null，调用方直接渲染占位图，不发起注定 404 的请求。
 *
 * 兼容绝对 URL 与相对 OSS key 两种取值：带 http(s):// 前缀时视为完整地址直接
 * 拼文件名，否则拼上 previewImageBase 域名。末尾斜杠做归一化（FC 已保证以 /
 * 结尾，这里双保险）。
 */
export function buildPreviewImageUrl(
  imagePath: string | null | undefined,
  slot: PreviewSlot = 'preview.jpg',
): string | null {
  if (!imagePath) return null
  const dir = imagePath.replace(/\/+$/, '') + '/'
  const file = `${slot}${OSS_STYLE}`
  if (/^https?:\/\//i.test(dir)) return dir + file
  return `${previewBase().replace(/\/+$/, '')}/${dir}${file}`
}

/**
 * 固定返回 3 张预览图 URL（hover-gallery 用）：preview.jpg / preview_2.jpg /
 * preview_3.jpg。image_path 为空时各项为 null，由组件走占位图。
 */
export function buildPreviewImageUrls(
  imagePath: string | null | undefined,
): [string | null, string | null, string | null] {
  return [
    buildPreviewImageUrl(imagePath, 'preview.jpg'),
    buildPreviewImageUrl(imagePath, 'preview_2.jpg'),
    buildPreviewImageUrl(imagePath, 'preview_3.jpg'),
  ]
}

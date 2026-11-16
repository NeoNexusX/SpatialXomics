/**
 * 离子图导出格式与文件名。
 *
 * PNG 保留导出画布的透明背景；JPEG 没有 alpha 通道，必须先把透明像素铺到
 * 不透明底色上再压缩——直接 `canvas.toDataURL('image/jpeg')` 会让 0 强度像素和
 * letterbox 区域被浏览器合成成黑色（整张图带一圈黑边）。
 *
 * 放在 utils 而不是组件里：工具栏（选格式）和查看器（真正导出）都要用，
 * 由 viewer 反向 import toolbar 会成环。
 */

/** 导出格式：jpeg 走白底压缩，png 保留透明通道 */
export type IonImageFormat = 'jpeg' | 'png'

/** 工具栏主按钮一键导出时的默认格式 */
export const DEFAULT_ION_IMAGE_FORMAT: IonImageFormat = 'jpeg'

export const ION_IMAGE_MIME: Record<IonImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
}

/** 下载文件的扩展名（MIME 是 image/jpeg，但惯例用 .jpg） */
export const ION_IMAGE_EXT: Record<IonImageFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
}

/** 0.92：色图渐变不出明显色带，体积仍比 PNG 小一个量级 */
export const ION_IMAGE_JPEG_QUALITY = 0.92

/** JPEG 的铺底颜色（白底，方便直接贴进论文 / PPT）；想和屏幕一致就改成 '#0a0a0f' */
export const ION_IMAGE_JPEG_BACKGROUND = '#ffffff'

/** 文件名：标签沿用调用方的 m/z / 通道约定，这里只负责拼扩展名 */
export function ionImageFilename(label: string, format: IonImageFormat): string {
  return `ion_image${label}.${ION_IMAGE_EXT[format]}`
}

/**
 * 把带透明通道的画布铺到不透明底色上，返回新画布。
 * 拿不到 2D 上下文时退回原图（宁可带透明通道，也别让下载直接失败）。
 */
export function flattenOnBackground(
  src: HTMLCanvasElement,
  background: string = ION_IMAGE_JPEG_BACKGROUND,
): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = src.width
  out.height = src.height
  const ctx = out.getContext('2d')
  if (!ctx) return src
  ctx.fillStyle = background
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(src, 0, 0)
  return out
}

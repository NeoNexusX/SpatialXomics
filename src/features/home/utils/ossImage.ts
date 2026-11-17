/**
 * 首页图片都放在阿里云 OSS 上，原图动辄几千像素宽（一张离子图 6532×3000）。
 * 让 OSS 按显示宽度缩放并转成 WebP（透明通道保留），不经过构建流程。
 * OSS 默认不放大比目标宽度小的图；非 OSS 地址原样返回。
 */
const OSS_HOSTS = [/\.aliyuncs\.com$/, /^cdn\.neonexus\.top$/]

function parseOss(src: string): URL | null {
  try {
    const url = new URL(src)
    return OSS_HOSTS.some((host) => host.test(url.hostname)) &&
      !url.searchParams.has('x-oss-process')
      ? url
      : null
  } catch {
    return null
  }
}

/** 指定宽度的 WebP 地址 */
export function ossImage(src: string, width: number): string {
  const url = parseOss(src)
  if (!url) return src
  url.searchParams.set('x-oss-process', `image/resize,w_${width}/format,webp`)
  return url.toString()
}

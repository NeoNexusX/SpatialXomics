/** 用 <a download> 触发下载。跨域地址的 download 属性会被浏览器忽略，文件名以服务器返回的为准 */
export function downloadUrl(url: string, filename: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  // 挂到文档里再点击，兼容只响应文档内链接的旧浏览器
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** 把 Blob 作为文件下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  downloadUrl(url, filename)
  // Defer revocation: revoking synchronously can cancel the download in some
  // browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** 把 canvas 存成图片文件下载。type、quality 同 canvas.toBlob */
export function downloadCanvas(
  canvas: HTMLCanvasElement,
  filename: string,
  type = 'image/png',
  quality?: number,
): void {
  canvas.toBlob((blob) => blob && downloadBlob(blob, filename), type, quality)
}

/** 聊天附件的图片处理：读成 dataURL，过大的先等比缩小（dataURL 直接进请求体） */

const MAX_IMAGE_DIMENSION = 1568

/** 只收模型普遍接受的位图格式；gif/bmp/tiff 压缩链路不认、直传又几乎必被拒 */
export function isSupportedImage(file: File): boolean {
  return /^image\/(png|jpe?g|webp)$/i.test(file.type)
}

export async function fileToDataUrl(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('image decode failed'))
    el.src = dataUrl
  })
  const longest = Math.max(image.width, image.height)
  if (longest <= MAX_IMAGE_DIMENSION) return dataUrl

  const scale = MAX_IMAGE_DIMENSION / longest
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(image.width * scale)
  canvas.height = Math.round(image.height * scale)
  const context = canvas.getContext('2d')!
  // 先铺白底再画：canvas 默认全透明，PNG 透明区域经 JPEG 编码会变纯黑，
  // 截图带透明底时模型收到的会是一张黑卡
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.85)
}

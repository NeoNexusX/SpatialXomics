/**
 * 上游 PNG 的最小解码：magic bytes、IHDR 尺寸与 data URL。
 * 不依赖 canvas，所以在 jsdom 里也能用；附件管线的尺寸上限由调用方把关。
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

/** PNG magic bytes; also rejects an HTML SPA fallback answered with HTTP 200. */
export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 24 && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
}

/** Read width/height from the PNG IHDR chunk (no canvas needed, so it works in jsdom). */
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (!isPng(bytes)) throw new Error('Invalid PNG: missing signature or IHDR')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (!width || !height) throw new Error('Invalid PNG: zero dimensions')
  return { width, height }
}

/** Chunked base64 so a multi-hundred-KB image does not blow the argument limit. */
export function pngDataUrl(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return `data:image/png;base64,${btoa(binary)}`
}

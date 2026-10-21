/** 把 Blob 作为文件下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // Defer revocation: revoking synchronously can cancel the download in some
  // browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

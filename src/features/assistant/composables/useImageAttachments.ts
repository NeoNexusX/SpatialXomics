/** 输入框的待发送图片：添加（读取并压缩）、移除、发送时取走 */

import { ref } from 'vue'
import { fileToDataUrl, isSupportedImage } from '../utils/imageFile'

/** 单条消息图片数上限（dataURL 直接进请求体与 localStorage） */
const MAX_IMAGES_PER_MESSAGE = 4

export function useImageAttachments() {
  const images = ref<string[]>([])

  async function addFiles(files: File[]): Promise<void> {
    for (const file of files) {
      if (images.value.length >= MAX_IMAGES_PER_MESSAGE) break
      if (!isSupportedImage(file)) continue
      try {
        images.value.push(await fileToDataUrl(file))
      } catch {
        // 单个图片读取失败不阻塞其余
      }
    }
  }

  function remove(index: number): void {
    images.value.splice(index, 1)
  }

  function take(): string[] {
    const taken = images.value
    images.value = []
    return taken
  }

  return { images, addFiles, remove, take }
}

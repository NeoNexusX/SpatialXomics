/**
 * ctx.attachments 服务：聊天图片的保存、还原和展示地址。
 * 图片字节存在会话存储里，消息只保留引用。地址按存储缓存，会话关闭时释放。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { ChatMessage, ImageAttachment, ToolImage } from '../llm'
import type { SessionStorage } from '../session-persistence'

declare module '@deepseek-ai/cordis' {
  interface Context {
    attachments: Attachments
  }
}

export function readBlobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

export function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function saveImage(
  storage: SessionStorage,
  dataUrl: string,
): Promise<ImageAttachment> {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([\s\S]+)$/.exec(dataUrl)
  if (!match) throw new Error('Unsupported image attachment')
  const bytes = Uint8Array.from(atob(match[2]!), (char) => char.charCodeAt(0))
  const mime = match[1]!
  const id = await storage.putArtifact(new Blob([bytes], { type: mime }))
  return { id, mime, bytes: bytes.byteLength }
}

export async function hydrateImages(
  storage: SessionStorage,
  messages: ChatMessage[],
): Promise<ChatMessage[]> {
  return Promise.all(
    messages.map(async (message) => {
      if (message.role === 'assistant' || !message.attachments?.length) return message
      const images = await Promise.all(
        message.attachments.map(async (ref) => {
          try {
            const blob = await storage.getArtifact(ref.id)
            return await blobDataUrl(new Blob([blob], { type: ref.mime }))
          } catch (error) {
            throw new Error(
              `Image attachment ${ref.label ?? ref.id} is unavailable: ${String(error)}`,
            )
          }
        }),
      )
      return { ...message, images }
    }),
  )
}

/** Validate decoded size so base64 overhead does not change the file limit. */
export function validateToolImages(images: ToolImage[]): void {
  if (images.length < 1 || images.length > 4)
    throw new Error('Tools must return 1–4 image attachments')
  for (const [index, image] of images.entries()) {
    const match = /^data:(image\/(?:png|jpeg));base64,([\s\S]+)$/.exec(image.dataUrl)
    if (!match || match[1] !== image.mime) throw new Error(`Invalid tool image #${index + 1} MIME`)
    const data = atob(match[2]!)
    const png = data.startsWith('\x89PNG\r\n\x1a\n')
    const jpeg = data.startsWith('\xff\xd8\xff')
    if (
      !data.length ||
      data.length > 2 * 1024 * 1024 ||
      (image.mime === 'image/png' ? !png : !jpeg)
    )
      throw new Error(`Invalid tool image #${index + 1} file or size`)
    if (
      !Number.isSafeInteger(image.width) ||
      !Number.isSafeInteger(image.height) ||
      image.width <= 0 ||
      image.height <= 0
    )
      throw new Error(`Invalid tool image #${index + 1} dimensions`)
  }
}

interface UrlCache {
  loading: Map<string, Promise<string>>
  urls: Map<string, string>
}

export class Attachments extends Service {
  private caches = new WeakMap<SessionStorage, UrlCache>()

  constructor(ctx: Context) {
    super(ctx, 'attachments')
  }

  save(storage: SessionStorage, dataUrl: string): Promise<ImageAttachment> {
    return saveImage(storage, dataUrl)
  }

  async saveTools(
    storage: SessionStorage,
    images: ToolImage[],
    signal: AbortSignal,
  ): Promise<ImageAttachment[]> {
    if (!images.length) return []
    validateToolImages(images)
    const saved: ImageAttachment[] = []
    try {
      for (const image of images) {
        signal.throwIfAborted()
        const ref = await this.save(storage, image.dataUrl)
        saved.push({ ...ref, width: image.width, height: image.height, label: image.label })
      }
      signal.throwIfAborted()
      return saved
    } catch (error) {
      await Promise.allSettled(saved.map((ref) => storage.deleteArtifact(ref.id)))
      throw error
    }
  }

  /** 把消息里的图片引用换成请求要发的 dataURL */
  hydrate(storage: SessionStorage, messages: ChatMessage[]): Promise<ChatMessage[]> {
    return hydrateImages(storage, messages)
  }

  /** 已经加载好的展示地址 */
  urlOf(storage: SessionStorage, id: string): string | undefined {
    return this.caches.get(storage)?.urls.get(id)
  }

  /** 这张图片已经开始加载，或者已经加载好了 */
  requested(storage: SessionStorage, id: string): boolean {
    return this.caches.get(storage)?.loading.has(id) ?? false
  }

  load(storage: SessionStorage, id: string): Promise<string> {
    let cache = this.caches.get(storage)
    if (!cache) {
      cache = { loading: new Map(), urls: new Map() }
      this.caches.set(storage, cache)
    }
    const cached = cache.loading.get(id)
    if (cached) return cached
    const owner = cache
    const loading = storage.getArtifact(id).then(async (blob) => {
      const url =
        typeof URL.createObjectURL === 'function'
          ? URL.createObjectURL(blob)
          : await blobDataUrl(blob)
      if (this.caches.get(storage) !== owner) {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url)
        throw new Error('Conversation changed')
      }
      owner.urls.set(id, url)
      return url
    })
    owner.loading.set(id, loading)
    return loading
  }

  /** 会话关闭后释放它的展示地址，迟到的加载结果也会被丢弃 */
  release(storage: SessionStorage): void {
    const cache = this.caches.get(storage)
    if (!cache) return
    for (const url of cache.urls.values()) if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    this.caches.delete(storage)
  }
}

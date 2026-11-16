/** 内容块的通用处理，不依赖具体协议 */

import type { AssistantPart } from './types'

/**
 * 解析工具入参。不是合法的 JSON 对象时返回 undefined，原始文本仍然留在内容块里。
 * 空文本等于没有参数：有些端点对无参工具不发任何入参增量。
 */
export function parseToolArguments(raw: string): Record<string, unknown> | undefined {
  if (raw.trim() === '') return {}
  try {
    const value: unknown = JSON.parse(raw)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

/** 有正文或工具调用。只有思考的回复写进历史没有意义 */
export function hasDeliverableContent(parts: readonly AssistantPart[]): boolean {
  return parts.some(
    (part) => part.type === 'tool-call' || (part.type === 'text' && part.text.trim() !== ''),
  )
}

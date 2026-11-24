/**
 * 会话里工具附过的图：一份按事件顺序、按 id 去重的列表。
 *
 * 两处要用同一份顺序：agent-loop 把它写进 system prompt 的图片清单，
 * agent/runtime 把它交给界面解析 `session-artifact:` 引用。顺序一旦两边不一致，
 * 模型写的句柄就会指向别的图，所以只在这里推导，别处不要各自再算。
 */
import type { Session } from './session'
import type { ImageAttachment } from '../llm'

export function sessionFigures(session: Session): ImageAttachment[] {
  const seen = new Set<string>()
  const figures: ImageAttachment[] = []
  for (const event of session.events) {
    if (event.type !== 'message' || event.message.role !== 'tool') continue
    for (const ref of event.message.attachments ?? []) {
      if (seen.has(ref.id)) continue
      seen.add(ref.id)
      figures.push(ref)
    }
  }
  return figures
}

/** 模型在报告里写的句柄前缀，后面跟会话内的序号：`session-artifact:fig-12`。 */
export const FIGURE_HANDLE_PREFIX = 'fig-'

/**
 * 给第 index（0 基）张图的句柄。序号是它在会话图片列表里的位置，同一会话内稳定，
 * 存档重开后事件顺序不变，所以句柄也不变。
 */
export function figureHandle(index: number): string {
  return `${FIGURE_HANDLE_PREFIX}${index + 1}`
}

// 至少 8 个 hex 字符（连字符不算长度）：短于此就退回不显示，不猜
const UUID_PREFIX = /^(?=(?:[^0-9a-f]*[0-9a-f]){8})[0-9a-f-]+$/i

/**
 * 把模型写的句柄解析回图片 id。接受三种写法：
 * - `fig-N`：清单里给出的句柄，正常情况
 * - 完整 UUID：旧写法，仍然认
 * - UUID 前缀（至少 8 位）：模型抄长 id 时截断了。前缀在本会话内唯一才认，
 *   有歧义就当找不到，宁可不显示也不能显示错图。
 */
export function resolveFigureHandle(handle: string, figures: ImageAttachment[]): string | undefined {
  const value = handle.trim()
  if (/^fig-\d{1,4}$/i.test(value)) {
    const index = Number(value.slice(FIGURE_HANDLE_PREFIX.length)) - 1
    return figures[index]?.id
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return figures.some((figure) => figure.id === value) ? value : undefined
  }
  if (UUID_PREFIX.test(value)) {
    const matches = figures.filter((figure) => figure.id.toLowerCase().startsWith(value.toLowerCase()))
    return matches.length === 1 ? matches[0]!.id : undefined
  }
  return undefined
}

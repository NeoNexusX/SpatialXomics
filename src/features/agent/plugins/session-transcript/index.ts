/** 界面看到的对话：从会话日志折叠出来，流式中的内容单独叠加在上面 */

import type { Context } from '@deepseek-ai/cordis'
import type { AssistantPart } from '../llm'
import { addUsage, parseToolArguments } from '../llm'
import type { SessionEvent } from '../session'
import type { SessionProjectionDefinition } from '../session-projection'
import type { UiChatItem, UiPart } from './types'

export type * from './types'

export interface LiveAttempt {
  turnId: string
  attemptId: string
  parts: AssistantPart[]
  retrying?: { retry: number; maxRetries: number }
}

export interface TranscriptState {
  items: UiChatItem[]
  replies: Map<string, UiChatItem>
}

function appendParts(
  item: UiChatItem,
  parts: AssistantPart[],
  prefix: string,
  live: boolean,
): void {
  for (const [index, part] of parts.entries()) {
    if (live && part.type === 'tool-call') continue
    let rendered: UiPart
    if (part.type === 'tool-call')
      rendered = {
        type: 'tool',
        id: `${prefix}:${index}`,
        name: part.name,
        input: parseToolArguments(part.arguments) ?? {},
        state: 'running',
        preview: '',
      }
    else if (part.type === 'reasoning')
      rendered = { type: 'reasoning', text: part.text, active: live && index === parts.length - 1 }
    else rendered = { type: 'text', text: part.text }
    item.parts!.push(rendered)
  }
  item.content = item
    .parts!.filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n')
}

/** Apply one committed event to the human-visible conversation state. */
function applyTranscriptEvent(state: TranscriptState, event: SessionEvent): void {
  if (event.type === 'turn/start') {
    if (event.retryOf) {
      const superseded = new Set([event.retryOf, `${event.retryOf}-user`])
      state.items = state.items.filter((item) => !superseded.has(item.id))
      state.replies.delete(event.retryOf)
    }
    state.items.push({
      id: `${event.turnId}-user`,
      role: 'user',
      content: event.user.content,
      attachments: event.user.attachments,
    })
    const reply: UiChatItem = {
      id: event.turnId,
      role: 'assistant',
      content: '',
      parts: [],
      pending: true,
    }
    state.replies.set(event.turnId, reply)
    state.items.push(reply)
  }
  if (event.type === 'message') {
    if (!event.turnId || (event.surfaceOp !== undefined && event.surfaceOp !== 'append')) return
    const reply = state.replies.get(event.turnId)
    if (!reply) return
    if (event.message.role === 'assistant')
      appendParts(reply, event.message.parts, String(event.seq), false)
    if (event.message.role === 'tool') {
      const tool = reply.parts!.find((part) => part.type === 'tool' && part.id === event.callKey)
      if (tool?.type === 'tool') {
        tool.state = event.message.isError ? 'error' : 'done'
        tool.preview = event.message.content.slice(0, 1200)
        if (event.message.attachments?.length) tool.attachments = event.message.attachments
      }
    }
  }
  if (event.type === 'attempt/end' && event.usage) {
    const reply = state.replies.get(event.turnId)
    if (reply) reply.usage = addUsage(reply.usage, event.usage)
  }
  if (event.type === 'turn/end') {
    const reply = state.replies.get(event.turnId)
    if (reply) {
      reply.pending = false
      reply.interrupted = event.reason === 'interrupted'
      reply.error = event.error
      for (const part of reply.parts!)
        if (part.type === 'tool' && part.state === 'running') part.state = 'stopped'
    }
  }
  if (
    event.type === 'compaction/end' &&
    (event.error || event.beforeTokens !== event.afterTokens)
  ) {
    const marker: UiChatItem = {
      id: event.id,
      role: 'assistant',
      content: '',
      compacted: true,
      error: event.error,
    }
    const active = state.items.findIndex((item) => item.pending)
    state.items.splice(active < 0 ? state.items.length : active, 0, marker)
  }
}

/** Plugin-owned projection for the human-visible conversation transcript. */
export const transcriptProjection: SessionProjectionDefinition<TranscriptState, UiChatItem[]> = {
  key: 'transcript',
  init: () => ({ items: [], replies: new Map() }),
  apply: (state, event) => {
    applyTranscriptEvent(state, event)
    return state
  },
  view: (state) => state.items,
}

export const name = 'session-transcript'
export const inject = ['sessionProjections']

export function apply(ctx: Context) {
  ctx.effect(() => ctx.sessionProjections.register(transcriptProjection))
}

export function withLiveTranscript(items: UiChatItem[], live?: LiveAttempt): UiChatItem[] {
  if (!live) return items
  return items.map((item) => {
    if (item.id !== live.turnId) return item
    const reply = { ...item, parts: [...(item.parts ?? [])] }
    appendParts(reply, live.parts, live.attemptId, true)
    reply.retrying = live.retrying
    return reply
  })
}

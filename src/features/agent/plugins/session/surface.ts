import type { ChatMessage } from '../llm'
import { eventMessage, type SessionEvent } from './types'

/** 每条消息之后，所有工具调用是否都等到了结果：只有这些位置能切开历史 */
export function balancedEnds(messages: ChatMessage[]): boolean[] {
  const open = new Set<string>()
  return messages.map((message) => {
    if (message.role === 'assistant')
      for (const part of message.parts)
        if (part.type === 'tool-call') {
          if (open.has(part.id)) throw new Error('Duplicate open tool call')
          open.add(part.id)
        }
    if (message.role === 'tool' && !open.delete(message.toolCallId))
      throw new Error('Unpaired tool result')
    return open.size === 0
  })
}

function assertBalanced(messages: ChatMessage[]): void {
  if (!balancedEnds(messages).every((_, i, ends) => i < ends.length - 1 || ends[i]))
    throw new Error('Replacement crosses a tool pair')
}

/**
 * Incremental surface fold. One event enters, one state transition leaves.
 * `clone()` makes commit planning atomic without replaying the whole log.
 */
export class SurfaceFold {
  nodes: number[] = []
  private turn: string | undefined
  private step: number | undefined
  private attempt: string | undefined
  private calls = new Map<string, { id: string; name: string }>()
  private dispatched = new Set<string>()
  private compactions = new Set<string>()

  clone(): SurfaceFold {
    const copy = new SurfaceFold()
    copy.nodes = [...this.nodes]
    copy.turn = this.turn
    copy.step = this.step
    copy.attempt = this.attempt
    copy.calls = new Map(this.calls)
    copy.dispatched = new Set(this.dispatched)
    copy.compactions = new Set(this.compactions)
    return copy
  }

  push(event: SessionEvent, log: readonly SessionEvent[]): void {
    if (event.type === 'turn/start') {
      if (this.turn !== undefined || JSON.stringify(event.baseSurface) !== JSON.stringify(this.nodes))
        throw new Error('Invalid turn boundary')
      this.turn = event.turnId
    } else if ('turnId' in event && event.turnId !== undefined && event.turnId !== this.turn)
      throw new Error('Event belongs to a closed turn')
    if (event.type === 'step/start') {
      if (this.step !== undefined || this.attempt !== undefined)
        throw new Error('Step is already active')
      this.step = event.step
    }
    if (event.type === 'attempt/start') {
      if (
        this.attempt !== undefined ||
        event.step !== this.step ||
        JSON.stringify(event.request.nodes) !== JSON.stringify(this.nodes)
      )
        throw new Error('Invalid request boundary')
      this.attempt = event.attemptId
    }
    if (event.type === 'attempt/end') {
      if (this.attempt !== event.attemptId) throw new Error('Invalid attempt settlement')
      this.attempt = undefined
    }
    if (event.type === 'message') {
      if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') {
        const start = this.nodes.indexOf(event.surfaceOp.nodes[0] ?? -1)
        if (
          start < 0 ||
          event.surfaceOp.nodes.length === 0 ||
          event.surfaceOp.nodes.some((seq, index) => this.nodes[start + index] !== seq)
        )
          throw new Error('Invalid surface replacement')
        if (event.surfaceReason === 'summary')
          assertBalanced(event.surfaceOp.nodes.map((seq) => eventMessage(log[seq]!)!))
        this.nodes.splice(start, event.surfaceOp.nodes.length, event.seq)
        return
      }
      if (event.message.role === 'assistant')
        event.message.parts.forEach((part, index) => {
          if (part.type === 'tool-call')
            this.calls.set(`${event.seq}:${index}`, { id: part.id, name: part.name })
        })
      if (event.message.role === 'tool') {
        const call = this.calls.get(event.callKey ?? '')
        if (!call || call.id !== event.message.toolCallId || call.name !== event.message.name)
          throw new Error('Tool result has no matching call')
        this.calls.delete(event.callKey!)
      }
      this.nodes.push(event.seq)
    }
    if (event.type === 'tool/start') {
      if (!this.calls.has(event.callKey) || this.dispatched.has(event.callKey))
        throw new Error('Invalid tool dispatch')
      this.dispatched.add(event.callKey)
    }
    if (event.type === 'step/end') {
      if (event.step !== this.step || this.attempt || this.calls.size)
        throw new Error('Step closed before settlement')
      this.step = undefined
    }
    if (event.type === 'turn/end') {
      if (this.step !== undefined || this.attempt || this.calls.size)
        throw new Error('Turn closed before settlement')
      this.turn = undefined
    }
    if (event.type === 'surface/reset') {
      if (
        this.turn ||
        new Set(event.nodes).size !== event.nodes.length ||
        event.nodes.some((seq) => seq >= event.seq || !log[seq] || !eventMessage(log[seq]!))
      )
        throw new Error('Invalid history reset')
      assertBalanced(event.nodes.map((seq) => eventMessage(log[seq]!)!))
      this.nodes = [...event.nodes]
    }
    if (event.type === 'compaction/start') {
      if (this.compactions.size) throw new Error('Compaction already active')
      this.compactions.add(event.compactionId)
    }
    if (event.type === 'compaction/end' && !this.compactions.delete(event.compactionId))
      throw new Error('Invalid compaction settlement')
  }
}

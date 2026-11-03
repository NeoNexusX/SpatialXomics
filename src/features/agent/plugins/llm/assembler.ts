/**
 * 把分片增量组装成内容块。循环边转发增量边喂给它，流结束后取结果；
 * 被用户中断时取 interruptedBlocks()。
 *
 * 容忍只有 delta、没有 block-start/block-end 的流；已被 block-end 关闭的块不再接受迟到的
 * 分片，行为不正常的适配器不能让内存增长，也不能改写已完成的块。
 */

import type { AssistantPart, FinishReason, ReplayEnvelope, StreamChunk, TokenUsage } from './types'

interface PartialBlock {
  blockType: AssistantPart['type']
  text: string
  toolCallId?: string
  toolCallName?: string
  toolCallArguments: string
  /** block-end 给出的完整块；第一次关闭为准 */
  block?: AssistantPart
}

export class BlockAssembler {
  private partials = new Map<number, PartialBlock>()
  private order: number[] = []
  private lastUsage: TokenUsage | undefined
  private finishReason: FinishReason | undefined
  private replay: ReplayEnvelope | undefined

  push(chunk: StreamChunk): void {
    switch (chunk.type) {
      case 'block-start':
        this.ensure(chunk.index, chunk.blockType)
        return
      case 'text-delta':
      case 'reasoning-delta': {
        const partial = this.ensure(chunk.index, chunk.type === 'text-delta' ? 'text' : 'reasoning')
        if (!partial.block) partial.text += chunk.text
        return
      }
      case 'tool-call-delta': {
        const partial = this.ensure(chunk.index, 'tool-call')
        if (partial.block) return
        partial.toolCallId = chunk.id || partial.toolCallId
        if (chunk.name) partial.toolCallName = chunk.name
        partial.toolCallArguments += chunk.argumentsDelta
        return
      }
      case 'block-end': {
        const partial = this.ensure(chunk.index, chunk.block.type)
        partial.block ??= chunk.block
        return
      }
      case 'usage':
        this.lastUsage = chunk.usage
        return
      case 'finish':
        this.finishReason = chunk.reason
        this.replay = chunk.replayState
        return
    }
  }

  private ensure(index: number, blockType: AssistantPart['type']): PartialBlock {
    let partial = this.partials.get(index)
    if (!partial) {
      partial = { blockType, text: '', toolCallArguments: '' }
      this.partials.set(index, partial)
      this.order.push(index)
    }
    return partial
  }

  private assemble(index: number): AssistantPart {
    const partial = this.partials.get(index)!
    if (partial.block) return partial.block
    switch (partial.blockType) {
      case 'text':
        return { type: 'text', text: partial.text }
      case 'reasoning':
        return { type: 'reasoning', text: partial.text }
      case 'tool-call':
        return {
          type: 'tool-call',
          id: partial.toolCallId ?? `call-${index}`,
          name: partial.toolCallName ?? '',
          arguments: partial.toolCallArguments,
        }
    }
  }

  /**
   * 对所有块唯一的去留决定：达到输出上限时工具入参可能不完整，工具调用不能执行。
   * 内容块和回放元数据都从这里得出，两者不会对不上。
   */
  private assembled(): { blocks: AssistantPart[]; replay: ReplayEnvelope | undefined } {
    const all = this.order.map((index) => this.assemble(index))
    const kept =
      this.finish.kind === 'max-tokens' ? all.map((block) => block.type !== 'tool-call') : undefined
    const blocks = kept ? all.filter((_, position) => kept[position]) : all
    const envelope = this.replay
    if (envelope?.blocks === undefined) return { blocks, replay: envelope }
    if (envelope.blocks.length !== all.length) return { blocks, replay: undefined }
    return {
      blocks,
      replay:
        !kept || blocks.length === all.length
          ? envelope
          : {
              response: envelope.response,
              blocks: envelope.blocks.filter((_, position) => kept[position]),
            },
    }
  }

  /** 目前为止的所有块，按流的顺序。没关闭的块用累积的增量组装 */
  blocks(): AssistantPart[] {
    return this.assembled().blocks
  }

  /**
   * 被中断的流能安全保留的部分：有内容的正文和思考块。
   * 工具调用不要：中断发生在执行之前，留下它就得编造一个结果。
   */
  interruptedBlocks(): AssistantPart[] {
    return this.order
      .map((index) => this.assemble(index))
      .filter(
        (block) =>
          (block.type === 'text' || block.type === 'reasoning') && block.text.trim() !== '',
      )
  }

  /** 最后一个 usage 分片 */
  get usage(): TokenUsage | undefined {
    return this.lastUsage
  }

  /** 结束原因；流还没结束时是 stop */
  get finish(): FinishReason {
    return this.finishReason ?? { kind: 'stop' }
  }

  /** 与 blocks() 同步裁剪过的回放元数据；条目和块对不上时没有 */
  get replayState(): ReplayEnvelope | undefined {
    return this.assembled().replay
  }
}

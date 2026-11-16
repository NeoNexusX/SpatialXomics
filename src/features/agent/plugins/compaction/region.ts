/**
 * 选出要压缩的区间，把它换成一条 checkpoint。
 *
 * 只替换模型能看到的消息列表：会话日志只追加，原始消息和附件都还在，界面仍显示完整对话。
 * 模型之后只能看到摘要，这段原文模型拿不回来。
 */

import type { ChatMessage, PreparedLlmCall, TokenUsage, ToolSchema } from '../llm'
import { balancedEnds, type Session } from '../session'
import { newId } from '../session-persistence'
import { estimateMessage, estimateRequest, measureContext } from '../token-meter'
import { headroomTokens } from './policy'
import { checkpointMessage, COMPACTION_INSTRUCTION, streamSummary, summaryOf } from './summarizer'

const sumTokens = (messages: ChatMessage[]) =>
  messages.reduce((total, message) => total + estimateMessage(message), 0)

export interface RegionRequest {
  session: Session
  system: string
  tools: ToolSchema[]
  contextWindow: number
  /** 从末尾起至少逐字保留这么多 token 的内容 */
  retainTokens: number
  /** 这一轮的消息不动 */
  protectedTurn?: string
}

/**
 * 选出最旧的一段：保留最近的内容，不动受保护的轮次，不拆开工具调用和它的结果，
 * 摘要请求本身也要放得进窗口。
 * @returns 要压缩表层最前面的多少个节点；0 表示没有值得压缩的内容
 */
export function selectRegion(request: RegionRequest): number {
  const { session, system, tools, contextWindow, retainTokens, protectedTurn } = request
  const nodes = session.nodes
  const messages = session.deriveMessages()
  const balanced = balancedEnds(messages)

  let count = nodes.length
  let kept = 0
  while (count > 0) {
    kept += estimateMessage(messages[--count]!)
    if (kept >= retainTokens) break
  }
  if (protectedTurn !== undefined) {
    const protectedIndex = nodes.findIndex((seq) => {
      const event = session.events[seq]!
      return 'turnId' in event && event.turnId === protectedTurn
    })
    if (protectedIndex >= 0) count = Math.min(count, protectedIndex)
  }
  while (count > 0 && !balanced[count - 1]) count--

  const outputReserve = headroomTokens(contextWindow)
  while (
    count > 0 &&
    measureContext(
      system,
      tools,
      [...messages.slice(0, count), COMPACTION_INSTRUCTION],
      contextWindow,
      outputReserve,
    ).ratio > 1
  ) {
    count--
    while (count > 0 && !balanced[count - 1]) count--
  }
  if (count === 0) return 0

  // 只剩一条 checkpoint，或者内容还没有 checkpoint 的外壳长，摘要都不可能更短，不发请求
  const first = session.events[nodes[0]!]!
  if (count === 1 && first.type === 'message' && first.surfaceReason === 'summary') return 0
  if (sumTokens(messages.slice(0, count)) <= estimateMessage(checkpointMessage(''))) return 0
  return count
}

export interface CompactRegionOptions {
  session: Session
  system: string
  tools: ToolSchema[]
  /** selectRegion 选出的节点数 */
  count: number
  signal: AbortSignal
  prepareSummary(): Promise<PreparedLlmCall>
  hydrate(messages: ChatMessage[]): Promise<ChatMessage[]>
}

/**
 * 压缩表层最前面的 count 个节点。全程记在 compaction/start 和 compaction/end 之间，
 * 摘要、替换和结束标记在同一批提交里，任何失败都不会改变模型看到的内容。
 */
export async function compactRegion(options: CompactRegionOptions): Promise<void> {
  const { session, system, tools, count, signal } = options
  const nodes = session.nodes.slice(0, count)
  const messages = session.deriveMessages(nodes)
  const beforeTokens = estimateRequest(system, tools, session.deriveMessages())
  const compactionId = newId()
  await session.commit([{ type: 'compaction/start', compactionId, nodes }])
  let usage: TokenUsage | undefined
  try {
    const call = await options.prepareSummary()
    const assembler = await streamSummary({
      call,
      system,
      tools,
      messages,
      signal,
      hydrate: options.hydrate,
    })
    signal.throwIfAborted()
    usage = assembler.usage
    const summary = summaryOf(assembler)
    const replacement = checkpointMessage(summary)
    const shadowedTokens = sumTokens(messages)
    if (estimateMessage(replacement) >= shadowedTokens)
      throw new Error('Compaction did not reduce context')
    await session.commit([
      {
        type: 'compaction/summary',
        compactionId,
        summary,
        route: {
          endpoint: call.connection.endpoint,
          baseUrl: call.connection.baseUrl,
          model: call.connection.model,
        },
        maxTokens: call.maxTokens,
      },
      {
        type: 'message',
        surfaceOp: { op: 'replace', nodes },
        surfaceReason: 'summary',
        message: replacement,
      },
      {
        type: 'compaction/end',
        compactionId,
        usage,
        beforeTokens,
        afterTokens: beforeTokens - shadowedTokens + estimateMessage(replacement),
      },
    ])
  } catch (error) {
    if (!session.hasUnstoredBatch)
      await session.commit([
        {
          type: 'compaction/end',
          compactionId,
          usage,
          error: error instanceof Error ? error.message : String(error),
        },
      ])
    throw error
  }
}

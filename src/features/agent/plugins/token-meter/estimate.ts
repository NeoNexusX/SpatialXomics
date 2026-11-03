import type { ChatMessage, ToolSchema } from '../llm'

export interface ContextPressure {
  inputTokens: number
  contextWindow: number
  outputReserve: number
  inputBudget: number
  ratio: number
  estimated: boolean
}

/** CJK and punctuation are denser than Latin text. All structural content is priced. */
export function estimateText(text: string): number {
  let dense = 0
  let latin = 0
  for (const char of text) {
    if (char.codePointAt(0)! > 0x2ff) dense++
    else latin++
  }
  return dense + Math.ceil(latin / 3)
}

export function estimateMessage(message: ChatMessage): number {
  if (message.role === 'assistant')
    return (
      8 +
      message.parts.reduce(
        (total, part) =>
          total +
          estimateText(part.type === 'tool-call' ? `${part.name}\n${part.arguments}` : part.text) +
          4,
        0,
      )
    )
  const images = message.attachments?.length
    ? message.attachments.reduce((sum, ref) => sum + (ref.width && ref.height
      ? Math.ceil(ref.width * ref.height / 750) + 85 : 3200), 0)
    : (message.images?.length ?? 0) * 3200
  return 8 + estimateText(message.content) + images
}

/** 系统提示词、工具 schema 和协议开销：消息之外每次请求都要付的部分 */
export function estimateOverhead(system: string, tools: readonly unknown[]): number {
  return estimateText(system) + estimateText(JSON.stringify(tools)) + 16
}

/** 一次请求的输入估算 */
export function estimateRequest(
  system: string,
  tools: ToolSchema[],
  messages: ChatMessage[],
): number {
  return (
    estimateOverhead(system, tools) +
    messages.reduce((sum, message) => sum + estimateMessage(message), 0)
  )
}

/** 留给输入的预算：窗口减去输出预留，再留一点估算误差的余量 */
export function inputBudgetOf(contextWindow: number, outputReserve: number): number {
  return contextWindow - outputReserve - Math.max(128, Math.ceil(contextWindow * 0.02))
}

export function measureContext(
  system: string,
  tools: ToolSchema[],
  messages: ChatMessage[],
  contextWindow: number,
  outputReserve: number,
): ContextPressure {
  const inputTokens = estimateRequest(system, tools, messages)
  const inputBudget = inputBudgetOf(contextWindow, outputReserve)
  if (inputBudget <= 0)
    throw new Error(
      'Output reservation leaves no input context. Increase this model limit in settings.',
    )
  return {
    inputTokens,
    contextWindow,
    outputReserve,
    inputBudget,
    ratio: inputTokens / inputBudget,
    estimated: true,
  }
}

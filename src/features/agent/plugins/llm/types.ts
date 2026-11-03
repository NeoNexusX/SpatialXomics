/**
 * 模型通信的协议中立类型：循环、工具和界面都只认这些类型，
 * 具体协议的请求与响应格式由适配器插件转换。
 */

import type { EndpointType, ResolvedConnection, ResolvedEndpoint } from '../connection'
import type { ResolvedRetryPolicy } from './retryPolicy'

/**
 * 多模态探测结果。
 * - unavailable：端点有回应但测不出结论（配额、下线等），不等于不支持图片
 * - no-response：没拿到完整响应（断网，或页面离开时请求被浏览器取消），不算测过
 */
export type VisionProbeResult = 'vision' | 'no-vision' | 'unavailable' | 'no-response'

/** 模型回复的内容块，顺序与模型返回的一致，回传时不能打乱 */
export type AssistantPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | {
      type: 'tool-call'
      id: string
      name: string
      /** 模型生成的原始 JSON 文本，可能不合法，用 parseToolArguments 解析 */
      arguments: string
    }

/** 适配器私有的回放元数据（如思考块签名），上层只负责原样保存。blocks 与内容块按位置对应 */
export interface ReplayEnvelope {
  response: unknown
  blocks?: readonly unknown[]
}

/** 生成这条模型回复的路由 */
export interface AssistantSource {
  endpoint: EndpointType
  model: string
  baseUrl?: string
  replayState?: ReplayEnvelope
}

export interface ImageAttachment {
  id: string
  mime: string
  bytes: number
  width?: number
  height?: number
  label?: string
}

export interface ToolImage {
  dataUrl: string
  mime: 'image/png' | 'image/jpeg'
  width: number
  height: number
  label?: string
}

export interface UserMessage {
  role: 'user'
  content: string
  /** 附带的图片（多模态）：base64 dataURL（`data:image/png;base64,…`） */
  images?: string[]
  attachments?: ImageAttachment[]
}

export interface AssistantMessage {
  role: 'assistant'
  parts: AssistantPart[]
  /** Recorded route and adapter-owned replay metadata. Summaries have no replay state. */
  source?: AssistantSource
}

export interface ToolMessage {
  role: 'tool'
  toolCallId: string
  name: string
  content: string
  isError?: boolean
  attachments?: ImageAttachment[]
  /** Request-only data, never persisted. */
  images?: string[]
}

export type ChatMessage = UserMessage | AssistantMessage | ToolMessage

/** 供 LLM function calling 的 JSON Schema 参数描述 */
export interface JsonSchemaObject {
  type: 'object'
  properties: Record<string, Record<string, unknown>>
  required?: string[]
}

/** 注册进 LLM tools 字段的工具描述 */
export interface ToolSchema {
  name: string
  description: string
  parameters: JsonSchemaObject
}

/** 一次模型调用失败的事实，可序列化。按 code 路由，不要解析 message（code 见 llm/error.ts） */
export interface LlmFailure {
  readonly message: string
  readonly code: string
  /** HTTP 状态码（请求没有得到响应时没有） */
  readonly status?: number
  /** 端点通过 Retry-After 要求等待的毫秒数 */
  readonly providerRetryAfterMs?: number
  /** 端点给这次请求的 id，向对方报问题时要用 */
  readonly requestId?: string
}

/** 一次模型调用的 token 用量。inputTokens 不含缓存读写，总输入要加上后两者 */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  /** Provider total input, including cache buckets when known. */
  promptTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/** 一次模型调用的结束原因。max-tokens = 达到输出上限；refusal = 模型或安全策略拒绝回答 */
export type FinishReason =
  | { kind: 'stop' }
  | { kind: 'tool-calls' }
  | { kind: 'max-tokens' }
  | { kind: 'refusal' }
  | { kind: 'aborted'; failure: LlmFailure }
  | { kind: 'error'; failure: LlmFailure }

/**
 * LLM 流式输出的统一分片（适配器产出，循环经 BlockAssembler 组装）。
 *
 * 约定：index 标识内容块，一条流恰好以一个 finish 结束，usage 在 finish 之前。
 * block-start、block-end 可以缺省，只有 delta 也能组装出完整的块。
 */
export type StreamChunk =
  | { type: 'block-start'; index: number; blockType: AssistantPart['type'] }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: string; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: AssistantPart }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: FinishReason; replayState?: ReplayEnvelope }

export interface GenerateOptions {
  system?: string
  messages: ChatMessage[]
  tools?: ToolSchema[]
  maxTokens?: number
  /** Index of the actual user question, independent of injected context roles. */
  turnStart?: number
  onCompatibility?: (strategy: { replay: string; thinking: string }) => Promise<void>
}

export type ModelModality = 'text' | 'image'

/** 端点模型列表里的一个模型。各项事实都是端点声明的，没声明就是不知道 */
export interface DiscoveredModel {
  id: string
  /** 上下文窗口（token） */
  contextWindow?: number
  /** 单次输出上限（token） */
  maxTokens?: number
  inputModalities?: ModelModality[]
}

/** 一个确切模型已知的事实。没有的字段表示不知道，不等于不支持 */
export interface LlmResolvedModelInfo {
  endpoint: EndpointType
  id: string
  /** 明确不含 image 时拒绝准备 Agent 请求 */
  inputModalities?: readonly ModelModality[]
  context?: { contextWindow: number }
  /** 请求没有指定输出上限时用这个值 */
  defaultMaxTokens?: number
}

/**
 * 绑定了连接、模型事实和重试策略的一次调用，只能发出一次。
 * 一个回合可能跨越好几步，用户可以中途改设置，这样每次请求用到的都是同一组事实。
 */
export interface PreparedLlmCall {
  readonly connection: ResolvedConnection
  readonly model: LlmResolvedModelInfo
  readonly maxTokens: number
  readonly retryPolicy: ResolvedRetryPolicy
  /** New one-shot dispatch bound to the same adapter, model facts and controls. */
  again(): PreparedLlmCall
  stream(options: GenerateOptions, signal: AbortSignal): AsyncIterable<StreamChunk>
}

/** LLM 适配器：一种端点协议一个实现，由适配器插件经 ctx.llm.registerAdapter 注册 */
export interface LlmAdapter {
  readonly endpoint: EndpointType
  /** 这种协议的重试策略，注册时读取一次；缺省用默认策略 */
  retryPolicy?(): ResolvedRetryPolicy | undefined
  /** 解析一个确切模型的事实；缺省时什么都不知道 */
  resolveModel?(connection: ResolvedConnection, signal?: AbortSignal): Promise<LlmResolvedModelInfo>
  stream(
    options: GenerateOptions,
    connection: ResolvedConnection,
    signal: AbortSignal,
  ): AsyncIterable<StreamChunk>
  /** 询问端点公布的模型列表，顺序与端点返回的一致；失败时抛 LlmError */
  listModels(endpoint: ResolvedEndpoint, signal?: AbortSignal): Promise<DiscoveredModel[]>
  /** 发一张小图验证模型能看懂图片 */
  probeVision(connection: ResolvedConnection, signal?: AbortSignal): Promise<VisionProbeResult>
}

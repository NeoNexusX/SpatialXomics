/**
 * Anthropic Messages 协议适配器（POST {baseUrl}/messages），以 cordis 插件的形式注册进 ctx.llm。
 *
 * 只认协议、不限模型：任何提供 /v1/messages 的端点都走这里，模型名由用户决定。
 * 这个插件是项目里唯一直接依赖 AI SDK 的地方。
 *
 * 各家端点对思考块的要求并不一致，这里不按模型名猜，而是先按标准方式发送，
 * 收到能识别的 400 后修正请求重试，并按「地址 + 模型」记住修正结果（见 EndpointBehavior）。
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import {
  APICallError,
  jsonSchema,
  NoOutputGeneratedError,
  StreamProviderError,
  streamText,
  type AssistantContent,
  type FinishReason as SdkFinishReason,
  type LanguageModelUsage,
  type ModelMessage,
  type TextStreamPart,
  type ToolSet,
} from 'ai'
import type { Context } from '@deepseek-ai/cordis'
import type {
  AssistantMessage,
  AssistantPart,
  ChatMessage,
  DiscoveredModel,
  FinishReason,
  GenerateOptions,
  LlmAdapter,
  LlmFailure,
  LlmResolvedModelInfo,
  ReplayEnvelope,
  StreamChunk,
  TokenUsage,
  ToolSchema,
  UserMessage,
  VisionProbeResult,
} from '../llm'
import type { ResolvedConnection, ResolvedEndpoint } from '../connection'
import {
  MAX_OUTPUT_TOKENS,
  parseToolArguments,
  assertUsableApiKey,
  errorChain,
  isContextWindowExceededError,
  isQuotaExceededError,
  LlmCode,
  LlmError,
  normalizeLlmFailure,
  ModelListingCache,
  parseModelListing,
  type ModelListingCacheOptions,
  nextRetryDelayMs,
  resolveRetryPolicy,
  waitForRetry,
  type ResolvedRetryPolicy,
  type RetryPolicyConfig,
} from '../llm'
import { endpointKey, devRelayFetch } from '../connection'
import { getConfig } from '@/shared/config/runtimeConfig'

/** 模型流多久没有任何事件算超时。心跳事件算活动，但有的端点用 SSE 注释做心跳，SDK 看不到，
 *  长时间思考时可能真的什么都收不到，所以要留够 */
const LLM_STREAM_IDLE_TIMEOUT_MS = 600_000

const OFFICIAL_HOST = 'api.anthropic.com'
const ANTHROPIC_VERSION = '2023-06-01'
/** 官方 API 要求浏览器直连时显式带上这个头，SDK 不会自动加 */
const BROWSER_ACCESS_HEADERS = { 'anthropic-dangerous-direct-browser-access': 'true' }
/** 支持服务端拒绝回退的模型 */
const FALLBACK_MODELS = /^claude-(fable-5|opus-5|sonnet-5-5)/
/** 端点不接受 adaptive 时改用固定预算的思考参数 */
const THINKING_BUDGET_TOKENS = 8_000
/** 没有签名的思考块回传时的占位值；端点没发签名说明它不校验 */
const UNSIGNED_THINKING = 'unsigned'
/** 一次调用里修正请求后重试的次数上限 */
const MAX_BEHAVIOR_RETRIES = 3
/** 回放元数据的类型和版本；对不上的元数据不使用，只回传内容 */
const REPLAY_KIND = 'anthropic-messages'
const REPLAY_VERSION = 1

/** 多模态探测用的小图：64×64 的纯绿 PNG。问它是什么颜色，答对才算真的看到了图 */
const PROBE_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAATUlEQVR42u3PQQkAAAgEsItoWANeBN/CYAWW7PwmICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHApKcZA8Z+mQqwAAAAASUVORK5CYII='
const PROBE_QUESTION = 'What color is this image? Reply with one word.'
const PROBE_ANSWER = /green|绿/i
const PROBE_TIMEOUT_MS = 45_000
/** 思考也计入输出上限，给小了可能只有思考没有回答 */
const PROBE_MAX_TOKENS = 512
/** 并发探测容易撞上限流和网关抖动。断网不重试：可能只是页面正在离开 */
const PROBE_RETRY: RetryPolicyConfig = {
  maxRetries: 2,
  retryableCodes: [LlmCode.RATE_LIMIT, LlmCode.SERVER],
  backoff: { initialDelayMs: 2_000, maxDelayMs: 10_000 },
}

// ---- 端点行为 ----

/**
 * 端点在思考块上的实际要求，靠报错学习。
 * - replay：历史里的思考块怎么回传
 *   - verbatim：原样回传（默认，也是各家文档的要求）
 *   - fill-missing：原样回传，并给没有思考块的 assistant 消息补一个空块
 *     （DeepSeek 等要求带 tools 的请求里每条 assistant 消息都有思考块）
 *   - current-turn：只回传当前回合的。历史只在回合边界修改，当前回合的签名总是有效
 *   - omit：全部不回传（官方文档给出的最后手段）
 * - thinking：请求里的 thinking 参数形式
 */
export interface EndpointBehavior {
  replay: 'verbatim' | 'fill-missing' | 'current-turn' | 'omit'
  thinking: 'adaptive' | 'budget'
}

const DEFAULT_BEHAVIOR: EndpointBehavior = { replay: 'verbatim', thinking: 'adaptive' }

/**
 * 根据 400 的错误消息决定怎么修正。返回 null 表示这个错误修正不了，原样报给用户。
 * 错误文案举例：
 * - The `content[].thinking` in the thinking mode must be passed back to the API.
 * - Missing `reasoning_content` field in the assistant message at message index 3
 * - Invalid `signature` in `thinking` block. The block is bound to a different conversation.
 * - thinking.type: Input should be 'enabled' or 'disabled'
 */
export function adjustBehavior(
  behavior: EndpointBehavior,
  errorMessage: string,
): EndpointBehavior | null {
  const message = errorMessage.toLowerCase()
  if (/signature/.test(message) || /different conversation/.test(message)) {
    if (behavior.replay === 'verbatim' || behavior.replay === 'fill-missing') {
      return { ...behavior, replay: 'current-turn' }
    }
    return behavior.replay === 'current-turn' ? { ...behavior, replay: 'omit' } : null
  }
  if (/thinking/.test(message) && /adaptive|display|thinking\.type|budget_tokens/.test(message)) {
    return behavior.thinking === 'adaptive' ? { ...behavior, thinking: 'budget' } : null
  }
  const requiresThinking =
    /(thinking|reasoning_content)\b.*(passed back|missing|required)/.test(message) ||
    /missing\b.*(thinking|reasoning_content)/.test(message)
  if (requiresThinking) {
    return behavior.replay === 'verbatim' ? { ...behavior, replay: 'fill-missing' } : null
  }
  return null
}

// ---- 请求转换 ----

function userContent(message: UserMessage) {
  if (!message.images?.length) return message.content
  return [
    // 官方 API 不接受空文本块，纯图片消息不带 text
    ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
    ...message.images.map((dataUrl) => {
      const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl)
      return {
        type: 'file' as const,
        mediaType: match?.[1] ?? 'image/png',
        data: match?.[2] ?? dataUrl,
      }
    }),
  ]
}

/** 一个内容块的回放元数据 */
interface ReplayBlock {
  type: AssistantPart['type']
  signature?: string
  redactedData?: string
}

/**
 * 读取一条历史消息的回放元数据。元数据不可用时只放弃元数据，内容照常回传。
 * 签名绑定生成它的模型，换了模型不能再用。
 * @returns 与内容块按位置对应的元数据；来自别的模型、别的协议或已损坏时为 undefined
 */
function readReplay(
  message: AssistantMessage,
  model: string | undefined,
  onDegrade: ((reason: string) => void) | undefined,
  baseUrl?: string,
): ReplayBlock[] | undefined {
  const source = message.source
  const envelope = source?.replayState
  if (!source || !envelope || (source.baseUrl && baseUrl && source.baseUrl !== baseUrl))
    return undefined
  const fail = (reason: string) => {
    onDegrade?.(reason)
    return undefined
  }
  const response = envelope.response as {
    kind?: unknown
    version?: unknown
    model?: unknown
  } | null
  if (response?.kind !== REPLAY_KIND || response.version !== REPLAY_VERSION) {
    return fail('unsupported kind or version')
  }
  if (response.model !== source.model) return fail('model does not match the message source')
  const blocks = envelope.blocks
  if (!Array.isArray(blocks) || blocks.length !== message.parts.length) {
    return fail('block count mismatch')
  }
  for (const [index, value] of blocks.entries()) {
    const block = value as ReplayBlock | null
    if (block?.type !== message.parts[index]!.type) return fail('block type mismatch')
    if (
      block.type !== 'reasoning' &&
      (block.signature !== undefined || block.redactedData !== undefined)
    ) {
      return fail('metadata on a block that cannot carry it')
    }
    if (block.signature !== undefined && typeof block.signature !== 'string') {
      return fail('invalid signature')
    }
    if (block.redactedData !== undefined && typeof block.redactedData !== 'string') {
      return fail('invalid redacted data')
    }
  }
  return model === undefined || response.model === model ? (blocks as ReplayBlock[]) : undefined
}

function reasoningContent(text: string, replay?: ReplayBlock) {
  // SDK 会丢弃既没有签名也没有 redactedData 的思考块，这里补上占位值，文本才能回传
  const anthropic: Record<string, string> =
    replay?.signature != null || replay?.redactedData != null
      ? {
          ...(replay.signature != null ? { signature: replay.signature } : {}),
          ...(replay.redactedData != null ? { redactedData: replay.redactedData } : {}),
        }
      : { signature: UNSIGNED_THINKING }
  return { type: 'reasoning' as const, text, providerOptions: { anthropic } }
}

/** 历史入参不合法时回传空对象：协议要求对象，调用 id、工具名和结果都要保留 */
function toolInput(raw: string): Record<string, unknown> {
  return parseToolArguments(raw) ?? {}
}

function agentContent(
  message: AssistantMessage,
  target: ReplayTarget | undefined,
  replayReasoning: boolean,
  fillMissing: boolean,
): AssistantContent {
  const replay = readReplay(message, target?.model, target?.onDegrade, target?.baseUrl)
  const content = message.parts.flatMap((part, index): Exclude<AssistantContent, string> => {
    if (part.type === 'text') return part.text ? [{ type: 'text', text: part.text }] : []
    if (part.type === 'reasoning') {
      return replayReasoning ? [reasoningContent(part.text, replay?.[index])] : []
    }
    return [
      {
        type: 'tool-call',
        toolCallId: part.id,
        toolName: part.name,
        input: toolInput(part.arguments),
      },
    ]
  })
  const hasReasoning = message.parts.some((part) => part.type === 'reasoning')
  return fillMissing && !hasReasoning ? [reasoningContent(''), ...content] : content
}

/** 这次请求发给谁：决定历史里的签名还能不能用 */
export interface ReplayTarget {
  baseUrl?: string
  model: string
  onDegrade?: (reason: string) => void
}

/** 导出供测试：历史转成 SDK 的消息格式 */
export function toModelMessages(
  messages: ChatMessage[],
  replay: EndpointBehavior['replay'] = 'verbatim',
  target?: ReplayTarget,
  turnStart?: number,
): ModelMessage[] {
  let currentTurnStart = 0
  if (replay === 'current-turn' && turnStart === undefined) {
    messages.forEach((message, index) => {
      if (message.role === 'user') currentTurnStart = index
    })
  }
  return messages.map((message, index): ModelMessage => {
    if (message.role === 'user') return { role: 'user', content: userContent(message) }
    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: message.toolCallId,
            toolName: message.name,
            output: message.isError
              ? { type: 'error-text', value: message.content }
              : message.images?.length
                ? {
                    type: 'content',
                    value: [
                      { type: 'text', text: message.content },
                      ...message.images.map((url) => {
                        const match = /^data:(image\/(?:png|jpeg));base64,([\s\S]+)$/.exec(url)
                        if (!match) throw new Error('Invalid tool image data')
                        return {
                          type: 'file' as const,
                          data: { type: 'data' as const, data: match[2]! },
                          mediaType: match[1]!,
                        }
                      }),
                    ],
                  }
                : { type: 'text', value: message.content },
          },
        ],
      }
    }
    const replayReasoning =
      replay === 'verbatim' ||
      replay === 'fill-missing' ||
      (replay === 'current-turn' && index >= (turnStart ?? currentTurnStart))
    return {
      role: 'assistant',
      content: agentContent(message, target, replayReasoning, replay === 'fill-missing'),
    }
  })
}

function toToolSet(tools: ToolSchema[] | undefined): ToolSet | undefined {
  if (!tools?.length) return undefined
  return Object.fromEntries(
    tools.map((tool) => [
      tool.name,
      { description: tool.description, inputSchema: jsonSchema(tool.parameters) },
    ]),
  )
}

function isOfficialEndpoint(connection: ResolvedConnection): boolean {
  try {
    return new URL(connection.baseUrl).hostname === OFFICIAL_HOST
  } catch {
    return false
  }
}

function requestOptions(
  connection: ResolvedConnection,
  behavior: EndpointBehavior,
  maxTokens: number,
) {
  const claude = connection.model.includes('claude')
  return {
    thinking:
      behavior.thinking === 'adaptive'
        ? { type: 'adaptive' as const, display: 'summarized' as const }
        : {
            type: 'enabled' as const,
            budgetTokens: Math.min(THINKING_BUDGET_TOKENS, Math.floor(maxTokens / 2)),
          },
    // 工具入参不需要边生成边展示，而且部分中转不接受 eager_input_streaming
    toolStreaming: false,
    ...(claude ? { cacheControl: { type: 'ephemeral' as const } } : {}),
    ...(isOfficialEndpoint(connection) && FALLBACK_MODELS.test(connection.model)
      ? { fallbacks: 'default' as const }
      : {}),
  }
}

/** 密钥的来源，报错时告诉用户去哪里改 */
function apiKeyOf(endpoint: ResolvedEndpoint): string {
  return assertUsableApiKey(
    endpoint.apiKey,
    endpoint.source === 'user' ? 'the connection settings' : 'the deployment settings',
  )
}

function createModel(connection: ResolvedConnection) {
  const provider = createAnthropic({
    baseURL: connection.baseUrl,
    apiKey: apiKeyOf(connection),
    headers: BROWSER_ACCESS_HEADERS,
    fetch: devRelayFetch(connection),
  })
  return provider(connection.model)
}

// ---- 响应转换 ----

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function usageOf(usage: LanguageModelUsage): TokenUsage | undefined {
  if (usage.inputTokens === undefined && usage.outputTokens === undefined) return undefined
  const { noCacheTokens, cacheReadTokens, cacheWriteTokens } = usage.inputTokenDetails
  const { reasoningTokens } = usage.outputTokenDetails
  return {
    inputTokens:
      noCacheTokens ??
      Math.max(0, (usage.inputTokens ?? 0) - (cacheReadTokens ?? 0) - (cacheWriteTokens ?? 0)),
    ...(usage.inputTokens === undefined ? {} : { promptTokens: usage.inputTokens }),
    outputTokens: usage.outputTokens ?? 0,
    ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
    ...(cacheReadTokens ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens ? { cacheWriteTokens } : {}),
    ...(reasoningTokens ? { reasoningTokens } : {}),
  }
}

function failed(message: string, code: string): FinishReason {
  return { kind: 'error', failure: new LlmError(message, code).failure }
}

function finishReasonOf(
  reason: SdkFinishReason,
  raw: string | undefined,
  blockCount: number,
): FinishReason {
  if (blockCount === 0) {
    if (raw === 'model_context_window_exceeded') {
      return failed('the request filled the model context window', LlmCode.CONTEXT_WINDOW_EXCEEDED)
    }
    // 没有停止原因说明响应根本没走完；有停止原因却没有内容才是空回复
    if (reason === 'other' && raw === undefined) {
      return failed('the stream ended before the model responded', LlmCode.STREAM_CLOSED)
    }
    if (reason === 'stop' || reason === 'other') {
      return failed('the model returned no content', LlmCode.EMPTY_RESPONSE)
    }
  }
  switch (reason) {
    case 'tool-calls':
      return { kind: 'tool-calls' }
    case 'length':
      return { kind: 'max-tokens' }
    case 'content-filter':
      return { kind: 'refusal' }
    case 'interrupted':
      return failed('the stream ended before the model finished', LlmCode.STREAM_CLOSED)
    case 'error':
      return failed('the model call failed', LlmCode.UNKNOWN)
    default:
      return { kind: 'stop' }
  }
}

interface OpenBlock {
  index: number
  /** 正文、思考的文本，或工具入参的原始 JSON */
  text: string
  type: AssistantPart['type']
  /** 只有工具调用有 */
  name?: string
}

/** 把 SDK 的流事件翻译成协议分片：按到达顺序给块编号，同时记下每块的回放元数据 */
class StreamTranslator {
  private open = new Map<string, OpenBlock>()
  private replay: ReplayBlock[] = []

  constructor(private readonly model: string) {}

  /** 已经开始的内容块数。0 表示模型还什么都没输出 */
  get blockCount(): number {
    return this.replay.length
  }

  replayState(): ReplayEnvelope {
    return {
      response: { kind: REPLAY_KIND, version: REPLAY_VERSION, model: this.model },
      blocks: this.replay,
    }
  }

  private ensure(
    id: string,
    type: AssistantPart['type'],
    name?: string,
  ): { block: OpenBlock; started: StreamChunk[] } {
    const existing = this.open.get(id)
    if (existing) return { block: existing, started: [] }
    const block: OpenBlock = { index: this.replay.length, text: '', type, name }
    this.open.set(id, block)
    this.replay.push({ type })
    const started: StreamChunk[] = [{ type: 'block-start', index: block.index, blockType: type }]
    if (type === 'tool-call') {
      started.push({
        type: 'tool-call-delta',
        index: block.index,
        id,
        ...(name ? { name } : {}),
        argumentsDelta: '',
      })
    }
    return { block, started }
  }

  /** SDK 把思考块的签名放在 providerMetadata 里，可能在开始、增量或结束时到达 */
  private collectReplay(block: OpenBlock, metadata: unknown): void {
    const anthropic = isPlainObject(metadata) ? metadata.anthropic : undefined
    if (!isPlainObject(anthropic)) return
    const entry = this.replay[block.index]!
    if (typeof anthropic.signature === 'string') entry.signature = anthropic.signature
    if (typeof anthropic.redactedData === 'string') entry.redactedData = anthropic.redactedData
  }

  translate(part: TextStreamPart<ToolSet>): StreamChunk[] {
    switch (part.type) {
      case 'text-start':
        return this.ensure(part.id, 'text').started
      case 'text-delta': {
        const { block, started } = this.ensure(part.id, 'text')
        if (!part.text) return started
        block.text += part.text
        return [...started, { type: 'text-delta', index: block.index, text: part.text }]
      }
      case 'text-end':
        return this.end(part.id)
      case 'reasoning-start': {
        const { block, started } = this.ensure(part.id, 'reasoning')
        this.collectReplay(block, part.providerMetadata)
        return started
      }
      case 'reasoning-delta': {
        const { block, started } = this.ensure(part.id, 'reasoning')
        this.collectReplay(block, part.providerMetadata)
        if (!part.text) return started
        block.text += part.text
        return [...started, { type: 'reasoning-delta', index: block.index, text: part.text }]
      }
      case 'reasoning-end': {
        const block = this.open.get(part.id)
        if (block) this.collectReplay(block, part.providerMetadata)
        return this.end(part.id)
      }
      case 'tool-input-start':
        return this.ensure(part.id, 'tool-call', part.toolName).started
      case 'tool-input-delta': {
        const { block, started } = this.ensure(part.id, 'tool-call')
        block.text += part.delta
        return [
          ...started,
          { type: 'tool-call-delta', index: block.index, id: part.id, argumentsDelta: part.delta },
        ]
      }
      case 'tool-call': {
        const { block, started } = this.ensure(part.toolCallId, 'tool-call', part.toolName)
        this.open.delete(part.toolCallId)
        // 优先用模型原样生成的文本；入参不合法时 SDK 给的就是原始字符串
        const input: unknown = part.input
        const raw = typeof input === 'string' ? input : JSON.stringify(input ?? {})
        return [
          ...started,
          {
            type: 'block-end',
            index: block.index,
            block: {
              type: 'tool-call',
              id: part.toolCallId,
              name: part.toolName,
              arguments: block.text || raw,
            },
          },
        ]
      }
      default:
        return []
    }
  }

  private end(id: string): StreamChunk[] {
    const block = this.open.get(id)
    if (!block || block.type === 'tool-call') return []
    this.open.delete(id)
    return [
      {
        type: 'block-end',
        index: block.index,
        block: { type: block.type, text: block.text },
      },
    ]
  }
}

// ---- 错误分类 ----

/** 错误体的字段。兼容 { error: {...} } 和直接的错误对象两种形态 */
function errorFields(body: string | undefined) {
  let parsed: unknown
  try {
    parsed = JSON.parse(body ?? '')
  } catch {
    return {}
  }
  if (!isPlainObject(parsed)) return {}
  const inner = isPlainObject(parsed.error) ? parsed.error : parsed
  const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
  return {
    type: text(inner.type),
    code: text(inner.code),
    message: text(inner.message)?.trim(),
    requestId: text(parsed.request_id),
  }
}

function retryAfterMs(header: (name: string) => string | null | undefined): number | undefined {
  const milliseconds = Number(header('retry-after-ms'))
  if (Number.isFinite(milliseconds) && milliseconds > 0) return milliseconds
  const raw = header('retry-after')
  if (!raw) return undefined
  const delay = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - Date.now()
  return Number.isFinite(delay) && delay > 0 ? delay : undefined
}

/** 按状态码、错误类型和端点原话分类。只信任这几个字段 */
function providerFailure(facts: {
  status?: number
  type?: string
  code?: string
  message?: string
  requestId?: string
  retryAfter?: number
}): LlmFailure {
  const { status, type, code: providerCode } = facts
  const message =
    facts.message || (status === undefined ? 'model request failed' : `HTTP ${status}`)
  const detail = [type, providerCode, message].filter(Boolean).join(' ')
  const validStatus = status !== undefined && status >= 100 && status <= 599 ? status : undefined
  let code: string
  if (
    status === 401 ||
    status === 403 ||
    type === 'authentication_error' ||
    type === 'permission_error'
  ) {
    code = LlmCode.AUTH
  } else if (isQuotaExceededError(detail) || status === 402 || type === 'billing_error') {
    code = LlmCode.QUOTA
  } else if (status === 429 || type === 'rate_limit_error') {
    code = LlmCode.RATE_LIMIT
  } else if (isContextWindowExceededError(detail)) {
    code = LlmCode.CONTEXT_WINDOW_EXCEEDED
  } else if (
    status === 400 ||
    status === 413 ||
    (validStatus === undefined &&
      (type === 'invalid_request_error' || type === 'request_too_large'))
  ) {
    code = LlmCode.INVALID_REQUEST
  } else if (validStatus === undefined || validStatus >= 500) {
    code = LlmCode.SERVER
  } else {
    code = `HTTP_${validStatus}`
  }
  return new LlmError(message, code, {
    status: validStatus,
    providerRetryAfterMs: facts.retryAfter,
    requestId: facts.requestId,
  }).failure
}

function httpFailure(
  status: number,
  body: string | undefined,
  header: (name: string) => string | null | undefined,
  fallbackMessage?: string,
): LlmFailure {
  const fields = errorFields(body)
  return providerFailure({
    status,
    type: fields.type,
    code: fields.code,
    message: fields.message || fallbackMessage,
    requestId:
      header('request-id') ??
      header('x-request-id') ??
      header('x-deepseek-request-id') ??
      fields.requestId ??
      undefined,
    retryAfter: retryAfterMs(header),
  })
}

/** 导出供测试：把 SDK 和浏览器抛出的任意错误分类成失败快照 */
export function classifyFailure(error: unknown): LlmFailure {
  if (error instanceof LlmError) return error.failure
  if (APICallError.isInstance(error)) {
    // 读流时断开，SDK 包成带 200 状态码的 APICallError，cause 才是 TypeError
    if (error.statusCode == null || error.cause instanceof TypeError) {
      return new LlmError(errorChain(error), LlmCode.TRANSPORT, { cause: error }).failure
    }
    // 200 却解析失败：地址指向了网站之类的非 API 服务
    if (error.statusCode < 300) {
      return new LlmError(errorChain(error), LlmCode.MALFORMED_RESPONSE, { cause: error }).failure
    }
    const headers = error.responseHeaders ?? {}
    return httpFailure(error.statusCode, error.responseBody, (name) => headers[name], error.message)
  }
  if (StreamProviderError.isInstance(error)) {
    return providerFailure({
      status: error.statusCode,
      type: error.type,
      code: error.code === undefined ? undefined : String(error.code),
      message: error.message,
    })
  }
  if (error instanceof TypeError) {
    return new LlmError(errorChain(error), LlmCode.TRANSPORT, { cause: error }).failure
  }
  const name = (error as Error | undefined)?.name ?? ''
  const message = errorChain(error) || 'model request failed'
  // 调用方的取消在 stream 里先判断了，走到这里的中止只可能是超时
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new LlmError(message, LlmCode.TIMEOUT, { cause: error }).failure
  }
  if (name.includes('EmptyResponseBody')) {
    return new LlmError(message, LlmCode.EMPTY_RESPONSE, { cause: error }).failure
  }
  if (/JSONParse|TypeValidation|InvalidResponseData/.test(name)) {
    return new LlmError(message, LlmCode.MALFORMED_RESPONSE, { cause: error }).failure
  }
  return normalizeLlmFailure(error)
}

/**
 * 探测失败时区分「模型不支持图片」和「没测出结论」。
 * 配额用完、模型下线这些和能不能看图无关，不能当成不支持。
 */
export function classifyProbeFailure(failure: LlmFailure): VisionProbeResult {
  if (failure.code === LlmCode.TRANSPORT || failure.code === LlmCode.STREAM_CLOSED) {
    return 'no-response'
  }
  if (failure.status === undefined) return 'unavailable'
  if (/image|vision|multimodal|multi-modal|text input|text-only|text only/i.test(failure.message)) {
    return 'no-vision'
  }
  if (failure.code === LlmCode.QUOTA || failure.code === LlmCode.CONTEXT_WINDOW_EXCEEDED) {
    return 'unavailable'
  }
  return failure.status === 400 || failure.status === 422 ? 'no-vision' : 'unavailable'
}

// ---- 适配器 ----

/**
 * 流空闲超时：等下一个事件太久就中止这次请求，调用方的取消也从这里转发。
 * 不用 SDK 的 timeout 选项：它在响应开始后才计时，覆盖不到端点一直不回应的情况，
 * 而且看不到心跳。只在等事件时计时，消费方处理分片的时间不算。
 */
class IdleWatchdog {
  private readonly controller = new AbortController()
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly forward = () => this.controller.abort(this.caller.reason)

  constructor(
    private readonly caller: AbortSignal,
    private readonly idleMs: number,
  ) {
    if (caller.aborted) this.forward()
    else caller.addEventListener('abort', this.forward, { once: true })
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  arm(): void {
    this.disarm()
    this.timer = setTimeout(() => {
      this.controller.abort(new DOMException(`no model event for ${this.idleMs}ms`, 'TimeoutError'))
    }, this.idleMs)
  }

  disarm(): void {
    clearTimeout(this.timer)
  }

  dispose(): void {
    this.disarm()
    this.caller.removeEventListener('abort', this.forward)
  }
}

export interface AnthropicAdapterOptions {
  /** 聊天请求的重试策略，由循环执行 */
  retryPolicy?: ResolvedRetryPolicy
  /** 探测的重试预算 */
  probeRetry?: RetryPolicyConfig
  /** 流多久没有新内容算超时 */
  idleTimeoutMs?: number
  /** 模型列表缓存的时间参数 */
  listing?: ModelListingCacheOptions
}

export class AnthropicAdapter implements LlmAdapter {
  readonly endpoint = 'anthropic' as const
  /** 学到的端点行为，按「地址 + 模型」记住。不落盘，端点可能随时变化 */
  private behaviors = new Map<string, EndpointBehavior>()
  /** 已经警告过的回放元数据问题，同一个问题只警告一次 */
  private degradedReplays = new Set<string>()
  private readonly configuredRetryPolicy: ResolvedRetryPolicy | undefined
  private readonly probeRetry: ResolvedRetryPolicy
  private readonly idleTimeoutMs: number
  private readonly listings: ModelListingCache

  constructor(options: AnthropicAdapterOptions = {}) {
    this.configuredRetryPolicy = options.retryPolicy
    this.probeRetry = resolveRetryPolicy(options.probeRetry ?? PROBE_RETRY, 'probe retry')
    this.idleTimeoutMs = options.idleTimeoutMs ?? LLM_STREAM_IDLE_TIMEOUT_MS
    this.listings = new ModelListingCache(options.listing)
  }

  retryPolicy(): ResolvedRetryPolicy | undefined {
    return this.configuredRetryPolicy
  }

  private behaviorFor(connection: ResolvedConnection): EndpointBehavior {
    return this.behaviors.get(`${connection.baseUrl}|${connection.model}`) ?? DEFAULT_BEHAVIOR
  }

  /** 尝试根据错误修正端点行为；修正成功返回 true，调用方应该重试 */
  private learn(connection: ResolvedConnection, failure: LlmFailure): boolean {
    if (failure.status !== 400) return false
    const next = adjustBehavior(this.behaviorFor(connection), failure.message)
    if (!next) return false
    this.behaviors.set(`${connection.baseUrl}|${connection.model}`, next)
    return true
  }

  private warnDegradedReplay(connection: ResolvedConnection, reason: string): void {
    const key = `${connection.baseUrl}|${connection.model}|${reason}`
    if (this.degradedReplays.has(key)) return
    this.degradedReplays.add(key)
    console.warn(
      `[agent] unusable replay state for model "${connection.model}", sending content only (${reason})`,
    )
  }

  async *stream(
    options: GenerateOptions,
    connection: ResolvedConnection,
    signal: AbortSignal,
  ): AsyncIterable<StreamChunk> {
    for (let attempt = 0; ; attempt++) {
      const behavior = this.behaviorFor(connection)
      const maxTokens = options.maxTokens ?? MAX_OUTPUT_TOKENS
      await options.onCompatibility?.({ replay: behavior.replay, thinking: behavior.thinking })
      const translator = new StreamTranslator(connection.model)
      let thrown: unknown = null
      let stopped: string | null = null
      let responded = false
      let finish: Extract<TextStreamPart<ToolSet>, { type: 'finish' }> | null = null
      const watchdog = new IdleWatchdog(signal, this.idleTimeoutMs)

      try {
        watchdog.arm()
        const result = streamText({
          model: createModel(connection),
          instructions: options.system,
          messages: toModelMessages(
            options.messages,
            behavior.replay,
            {
              model: connection.model,
              baseUrl: connection.baseUrl,
              onDegrade: (reason) => this.warnDegradedReplay(connection, reason),
            },
            options.turnStart,
          ),
          tools: toToolSet(options.tools),
          maxOutputTokens: maxTokens,
          providerOptions: { anthropic: requestOptions(connection, behavior, maxTokens) },
          abortSignal: watchdog.signal,
          // 一次流只尝试一次：SDK 重试不了流中途的失败，也不知道界面已经显示了什么。
          // 重试在循环的步骤边界统一执行
          maxRetries: 0,
          // 端点的心跳事件只在原始分片里，看门狗要靠它们判断连接还活着
          includeRawChunks: true,
          // 错误统一从流里的 error 块处理，不让 SDK 再打一遍日志
          onError: () => {},
        })
        for await (const part of result.stream) {
          watchdog.disarm()
          switch (part.type) {
            case 'start-step':
              responded = true
              break
            case 'finish':
              finish = part
              break
            case 'error':
              thrown = part.error
              break
            case 'abort':
              stopped = part.reason ?? 'the stream stopped responding'
              break
            default:
              yield* translator.translate(part)
          }
          watchdog.arm()
        }
      } catch (error) {
        thrown = error
      } finally {
        watchdog.dispose()
      }

      if (signal.aborted) {
        yield { type: 'finish', reason: abortedReason() }
        return
      }
      // 调用方没有取消却中止了，只可能是空闲超时
      if (thrown === null && stopped !== null) thrown = new LlmError(stopped, LlmCode.TIMEOUT)
      if (thrown === null && finish === null) thrown = new NoOutputGeneratedError()
      if (NoOutputGeneratedError.isInstance(thrown)) {
        // 流里什么事件都解析不出来：地址指向了网站之类的非 API 服务；
        // 响应已经开始才断，就是连接断了
        thrown = responded
          ? new LlmError('the stream ended before the model responded', LlmCode.STREAM_CLOSED)
          : new LlmError('the response is not a model event stream', LlmCode.MALFORMED_RESPONSE)
      }
      if (thrown !== null || finish === null) {
        const failure = classifyFailure(thrown)
        // 这些 400 在模型输出前就返回了，重试不会重复已经展示的内容
        if (
          translator.blockCount === 0 &&
          attempt < MAX_BEHAVIOR_RETRIES &&
          this.learn(connection, failure)
        ) {
          continue
        }
        yield { type: 'finish', reason: { kind: 'error', failure } }
        return
      }
      const usage = usageOf(finish.totalUsage)
      if (usage) yield { type: 'usage', usage }
      const reason = finishReasonOf(
        finish.finishReason,
        finish.rawFinishReason,
        translator.blockCount,
      )
      yield {
        type: 'finish',
        reason,
        ...(reason.kind === 'error' ? {} : { replayState: translator.replayState() }),
      }
      return
    }
  }

  /**
   * 这个模型已知的事实，来自端点自己的模型列表。没列出来或者列表拿不到时什么都不知道，
   * 不当成纯文本：能不能看图由探测决定（见 ctx.models）。
   */
  async resolveModel(
    connection: ResolvedConnection,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    const listing = await this.listings.view(
      endpointKey(connection),
      (deadline) => this.requestListing(connection, deadline),
      signal,
    )
    const entry = listing?.find((model) => model.id === connection.model)
    return {
      endpoint: this.endpoint,
      id: connection.model,
      ...(entry?.inputModalities ? { inputModalities: entry.inputModalities } : {}),
      ...(entry?.contextWindow ? { context: { contextWindow: entry.contextWindow } } : {}),
      defaultMaxTokens: Math.min(MAX_OUTPUT_TOKENS, entry?.maxTokens ?? MAX_OUTPUT_TOKENS),
    }
  }

  async listModels(endpoint: ResolvedEndpoint, signal?: AbortSignal): Promise<DiscoveredModel[]> {
    const models = await this.requestListing(endpoint, signal)
    this.listings.store(endpointKey(endpoint), models)
    return models
  }

  private async requestListing(
    endpoint: ResolvedEndpoint,
    signal?: AbortSignal,
  ): Promise<DiscoveredModel[]> {
    const apiKey = apiKeyOf(endpoint)
    const request = devRelayFetch(endpoint) ?? fetch
    let response: Response
    try {
      response = await request(`${endpoint.baseUrl}/models?limit=1000`, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          ...BROWSER_ACCESS_HEADERS,
        },
        signal,
      })
    } catch (error) {
      throw new LlmError(`could not reach ${endpoint.baseUrl}`, LlmCode.TRANSPORT, { cause: error })
    }
    if (!response.ok) {
      const failure = httpFailure(response.status, await response.text().catch(() => ''), (name) =>
        response.headers.get(name),
      )
      throw new LlmError(failure.message, failure.code, failure)
    }
    return parseModelListing(await response.json().catch(() => null))
  }

  /** 走和聊天相同的流式路径：非流式响应的校验更严，能聊天的模型可能过不了 */
  async probeVision(
    connection: ResolvedConnection,
    signal?: AbortSignal,
  ): Promise<VisionProbeResult> {
    const timeout = new AbortController()
    const abort = () => timeout.abort()
    const timer = setTimeout(abort, PROBE_TIMEOUT_MS)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      for (let retry = 1; ; retry++) {
        const outcome = await this.probeOnce(connection, timeout.signal)
        if (typeof outcome === 'string') return outcome
        const delay = nextRetryDelayMs(this.probeRetry, retry, outcome)
        if (delay === undefined || !(await waitForRetry(delay, timeout.signal))) {
          return classifyProbeFailure(outcome)
        }
      }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }

  private async probeOnce(
    connection: ResolvedConnection,
    signal: AbortSignal,
  ): Promise<VisionProbeResult | LlmFailure> {
    const options: GenerateOptions = {
      messages: [{ role: 'user', content: PROBE_QUESTION, images: [PROBE_IMAGE] }],
      maxTokens: PROBE_MAX_TOKENS,
    }
    let answer = ''
    for await (const chunk of this.stream(options, connection, signal)) {
      if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
        // 输出上限可能全花在思考上，思考里看到了颜色也算
        answer += chunk.text
      } else if (chunk.type === 'finish') {
        if (chunk.reason.kind === 'error') return chunk.reason.failure
        if (chunk.reason.kind === 'aborted' || chunk.reason.kind === 'refusal') return 'unavailable'
      }
    }
    return PROBE_ANSWER.test(answer) ? 'vision' : 'no-vision'
  }
}

function abortedReason(): FinishReason {
  return {
    kind: 'aborted',
    failure: new LlmError('the request was cancelled', LlmCode.ABORTED).failure,
  }
}

/**
 * 部署配置里的重试策略。配置写错时警告并用默认值：一项调优参数不该让助手用不了。
 * @param raw config.json 的 llm.retryPolicy，人工编辑，内容不可信
 */
export function retryPolicyFromConfig(raw: unknown): ResolvedRetryPolicy {
  const path = 'config.json llm.retryPolicy'
  try {
    return resolveRetryPolicy(raw as RetryPolicyConfig | undefined, path)
  } catch (error) {
    console.warn(`[agent] ignoring invalid retry policy: ${errorChain(error)}`)
    return resolveRetryPolicy(undefined, path)
  }
}

function configuredRetryPolicy(): unknown {
  try {
    return getConfig().llm?.retryPolicy
  } catch {
    // 配置没加载（插件被单独加载）时用默认值
    return undefined
  }
}

export const name = 'llm-anthropic'
export const inject = ['llm']

/** 把 Anthropic Messages 协议注册进 ctx.llm */
export function apply(ctx: Context) {
  ctx.effect(() =>
    ctx.llm.registerAdapter(
      new AnthropicAdapter({ retryPolicy: retryPolicyFromConfig(configuredRetryPolicy()) }),
    ),
  )
}

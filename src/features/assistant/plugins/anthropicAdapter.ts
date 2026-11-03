/**
 * Anthropic Messages 协议适配器（POST {baseUrl}/messages），以 cordis 插件的形式注册进 ctx.llm。
 *
 * 只认协议、不限模型：任何提供 /v1/messages 的端点都走这里，模型名由用户决定。
 * 这个文件是项目里唯一直接依赖 AI SDK 的地方。
 *
 * 各家端点对思考块的要求并不一致，这里不按模型名猜，而是先按标准方式发送，
 * 收到能识别的 400 后修正请求重试，并按「地址 + 模型」记住修正结果（见 EndpointBehavior）。
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import {
  APICallError,
  jsonSchema,
  RetryError,
  streamText,
  type AssistantContent,
  type ModelMessage,
  type ToolSet,
} from 'ai'
import type { Context } from '@deepseek-ai/cordis'
import type {
  AssistantPart,
  ChatMessage,
  FinishReason,
  GenerateOptions,
  LlmAdapter,
  ResolvedConnection,
  ResolvedEndpoint,
  StreamChunk,
  ToolSchema,
  UserMessage,
  VisionProbeResult,
} from '../agenttypes/assistant'
import { MAX_OUTPUT_TOKENS } from '../agentconfig/defaults'
import { devRelayFetch } from '../agentconfig/devRelay'
import { t } from '@/i18n'

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

/** 多模态探测用的小图：64×64 的纯绿 PNG。问它是什么颜色，答对才算真的看到了图 */
const PROBE_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAATUlEQVR42u3PQQkAAAgEsItoWANeBN/CYAWW7PwmICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHApKcZA8Z+mQqwAAAAASUVORK5CYII='
const PROBE_QUESTION = 'What color is this image? Reply with one word.'
const PROBE_ANSWER = /green|绿/i
const PROBE_TIMEOUT_MS = 45_000
/** 思考也计入输出上限，给小了可能只有思考没有回答 */
const PROBE_MAX_TOKENS = 512

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

function reasoningContent(text: string, replay?: Record<string, unknown>) {
  return {
    type: 'reasoning' as const,
    text,
    // SDK 会丢弃既没有签名也没有 redactedData 的思考块，这里补上占位值，文本才能回传
    providerOptions: {
      anthropic:
        replay?.signature != null || replay?.redactedData != null
          ? (replay as Record<string, string>)
          : { signature: UNSIGNED_THINKING },
    },
  }
}

function assistantContent(
  parts: AssistantPart[],
  replayReasoning: boolean,
  fillMissing: boolean,
): AssistantContent {
  const content = parts.flatMap((part): Exclude<AssistantContent, string> => {
    if (part.type === 'text') return part.text ? [{ type: 'text', text: part.text }] : []
    if (part.type === 'reasoning') {
      return replayReasoning ? [reasoningContent(part.text, part.replay)] : []
    }
    return [{ type: 'tool-call', toolCallId: part.id, toolName: part.name, input: part.input }]
  })
  const hasReasoning = parts.some((part) => part.type === 'reasoning')
  return fillMissing && !hasReasoning ? [reasoningContent(''), ...content] : content
}

/** 导出供测试：历史转成 SDK 的消息格式 */
export function toModelMessages(
  messages: ChatMessage[],
  replay: EndpointBehavior['replay'] = 'verbatim',
): ModelMessage[] {
  let currentTurnStart = 0
  if (replay === 'current-turn') {
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
              : { type: 'text', value: message.content },
          },
        ],
      }
    }
    const replayReasoning =
      replay === 'verbatim' ||
      replay === 'fill-missing' ||
      (replay === 'current-turn' && index >= currentTurnStart)
    return {
      role: 'assistant',
      content: assistantContent(message.parts, replayReasoning, replay === 'fill-missing'),
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

function createModel(connection: ResolvedConnection) {
  const provider = createAnthropic({
    baseURL: connection.baseUrl,
    apiKey: connection.apiKey,
    headers: BROWSER_ACCESS_HEADERS,
    fetch: devRelayFetch(connection),
  })
  return provider(connection.model)
}

// ---- 响应转换 ----

function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case 'tool-calls':
      return 'tool-calls'
    case 'length':
      return 'length'
    case 'content-filter':
      return 'refusal'
    default:
      return 'stop'
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type ReasoningPart = Extract<AssistantPart, { type: 'reasoning' }>

function mergeReplay(part: ReasoningPart, metadata: Record<string, unknown> | undefined) {
  const anthropic = metadata?.anthropic
  if (isPlainObject(anthropic)) part.replay = { ...part.replay, ...anthropic }
}

function unwrapError(error: unknown): unknown {
  return RetryError.isInstance(error) ? (error.lastError ?? error) : error
}

function upstreamMessage(error: APICallError): string {
  try {
    const body = JSON.parse(error.responseBody ?? '') as { error?: { message?: string } }
    return body.error?.message?.trim() || ''
  } catch {
    return ''
  }
}

/** 400 且错误消息可以用来修正请求时，返回错误消息 */
function correctableMessage(error: unknown): string | null {
  const cause = unwrapError(error)
  if (!APICallError.isInstance(cause) || cause.statusCode !== 400) return null
  return upstreamMessage(cause) || cause.message
}

/** 没拿到完整响应：浏览器的 fetch 失败是 TypeError，读流时断开则被 SDK 包成带状态码的 APICallError */
function isNoResponse(cause: unknown): boolean {
  if (cause instanceof TypeError) return true
  if (!APICallError.isInstance(cause)) return false
  return cause.statusCode == null || cause.cause instanceof TypeError
}

/** 把底层错误翻译成用户可读的提示，保留状态码和上游消息方便排查 */
export function describeError(error: unknown, endpoint: ResolvedEndpoint): string {
  const cause = unwrapError(error)
  const host = hostOf(endpoint.baseUrl)
  if (isNoResponse(cause)) return t('common.assistant.errors.network', { host })
  if (APICallError.isInstance(cause) && cause.statusCode != null) {
    const status = cause.statusCode
    // 200 却解析失败：地址指向了网站之类的非 API 服务
    if (status < 300) return t('common.assistant.errors.badResponse', { host })
    const upstream = upstreamMessage(cause)
    const tail = upstream ? `: ${upstream}` : ''
    if (status === 401 || status === 403) {
      return t('common.assistant.errors.auth', { status }) + tail
    }
    if (status === 404) return t('common.assistant.errors.notFound') + tail
    if (status === 429) return t('common.assistant.errors.rateLimited') + tail
    if (status >= 500) return t('common.assistant.errors.server', { status }) + tail
    return t('common.assistant.errors.http', { status }) + tail
  }
  const name = (cause as Error | undefined)?.name ?? ''
  if (/JSONParse|TypeValidation|InvalidResponseData|EmptyResponseBody/.test(name)) {
    return t('common.assistant.errors.badResponse', { host })
  }
  return (cause as Error | undefined)?.message || t('common.assistant.errors.unknown')
}

/**
 * 探测失败时区分「模型不支持图片」和「没测出结论」。
 * 配额用完、模型下线这些和能不能看图无关，不能当成不支持。
 */
export function classifyProbeFailure(error: unknown): VisionProbeResult {
  const cause = unwrapError(error)
  if (isNoResponse(cause)) return 'no-response'
  if (!APICallError.isInstance(cause)) return 'unavailable'
  const message = `${upstreamMessage(cause)} ${cause.responseBody ?? ''}`
  if (/image|vision|multimodal|multi-modal|text input|text-only|text only/i.test(message)) {
    return 'no-vision'
  }
  return cause.statusCode === 400 || cause.statusCode === 422 ? 'no-vision' : 'unavailable'
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

// ---- 适配器 ----

export class AnthropicAdapter implements LlmAdapter {
  readonly endpoint = 'anthropic' as const
  /** 学到的端点行为，按「地址 + 模型」记住。不落盘，端点可能随时变化 */
  private behaviors = new Map<string, EndpointBehavior>()

  private behaviorFor(connection: ResolvedConnection): EndpointBehavior {
    return this.behaviors.get(`${connection.baseUrl}|${connection.model}`) ?? DEFAULT_BEHAVIOR
  }

  /** 尝试根据错误修正端点行为；修正成功返回 true，调用方应该重试 */
  private learn(connection: ResolvedConnection, error: unknown): boolean {
    const message = correctableMessage(error)
    if (message === null) return false
    const next = adjustBehavior(this.behaviorFor(connection), message)
    if (!next) return false
    this.behaviors.set(`${connection.baseUrl}|${connection.model}`, next)
    return true
  }

  async *stream(
    options: GenerateOptions,
    connection: ResolvedConnection,
    signal: AbortSignal,
  ): AsyncIterable<StreamChunk> {
    for await (const chunk of this.streamWithFailure(options, connection, signal)) {
      if (chunk.type === 'failure') {
        yield {
          type: 'finish',
          reason: 'error',
          parts: [],
          error: describeError(chunk.error, connection),
        }
      } else {
        yield chunk
      }
    }
  }

  /** 流式调用的实现。失败时产出原始错误，由调用方决定怎么呈现 */
  private async *streamWithFailure(
    options: GenerateOptions,
    connection: ResolvedConnection,
    signal: AbortSignal,
  ): AsyncIterable<StreamChunk | { type: 'failure'; error: unknown }> {
    for (let attempt = 0; ; attempt++) {
      const behavior = this.behaviorFor(connection)
      const maxTokens = options.maxTokens ?? MAX_OUTPUT_TOKENS
      const parts: AssistantPart[] = []
      let reason: FinishReason = 'stop'
      let failure: unknown = null

      const result = streamText({
        model: createModel(connection),
        instructions: options.system,
        messages: toModelMessages(options.messages, behavior.replay),
        tools: toToolSet(options.tools),
        maxOutputTokens: maxTokens,
        providerOptions: { anthropic: requestOptions(connection, behavior, maxTokens) },
        abortSignal: signal,
        // 错误统一从流里的 error 块处理，不让 SDK 再打一遍日志
        onError: () => {},
      })

      try {
        for await (const part of result.stream) {
          switch (part.type) {
            case 'reasoning-start': {
              const block: ReasoningPart = { type: 'reasoning', text: '' }
              mergeReplay(block, part.providerMetadata)
              parts.push(block)
              break
            }
            case 'reasoning-delta':
            case 'reasoning-end': {
              const block = parts[parts.length - 1]
              if (block?.type !== 'reasoning') break
              mergeReplay(block, part.providerMetadata)
              if (part.type === 'reasoning-delta' && part.text) {
                block.text += part.text
                yield { type: 'reasoning-delta', text: part.text }
              }
              break
            }
            case 'text-delta': {
              const block = parts[parts.length - 1]
              if (block?.type === 'text') block.text += part.text
              else parts.push({ type: 'text', text: part.text })
              yield { type: 'text-delta', text: part.text }
              break
            }
            case 'tool-call':
              parts.push({
                type: 'tool-call',
                id: part.toolCallId,
                name: part.toolName,
                // 入参不是合法 JSON 时 SDK 给原始字符串，官方 API 要求回传对象
                input: isPlainObject(part.input) ? part.input : {},
              })
              break
            case 'finish':
              reason = mapFinishReason(part.finishReason)
              break
            case 'error':
              failure = part.error
              break
            case 'abort':
              yield { type: 'finish', reason: 'aborted', parts: [] }
              return
          }
        }
      } catch (error) {
        failure = error
      }

      if (signal.aborted) {
        yield { type: 'finish', reason: 'aborted', parts: [] }
        return
      }
      if (failure !== null) {
        // 这些 400 在模型输出前就返回了，重试不会重复已经展示的内容
        if (
          parts.length === 0 &&
          attempt < MAX_BEHAVIOR_RETRIES &&
          this.learn(connection, failure)
        ) {
          continue
        }
        yield { type: 'failure', error: failure }
        return
      }
      yield { type: 'finish', reason, parts }
      return
    }
  }

  async listModels(endpoint: ResolvedEndpoint, signal?: AbortSignal): Promise<string[]> {
    const request = devRelayFetch(endpoint) ?? fetch
    let response: Response
    try {
      response = await request(`${endpoint.baseUrl}/models?limit=1000`, {
        headers: {
          'x-api-key': endpoint.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          ...BROWSER_ACCESS_HEADERS,
        },
        signal,
      })
    } catch {
      throw new Error(t('common.assistant.errors.network', { host: hostOf(endpoint.baseUrl) }))
    }
    if (!response.ok) {
      const apiError = new APICallError({
        message: `HTTP ${response.status}`,
        url: response.url,
        requestBodyValues: {},
        statusCode: response.status,
        responseBody: await response.text().catch(() => ''),
      })
      throw new Error(describeError(apiError, endpoint))
    }
    const body = (await response.json().catch(() => null)) as {
      data?: { id?: unknown }[]
    } | null
    return (body?.data ?? [])
      .map((model) => model.id)
      .filter((id): id is string => typeof id === 'string')
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
      const options: GenerateOptions = {
        messages: [{ role: 'user', content: PROBE_QUESTION, images: [PROBE_IMAGE] }],
        maxTokens: PROBE_MAX_TOKENS,
      }
      let answer = ''
      for await (const chunk of this.streamWithFailure(options, connection, timeout.signal)) {
        if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
          // 输出上限可能全花在思考上，思考里看到了颜色也算
          answer += chunk.text
        } else if (chunk.type === 'failure') {
          return classifyProbeFailure(chunk.error)
        } else if (chunk.reason === 'aborted') {
          return 'unavailable'
        }
      }
      return PROBE_ANSWER.test(answer) ? 'vision' : 'no-vision'
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }
}

/** 适配器插件：把 Anthropic Messages 协议注册进 ctx.llm */
export const anthropicAdapterPlugin = (ctx: Context) => {
  ctx.effect(() => ctx.llm.registerAdapter(new AnthropicAdapter()))
}
anthropicAdapterPlugin.inject = ['llm']

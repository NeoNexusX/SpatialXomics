/**
 * 模型调用的错误分类：稳定的 code、可序列化的失败快照，以及把任意抛出值归一化成快照的规则。
 *
 * 消费方（重试、探测判定、压缩、界面提示）只按 code 路由，不解析 message。
 * message 是端点或适配器给出的原始描述，不翻译；界面文案由 describeFailure 按 code 生成。
 */

import type { LlmFailure, StreamChunk } from './types'

/** 与协议无关的失败 code。其余 HTTP 状态用 HTTP_<status> */
export const LlmCode = {
  /** 401/403：密钥无效或没有权限 */
  AUTH: 'AUTH',
  /** 额度或余额耗尽，重试没有意义；和暂时的 RATE_LIMIT 分开 */
  QUOTA: 'QUOTA',
  RATE_LIMIT: 'RATE_LIMIT',
  /** 请求超出模型上下文窗口，压缩后才可能成功 */
  CONTEXT_WINDOW_EXCEEDED: 'CONTEXT_WINDOW_EXCEEDED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  SERVER: 'SERVER',
  /** 没拿到完整响应：断网、连接被掐断 */
  TRANSPORT: 'TRANSPORT',
  /** 连接正常结束，但流在模型说完之前就断了 */
  STREAM_CLOSED: 'STREAM_CLOSED',
  /** 流长时间没有新内容 */
  TIMEOUT: 'TIMEOUT',
  ABORTED: 'ABORTED',
  /** 正常结束却一个内容块都没有。什么都没产生，重试是安全的 */
  EMPTY_RESPONSE: 'EMPTY_RESPONSE',
  /** 响应不符合协议，通常是地址指向了非 API 服务 */
  MALFORMED_RESPONSE: 'MALFORMED_RESPONSE',
  /** 提供了密钥但用不了（空白或含非法字符），和没填区分开 */
  INVALID_CREDENTIAL: 'INVALID_CREDENTIAL',
  /** 没有可用连接：没填密钥或没选模型 */
  NO_CONNECTION: 'NO_CONNECTION',
  NO_ADAPTER: 'NO_ADAPTER',
  DUPLICATE_ADAPTER: 'DUPLICATE_ADAPTER',
  /** 适配器返回的模型信息不合法 */
  INVALID_MODEL_INFO: 'INVALID_MODEL_INFO',
  INVALID_MODEL_CONTEXT: 'INVALID_MODEL_CONTEXT',
  INVALID_MODEL_MAX_TOKENS: 'INVALID_MODEL_MAX_TOKENS',
  /** 已准备的调用被重复发出，或发出时配置变了 */
  INVALID_PREPARED_CALL: 'INVALID_PREPARED_CALL',
  UNKNOWN: 'UNKNOWN',
} as const

export interface LlmErrorOptions {
  cause?: unknown
  status?: number
  providerRetryAfterMs?: number
  requestId?: string
}

/** 模型调用失败。failure 是和这个 Error 并存的可序列化快照 */
export class LlmError extends Error {
  /** 稳定的失败分类，按它路由，不要解析 message */
  readonly code: string
  readonly failure: LlmFailure
  readonly cause?: unknown

  constructor(message: string, code: string, options?: LlmErrorOptions) {
    if (typeof message !== 'string' || message.length === 0) {
      throw new Error('LlmError message must be a non-empty string')
    }
    if (typeof code !== 'string' || code.length === 0) {
      throw new Error('LlmError code must be a non-empty string')
    }
    const { status, providerRetryAfterMs, requestId } = options ?? {}
    if (status !== undefined && (!Number.isInteger(status) || status < 100 || status > 599)) {
      throw new Error('LlmError status must be an integer from 100 through 599')
    }
    if (
      providerRetryAfterMs !== undefined &&
      (!Number.isFinite(providerRetryAfterMs) || providerRetryAfterMs <= 0)
    ) {
      throw new Error('LlmError providerRetryAfterMs must be a positive finite number')
    }
    if (requestId !== undefined && (typeof requestId !== 'string' || requestId.length === 0)) {
      throw new Error('LlmError requestId must be a non-empty string')
    }
    super(message)
    this.name = 'LlmError'
    this.code = code
    this.cause = options?.cause
    this.failure = Object.freeze({
      message,
      code,
      ...(status === undefined ? {} : { status }),
      ...(providerRetryAfterMs === undefined ? {} : { providerRetryAfterMs }),
      ...(requestId === undefined ? {} : { requestId }),
    })
  }
}

// ---- 按端点文案识别 ----

/** 结构化 code 和直白说法，明确点名上下文上限被超过 */
const STRUCTURED_CONTEXT_OVERFLOW = new RegExp(
  String.raw`(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-]` +
    String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])`,
  'i',
)
/** 把“太大”直接和模型上下文容量挂钩的说法 */
const TOO_LARGE_FOR_CONTEXT = new RegExp(
  String.raw`\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?` +
    String.raw`too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?` +
    String.raw`(?:model(?:'s)?\s+)?context(?:\s+window)?\b`,
  'i',
)
/** “超过”只有在对象明确是模型上下文时才算 */
const EXCEEDS_MODEL_CONTEXT = new RegExp(
  String.raw`\b(?:input|prompt|request|messages?)\b.{0,40}` +
    String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}` +
    String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`,
  'i',
)

/**
 * 识别“请求超出模型上下文窗口”。
 * @param detail 端点错误的 code、type、message 拼成的一段文字
 */
export function isContextWindowExceededError(detail: string): boolean {
  return (
    STRUCTURED_CONTEXT_OVERFLOW.test(detail) ||
    /\b(?:maximum|max)(?:\s+(?:allowed|supported))?\s+context\s+(?:length|window)\b/i.test(
      detail,
    ) ||
    TOO_LARGE_FOR_CONTEXT.test(detail) ||
    /\b(?:input|prompt|request)\s+(?:is\s+)?too\s+(?:long|large)\s+for\s+(?:this|the|requested)\s+model\b/i.test(
      detail,
    ) ||
    /\bprompt\s+is\s+too\s+long\b/i.test(detail) ||
    EXCEEDS_MODEL_CONTEXT.test(detail)
  )
}

/**
 * 识别额度耗尽，和暂时的请求频率限制区分开。
 * @param detail 端点错误的 code、type、message 拼成的一段文字
 */
export function isQuotaExceededError(detail: string): boolean {
  return (
    /\binsufficient[\s_-]+(?:quota|balance|credits?)\b/i.test(detail) ||
    /\b(?:quota|usage[\s_-]+limit)[\s_-]+(?:exceeded|exhausted|reached)\b/i.test(detail) ||
    /\bexceed(?:ed|s)?[\s_-]+(?:(?:your|the)[\s_-]+)?(?:current[\s_-]+)?quota\b/i.test(detail) ||
    /\b(?:balance|credits?)[\s_-]+(?:exhausted|depleted)\b/i.test(detail) ||
    /\bbalance\s+is\s+too\s+low\b/i.test(detail) ||
    /\bout[\s_-]+of[\s_-]+(?:credits?|budget)\b/i.test(detail)
  )
}

// ---- 诊断文本 ----

/**
 * 把抛出值连同 cause 链和 AggregateError 成员渲染成一行，让 `TypeError: Load failed`
 * 这类传输层包装不至于盖住真正的原因。只用于展示，不要解析，路由看 code。
 */
export function errorChain(value: unknown): string {
  // 只记录当前递归路径：只有真正的环才标记，菱形共享的 cause 仍然完整渲染
  const path = new Set<unknown>()
  const render = (current: unknown): string => {
    if (path.has(current)) return '<circular cause>'
    path.add(current)
    try {
      if (!(current instanceof Error)) {
        if (typeof current === 'object' && current !== null) {
          const descriptor = Object.getOwnPropertyDescriptor(current, 'message')
          if (descriptor && 'value' in descriptor && typeof descriptor.value === 'string') {
            return descriptor.value
          }
        }
        return String(current)
      }
      const message = current.message === '' ? current.name : current.message
      const { cause: rawCause, errors } = current as Error & { cause?: unknown; errors?: unknown }
      const members =
        Array.isArray(errors) && errors.length > 0 ? ` [${errors.map(render).join('; ')}]` : ''
      const causeText = rawCause == null ? '' : render(rawCause)
      // new Error(String(x), { cause: x }) 这类包装会逐字重复 cause，不必再渲染一遍
      const cause = causeText === '' || causeText === message ? '' : `: ${causeText}`
      return `${message}${members}${cause}`
    } catch {
      // 只有恶意的 toString 或 getter 会走到这里。渲染结果用于界面和日志，什么都不能逃出去
      return '<unrenderable value>'
    } finally {
      path.delete(current)
    }
  }
  return render(value)
}

// ---- 凭据 ----

/**
 * HTTP 头能原样携带、各家密钥实际使用的字符：可打印 ASCII，不含空格。
 * 超出这个范围 fetch 连请求头都构造不出来，所以这是传输层的硬约束，不是某家的规则。
 */
const LEGAL_API_KEY = /^[\x21-\x7E]+$/

/** 判断一个提供了的密钥能不能用。首尾空白静默去掉，其他问题都要报告 */
export function normalizeApiKey(
  raw: string,
): { ok: true; value: string } | { ok: false; reason: 'empty' | 'illegalCharacters' } {
  const value = raw.trim()
  if (value.length === 0) return { ok: false, reason: 'empty' }
  if (!LEGAL_API_KEY.test(value)) return { ok: false, reason: 'illegalCharacters' }
  return { ok: true, value }
}

/**
 * 接受一个密钥，用不了时报 INVALID_CREDENTIAL。不让 fetch 报 ByteString 错误，否则
 * 用户看到的是连接失败。消息里绝不带密钥的任何部分。
 * @param ref 密钥的来源，告诉用户去哪里改
 */
export function assertUsableApiKey(raw: string, ref: string): string {
  const checked = normalizeApiKey(raw)
  if (checked.ok) return checked.value
  throw new LlmError(
    checked.reason === 'empty'
      ? `the API key from ${ref} is blank`
      : `the API key from ${ref} contains characters no HTTP header can carry`,
    LlmCode.INVALID_CREDENTIAL,
  )
}

// ---- 归一化 ----

/** 读取一个自有的数据属性，不触发访问器：SDK 的 getter 抛错不能盖住原本的失败 */
function ownDataProperty(target: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(target, key)
    return descriptor && 'value' in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

/** 校验并拷贝一份任意来源的失败数据，不合法时返回 undefined */
function failureSnapshot(value: unknown): LlmFailure | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  try {
    const { message, code, status, providerRetryAfterMs, requestId } = value as Record<
      string,
      unknown
    >
    if (
      typeof message !== 'string' ||
      message.length === 0 ||
      typeof code !== 'string' ||
      code.length === 0 ||
      (status !== undefined &&
        (!Number.isInteger(status) || (status as number) < 100 || (status as number) > 599)) ||
      (providerRetryAfterMs !== undefined &&
        (!Number.isFinite(providerRetryAfterMs) || (providerRetryAfterMs as number) <= 0)) ||
      (requestId !== undefined && (typeof requestId !== 'string' || requestId.length === 0))
    ) {
      return undefined
    }
    return Object.freeze({
      message,
      code,
      ...(status === undefined ? {} : { status: status as number }),
      ...(providerRetryAfterMs === undefined
        ? {}
        : { providerRetryAfterMs: providerRetryAfterMs as number }),
      ...(requestId === undefined ? {} : { requestId }),
    })
  } catch {
    return undefined
  }
}

function thrownMessage(value: unknown): string {
  try {
    const message = String(value)
    return message.length > 0 ? message : 'LLM adapter failed'
  } catch {
    return 'LLM adapter failed'
  }
}

function errorMessage(error: Error): string {
  try {
    if (typeof error.message === 'string' && error.message.length > 0) return error.message
  } catch {
    // 下面的兜底让失败仍然可序列化
  }
  return 'LLM adapter failed'
}

/**
 * 把适配器抛出的任意值变成不可变的失败快照。
 *
 * 只信任 LlmError 的 code：第三方 SDK 的 code 不属于这套分类。模块被复制（开发时的热更新）
 * 会让 instanceof 失效，但自有数据还在，所以 failure 和 code 两个自有属性一致时也采信。
 */
export function normalizeLlmFailure(value: unknown): LlmFailure {
  if (!(value instanceof Error)) {
    return Object.freeze({ message: thrownMessage(value), code: LlmCode.UNKNOWN })
  }
  const carried = failureSnapshot(ownDataProperty(value, 'failure'))
  if (carried && carried.code === ownDataProperty(value, 'code')) return carried
  return Object.freeze({ message: errorMessage(value), code: LlmCode.UNKNOWN })
}

/** 把一次适配器失败变成协议的终止分片 */
export function adapterFailureChunk(error: unknown, signal?: AbortSignal): StreamChunk {
  const failure = normalizeLlmFailure(error)
  return {
    type: 'finish',
    reason:
      signal?.aborted || failure.code === LlmCode.ABORTED
        ? { kind: 'aborted', failure }
        : { kind: 'error', failure },
  }
}

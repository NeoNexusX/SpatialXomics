/**
 * 模型请求的重试策略：解析和校验配置，并决定某次失败要不要重试、等多久。
 *
 * 一次流只尝试一次，重试在循环的步骤边界执行：失败那次的输出从不写入历史，
 * 重跑的请求和原来的一样。
 */

import type { LlmFailure } from './types'
import { LlmCode } from './error'

/** setTimeout 能表示的最大延迟 */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

const DEFAULT_MAX_RETRIES = 5
const DEFAULT_INITIAL_DELAY_MS = 500
const DEFAULT_MAX_DELAY_MS = 10_000
const DEFAULT_JITTER_RATIO = 0.1
const DEFAULT_RETRYABLE_CODES: readonly string[] = Object.freeze([
  LlmCode.EMPTY_RESPONSE,
  LlmCode.RATE_LIMIT,
  LlmCode.SERVER,
  LlmCode.TIMEOUT,
  LlmCode.TRANSPORT,
  // 代理掐断长 SSE 是实际遇到的情况，和断网一样可以重试
  LlmCode.STREAM_CLOSED,
])

const POLICY_KEYS = new Set(['maxRetries', 'retryableCodes', 'backoff'])
const BACKOFF_KEYS = new Set(['initialDelayMs', 'maxDelayMs', 'jitterRatio'])

export interface RetryPolicyConfig {
  maxRetries?: number
  retryableCodes?: string[]
  backoff?: { initialDelayMs?: number; maxDelayMs?: number; jitterRatio?: number }
}

export interface ResolvedRetryPolicy {
  readonly maxRetries: number
  readonly retryableCodes: readonly string[]
  readonly initialDelayMs: number
  readonly maxDelayMs: number
  readonly jitterRatio: number
}

function validateKeys(value: object, allowed: Set<string>, path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${path}: unknown key "${key}"`)
  }
}

function assertObject(value: unknown, path: string): asserts value is object {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`)
  }
}

function resolveBackoff(config: RetryPolicyConfig['backoff'], path: string) {
  if (config !== undefined) {
    assertObject(config, path)
    validateKeys(config, BACKOFF_KEYS, path)
  }
  const initialDelayMs = config?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS
  const maxDelayMs = config?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const jitterRatio = config?.jitterRatio ?? DEFAULT_JITTER_RATIO
  const validDelay = (delay: number) =>
    Number.isFinite(delay) && delay > 0 && delay <= MAX_TIMER_DELAY_MS
  if (!validDelay(initialDelayMs)) {
    throw new Error(
      `${path}.initialDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  if (!validDelay(maxDelayMs)) {
    throw new Error(
      `${path}.maxDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  if (initialDelayMs > maxDelayMs) {
    throw new Error(`${path}.initialDelayMs must be less than or equal to maxDelayMs`)
  }
  if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) {
    throw new Error(`${path}.jitterRatio must be between 0 and 1`)
  }
  return { initialDelayMs, maxDelayMs, jitterRatio }
}

/**
 * 校验配置并填入默认值，得到一份不可变的策略。配置来自人工编辑的文件，每一项都要判断。
 * @param path 报错时指明配置的位置
 */
export function resolveRetryPolicy(
  config: RetryPolicyConfig | undefined,
  path: string,
): ResolvedRetryPolicy {
  if (config !== undefined) {
    assertObject(config, path)
    validateKeys(config, POLICY_KEYS, path)
  }
  const maxRetries = config?.maxRetries ?? DEFAULT_MAX_RETRIES
  const retryableCodes = config?.retryableCodes ?? DEFAULT_RETRYABLE_CODES
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
    throw new Error(`${path}.maxRetries must be a non-negative safe integer`)
  }
  if (!Array.isArray(retryableCodes) || retryableCodes.length === 0) {
    throw new Error(`${path}.retryableCodes must be a non-empty array`)
  }
  if (retryableCodes.some((code) => typeof code !== 'string' || code.length === 0)) {
    throw new Error(`${path}.retryableCodes must contain only non-empty strings`)
  }
  if (new Set(retryableCodes).size !== retryableCodes.length) {
    throw new Error(`${path}.retryableCodes must not contain duplicates`)
  }
  return Object.freeze({
    maxRetries,
    retryableCodes: Object.freeze([...retryableCodes]),
    ...resolveBackoff(config?.backoff, `${path}.backoff`),
  })
}

/** 第 retry 次重试前的退避：指数增长、对称抖动，不超过上限 */
export function backoffDelayMs(
  policy: ResolvedRetryPolicy,
  retry: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.min(retry - 1, 1024)
  const exponential = Math.min(policy.initialDelayMs * 2 ** exponent, policy.maxDelayMs)
  const jitter = 1 - policy.jitterRatio + 2 * policy.jitterRatio * random()
  return Math.min(exponential * jitter, policy.maxDelayMs)
}

/**
 * 决定第 retry 次重试要等多久，不该重试时返回 undefined。
 * 端点的 Retry-After 优先于本地退避；它超过上限时不等，把失败交给用户。
 */
export function nextRetryDelayMs(
  policy: ResolvedRetryPolicy,
  retry: number,
  failure: LlmFailure,
  random: () => number = Math.random,
): number | undefined {
  if (!policy.retryableCodes.includes(failure.code)) return undefined
  if (retry > policy.maxRetries) return undefined
  const after = failure.providerRetryAfterMs
  if (after !== undefined && Number.isFinite(after) && after > 0) {
    return after > policy.maxDelayMs ? undefined : after
  }
  return backoffDelayMs(policy, retry, random)
}

/** 可取消的等待。返回 true 表示等够了，false 表示被取消 */
export function waitForRetry(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer)
      resolve(false)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, delayMs)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

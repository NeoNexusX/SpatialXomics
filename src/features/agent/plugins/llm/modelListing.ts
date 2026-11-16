/**
 * 端点模型列表：解析 GET /models 的响应，并按端点和密钥缓存。
 *
 * 各家的响应字段不一样，容量和模态都来自端点自己的声明，不按模型名猜。
 * 模型事实只是优化：列表拿不到、字段不合法时什么事实都不知道，请求照常发。
 */

import type { DiscoveredModel, ModelModality } from './types'
import { abortable } from './abort'
import { errorChain, LlmCode, LlmError } from './error'

/** 首次访问最多等多久列表，超时后这次请求不带模型事实 */
const DEFAULT_LISTING_TIMEOUT_MS = 5_000
/** 列表多久之后在后台刷新 */
const DEFAULT_LISTING_MAX_AGE_MS = 600_000

const MODALITIES: readonly ModelModality[] = ['text', 'image']

function fieldsOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** 候选字段里第一个合法的容量；不合法的值当作没声明 */
function capacity(...candidates: unknown[]): number | undefined {
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  }
  return undefined
}

function modalitiesOf(entry: Record<string, unknown>): ModelModality[] | undefined {
  const declared =
    entry.input_modalities ??
    entry.inputModalities ??
    fieldsOf(entry.architecture)?.input_modalities ??
    fieldsOf(entry.modalities)?.input
  if (Array.isArray(declared)) {
    const known = MODALITIES.filter((modality) => declared.includes(modality))
    return known.length > 0 ? known : undefined
  }
  const imageInput = fieldsOf(fieldsOf(entry.capabilities)?.image_input)?.supported
  if (typeof imageInput === 'boolean') return imageInput ? ['text', 'image'] : ['text']
  return undefined
}

/**
 * 解析模型列表。接受标准的 data 数组，也接受以模型 id 为键的 models 对象。
 * 单行有问题只跳过那一行，不影响其余模型。
 * @returns 模型条目，顺序与端点返回的一致，id 不重复
 * @throws LlmError 响应根本不是模型列表时（通常是地址指向了别的服务）
 */
export function parseModelListing(body: unknown): DiscoveredModel[] {
  const root = fieldsOf(body)
  let rows: { key?: string; entry: unknown }[]
  if (Array.isArray(root?.data)) {
    rows = root.data.map((entry: unknown) => ({ entry }))
  } else if (fieldsOf(root?.models)) {
    rows = Object.entries(fieldsOf(root?.models)!).map(([key, entry]) => ({ key, entry }))
  } else {
    throw new LlmError('the response is not a model listing', LlmCode.MALFORMED_RESPONSE)
  }

  const seen = new Set<string>()
  const models: DiscoveredModel[] = []
  for (const { key, entry: raw } of rows) {
    const entry = fieldsOf(raw)
    if (!entry) continue
    const id = key ?? entry.id
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue
    seen.add(id)
    const limit = fieldsOf(entry.limit)
    const contextWindow = capacity(
      entry.contextWindow,
      entry.context_window,
      entry.context_length,
      entry.max_input_tokens,
      limit?.context,
    )
    const maxTokens = capacity(
      entry.maxOutputTokens,
      entry.max_output_tokens,
      entry.maxTokens,
      entry.max_tokens,
      limit?.output,
      fieldsOf(entry.top_provider)?.max_completion_tokens,
    )
    const inputModalities = modalitiesOf(entry)
    models.push({
      id,
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
      ...(inputModalities === undefined ? {} : { inputModalities }),
    })
  }
  return models
}

interface ListingEntry {
  listing?: readonly DiscoveredModel[]
  /** 最近一次加载结束的时间（成功或失败）；首次加载结束前没有 */
  settledAt?: number
  inflight?: Promise<void>
  /** 连续失败时只警告一次 */
  failing?: boolean
}

export interface ModelListingCacheOptions {
  timeoutMs?: number
  maxAgeMs?: number
  now?: () => number
}

/**
 * 按作用域（端点 + 密钥）缓存模型列表：并发访问只发一个请求；首次访问等结果，
 * 由超时兜底；之后立刻返回，过期了在后台刷新；刷新失败保留上次的结果。
 */
export class ModelListingCache {
  private entries = new Map<string, ListingEntry>()
  private readonly timeoutMs: number
  private readonly maxAgeMs: number
  private readonly now: () => number

  constructor(options: ModelListingCacheOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_LISTING_TIMEOUT_MS
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_LISTING_MAX_AGE_MS
    this.now = options.now ?? Date.now
  }

  /**
   * 取某个作用域当前的列表。
   * @param load 真正发请求的函数
   * @param signal 只放弃这一次等待，共享的加载继续
   * @returns 列表；还没有拿到过时为 undefined
   */
  async view(
    scope: string,
    load: (signal: AbortSignal) => Promise<DiscoveredModel[]>,
    signal?: AbortSignal,
  ): Promise<readonly DiscoveredModel[] | undefined> {
    const entry = this.entryOf(scope)
    if (entry.settledAt === undefined) {
      // 只放弃等待，不取消 task：别的等待者还在用它
      const task = this.start(scope, entry, load)
      await (signal ? abortable(() => task, signal) : task)
    } else if (this.now() - entry.settledAt >= this.maxAgeMs) {
      void this.start(scope, entry, load)
    }
    return entry.listing
  }

  /** 记下调用方已经拿到的列表 */
  store(scope: string, listing: readonly DiscoveredModel[]): void {
    const entry = this.entryOf(scope)
    entry.listing = listing
    entry.settledAt = this.now()
    entry.failing = false
  }

  private entryOf(scope: string): ListingEntry {
    let entry = this.entries.get(scope)
    if (!entry) {
      entry = {}
      this.entries.set(scope, entry)
    }
    return entry
  }

  private start(
    scope: string,
    entry: ListingEntry,
    load: (signal: AbortSignal) => Promise<DiscoveredModel[]>,
  ): Promise<void> {
    if (entry.inflight) return entry.inflight
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), this.timeoutMs)
    const run = load(deadline.signal)
      .then(
        (listing) => this.store(scope, listing),
        (error: unknown) => {
          if (!entry.failing) {
            console.warn(
              `[agent] model listing failed, model limits are unknown (${errorChain(error)})`,
            )
          }
          entry.failing = true
          entry.settledAt = this.now()
        },
      )
      .finally(() => {
        clearTimeout(timer)
        entry.inflight = undefined
      })
    entry.inflight = run
    return run
  }
}

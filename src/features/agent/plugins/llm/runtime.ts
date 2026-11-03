/**
 * ctx.llm 服务：LLM 适配器注册表 + 流式入口。
 *
 * 适配器以 cordis 插件的形式注册（如 plugins/llm-anthropic），按端点协议路由。
 * 请求用哪个连接由 ctx.connection 决定，循环不感知协议。
 * 支持新协议只需要写一个适配器插件，并在 bundles/base.ts 里加一行。
 *
 * 这里是适配器的最终边界：一次流只调用一次端点，发起和读流时的任何失败都变成唯一的
 * 终止 finish 分片；消费方自己抛的错仍然抛给消费方。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  DiscoveredModel,
  GenerateOptions,
  LlmAdapter,
  LlmResolvedModelInfo,
  PreparedLlmCall,
  StreamChunk,
  VisionProbeResult,
} from './types'
import type { EndpointType, ResolvedConnection, ResolvedEndpoint } from '../connection'
import { MAX_OUTPUT_TOKENS } from './modelLimits'
import { abortable } from './abort'
import { adapterFailureChunk, LlmCode, LlmError } from './error'
import { resolveRetryPolicy, type ResolvedRetryPolicy } from './retryPolicy'

declare module '@deepseek-ai/cordis' {
  interface Context {
    llm: LlmRuntime
  }
}

interface Registration {
  adapter: LlmAdapter
  retryPolicy: ResolvedRetryPolicy
}

export class LlmRuntime extends Service {
  static inject = ['connection']

  private adapters = new Map<EndpointType, Registration>()

  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  /** 注册一个适配器，同时读取它的重试策略；同一协议重复注册抛错。返回注销函数 */
  registerAdapter(adapter: LlmAdapter): () => void {
    if (this.adapters.has(adapter.endpoint)) {
      throw new LlmError(
        `LLM adapter "${adapter.endpoint}" is already registered`,
        LlmCode.DUPLICATE_ADAPTER,
      )
    }
    this.adapters.set(adapter.endpoint, {
      adapter,
      retryPolicy:
        adapter.retryPolicy?.() ??
        resolveRetryPolicy(undefined, `LLM adapter "${adapter.endpoint}"`),
    })
    return () => {
      this.adapters.delete(adapter.endpoint)
    }
  }

  private registration(endpoint: EndpointType): Registration {
    const registration = this.adapters.get(endpoint)
    if (!registration) {
      throw new LlmError(`No LLM adapter registered for "${endpoint}"`, LlmCode.NO_ADAPTER)
    }
    return registration
  }

  /** 校验并拷贝适配器返回的模型事实 */
  private normalizeModelInfo(
    connection: ResolvedConnection,
    resolved: LlmResolvedModelInfo,
  ): LlmResolvedModelInfo {
    const route = `"${connection.endpoint}" model "${connection.model}"`
    if (resolved.endpoint !== connection.endpoint || resolved.id !== connection.model) {
      throw new LlmError(
        `adapter returned model info for the wrong route, expected ${route}`,
        LlmCode.INVALID_MODEL_INFO,
      )
    }
    const { context, defaultMaxTokens, inputModalities } = resolved
    if (
      context !== undefined &&
      (!Number.isSafeInteger(context.contextWindow) || context.contextWindow <= 0)
    ) {
      throw new LlmError(
        `adapter returned an invalid context window for ${route}`,
        LlmCode.INVALID_MODEL_CONTEXT,
      )
    }
    if (
      defaultMaxTokens !== undefined &&
      (!Number.isSafeInteger(defaultMaxTokens) || defaultMaxTokens <= 0)
    ) {
      throw new LlmError(
        `adapter returned an invalid default output limit for ${route}`,
        LlmCode.INVALID_MODEL_MAX_TOKENS,
      )
    }
    if (
      inputModalities !== undefined &&
      (!Array.isArray(inputModalities) ||
        inputModalities.some((modality) => modality !== 'text' && modality !== 'image'))
    ) {
      throw new LlmError(
        `adapter returned invalid input modalities for ${route}`,
        LlmCode.INVALID_MODEL_INFO,
      )
    }
    return {
      endpoint: connection.endpoint,
      id: connection.model,
      ...(inputModalities === undefined ? {} : { inputModalities: [...inputModalities] }),
      ...(context === undefined ? {} : { context: { contextWindow: context.contextWindow } }),
      ...(defaultMaxTokens === undefined ? {} : { defaultMaxTokens }),
    }
  }

  private async resolveWith(
    { adapter }: Registration,
    connection: ResolvedConnection,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    const resolved = adapter.resolveModel
      ? await adapter.resolveModel(connection, signal)
      : { endpoint: connection.endpoint, id: connection.model }
    const info = this.normalizeModelInfo(connection, resolved)
    // 实际发图测过的结果比端点的声明可信。目录服务依赖本服务，这里只在它存在时读取
    const probed = this.ctx.get('models')?.probedModalities(connection)
    return probed ? { ...info, inputModalities: probed } : info
  }

  /**
   * 解析一个确切模型的事实。
   * @throws LlmError 没有对应的适配器，或适配器返回的事实不合法时
   */
  async resolveModelInfo(
    connection: ResolvedConnection,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return this.resolveWith(this.registration(connection.endpoint), connection, signal)
  }

  /**
   * 用当前连接准备一次调用：捕获连接、适配器、模型事实和重试策略，发出时不再读取设置，
   * 也可以先拿这些事实决定怎么发。
   * @param controls.maxTokens 调用方要求的输出上限，不会超过模型自己的上限；缺省用模型的默认值
   * @throws LlmError 没有可用连接、没有对应的适配器或模型事实不合法时
   */
  async prepareCall(
    signal?: AbortSignal,
    controls?: { maxTokens?: number; connection?: ResolvedConnection },
  ): Promise<PreparedLlmCall> {
    signal?.throwIfAborted()
    const current = controls?.connection ?? this.ctx.connection.current()
    if (!current) throw new LlmError('no model connection is configured', LlmCode.NO_CONNECTION)
    const connection = Object.freeze({ ...current })
    const registration = this.registration(connection.endpoint)
    const model = Object.freeze(await this.resolveWith(registration, connection, signal))
    signal?.throwIfAborted()
    if (model.inputModalities?.includes('image') === false) {
      throw new LlmError(
        'Agent requires a multimodal model. Select a model that accepts images.',
        LlmCode.INVALID_REQUEST,
      )
    }
    const limit = model.defaultMaxTokens
    const requested = controls?.maxTokens
    const maxTokens =
      requested === undefined
        ? (limit ?? MAX_OUTPUT_TOKENS)
        : Math.min(requested, limit ?? requested)

    const prepare = (): PreparedLlmCall => {
      let dispatched = false
      return Object.freeze({
        again: prepare,
        connection,
        model,
        maxTokens,
        retryPolicy: registration.retryPolicy,
        stream: (options: GenerateOptions, streamSignal: AbortSignal) => {
          if (dispatched) {
            throw new LlmError(
              'a prepared LLM call can only be dispatched once',
              LlmCode.INVALID_PREPARED_CALL,
            )
          }
          if (options.maxTokens !== undefined && options.maxTokens !== maxTokens) {
            throw new LlmError(
              'prepared LLM call config changed before dispatch',
              LlmCode.INVALID_PREPARED_CALL,
            )
          }
          dispatched = true
          return this.adapterStream(
            { ...options, maxTokens },
            registration.adapter,
            connection,
            streamSignal,
          )
        },
      })
    }
    return prepare()
  }

  /** 保证协议：恰好一个 finish，之后不再有任何内容 */
  private async *adapterStream(
    options: GenerateOptions,
    adapter: LlmAdapter,
    connection: ResolvedConnection,
    signal: AbortSignal,
  ): AsyncIterable<StreamChunk> {
    let iterator: AsyncIterator<StreamChunk>
    try {
      iterator = adapter.stream(options, connection, signal)[Symbol.asyncIterator]()
    } catch (error) {
      yield adapterFailureChunk(error, signal)
      return
    }
    let completed = false
    try {
      while (true) {
        let next: IteratorResult<StreamChunk>
        try {
          next = await abortable(() => iterator.next(), signal)
        } catch (error) {
          completed = true
          yield adapterFailureChunk(error, signal)
          return
        }
        if (next.done) {
          completed = true
          yield adapterFailureChunk(
            new LlmError('the adapter stream ended without a finish', LlmCode.STREAM_CLOSED),
            signal,
          )
          return
        }
        // 在适配器的 try 之外 yield：消费方的错不能被当成适配器失败
        yield next.value
        if (next.value.type === 'finish') return
      }
    } finally {
      if (!completed || signal.aborted) {
        const closing = iterator.return?.()
        if (signal.aborted) void Promise.resolve(closing).catch(() => {})
        else await closing
      }
    }
  }

  /** 询问端点的模型列表，去掉没有 id 和重复的条目 */
  async listModels(endpoint: ResolvedEndpoint, signal?: AbortSignal): Promise<DiscoveredModel[]> {
    const models = await this.registration(endpoint.endpoint).adapter.listModels(endpoint, signal)
    const seen = new Set<string>()
    return models.flatMap((model) => {
      if (typeof model.id !== 'string' || model.id.length === 0 || seen.has(model.id)) return []
      seen.add(model.id)
      return [
        {
          ...model,
          ...(model.inputModalities ? { inputModalities: [...model.inputModalities] } : {}),
        },
      ]
    })
  }

  /** 验证模型能看懂图片 */
  probeVision(connection: ResolvedConnection, signal?: AbortSignal): Promise<VisionProbeResult> {
    return this.registration(connection.endpoint).adapter.probeVision(connection, signal)
  }
}

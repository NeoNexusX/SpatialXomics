/**
 * ctx.llm 服务：LLM 适配器注册表 + 流式入口。
 *
 * 适配器以 cordis 插件的形式注册（如 plugins/anthropicAdapter.ts），按端点协议路由。
 * 请求用哪个连接由 ctx.connection 决定，AgentLoop 不感知协议。
 * 支持新协议只需要写一个适配器插件，并在 plugins/index.ts 里加载它。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  EndpointType,
  GenerateOptions,
  LlmAdapter,
  ResolvedConnection,
  ResolvedEndpoint,
  StreamChunk,
  VisionProbeResult,
} from '../agenttypes/assistant'
import { t } from '@/i18n'

declare module '@deepseek-ai/cordis' {
  interface Context {
    llm: LlmRuntime
  }
}

export class LlmRuntime extends Service {
  private adapters = new Map<EndpointType, LlmAdapter>()

  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  /** 注册一个适配器；同一协议重复注册抛错。返回注销函数 */
  registerAdapter(adapter: LlmAdapter): () => void {
    if (this.adapters.has(adapter.endpoint)) {
      throw new Error(`LLM adapter "${adapter.endpoint}" is already registered`)
    }
    this.adapters.set(adapter.endpoint, adapter)
    return () => {
      this.adapters.delete(adapter.endpoint)
    }
  }

  private adapterFor(endpoint: EndpointType): LlmAdapter {
    const adapter = this.adapters.get(endpoint)
    if (!adapter) throw new Error(`No LLM adapter registered for "${endpoint}"`)
    return adapter
  }

  /** 用当前连接发起一次流式调用 */
  async *stream(options: GenerateOptions, signal: AbortSignal): AsyncIterable<StreamChunk> {
    const connection = this.ctx.connection.current()
    if (!connection) {
      yield {
        type: 'finish',
        reason: 'error',
        parts: [],
        error: t('common.assistant.noApiConfigured'),
      }
      return
    }
    yield* this.adapterFor(connection.endpoint).stream(options, connection, signal)
  }

  /** 询问端点的模型列表 */
  listModels(endpoint: ResolvedEndpoint, signal?: AbortSignal): Promise<string[]> {
    return this.adapterFor(endpoint.endpoint).listModels(endpoint, signal)
  }

  /** 验证模型能看懂图片 */
  probeVision(connection: ResolvedConnection, signal?: AbortSignal): Promise<VisionProbeResult> {
    return this.adapterFor(connection.endpoint).probeVision(connection, signal)
  }
}

export const llmProvider = (ctx: Context) => {
  new LlmRuntime(ctx)
}
// LlmRuntime 内部访问 ctx.connection（兄弟服务），fiber 内必须声明 inject
llmProvider.inject = ['connection']

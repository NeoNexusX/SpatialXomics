/**
 * ctx.llm 服务：LLM 适配器注册表 + 流式入口。
 *
 * 每个适配器通过 `registerAdapter` 注册，按 provider 名路由。
 * stream() 入口派发 `llm/stream` waterfall 允许插件拦截/缓存，
 * 默认行为委托给匹配的适配器。
 *
 * 本项目只保留 OpenAI 兼容适配器（/chat/completions）：env 默认部署与用户
 * BYOK 自配（DeepSeek / GLM / Kimi / OpenAI 本家…）都走同一协议。
 */

import { Context, Service } from 'cordis'
import type { GenerateOptions, LlmAdapter, StreamChunk } from '../agenttypes/assistant'
import { openaiAdapter } from '../agentservices/openaiAdapter'

/** 声明 ctx.llm 服务键类型 */
declare module 'cordis' {
  interface Context {
    llm: LlmRuntime
  }
}

export class LlmRuntime extends Service {
  private adapters = new Map<string, LlmAdapter>()

  /** 默认使用的 provider 名（可通过 intercept / 直接赋值覆盖） */
  private defaultProvider = 'openai-compatible'

  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  /**
   * 注册一个 LLM 适配器。
   *
   * @param provider — 适配器名（如 'openai-compatible'），用于路由
   * @param adapter  — 适配器实例
   * @returns 注销函数（随 fiber 卸载自动调用）
   */
  registerAdapter(provider: string, adapter: LlmAdapter): () => void {
    if (this.adapters.has(provider)) {
      throw new Error(`LLM adapter "${provider}" is already registered`)
    }
    this.adapters.set(provider, adapter)
    return () => {
      this.adapters.delete(provider)
    }
  }

  /** 获取当前有效的适配器实例（显式 provider 参数 > defaultProvider） */
  getAdapter(provider?: string): LlmAdapter | undefined {
    return this.adapters.get(provider || this.defaultProvider)
  }

  /**
   * 流式生成。
   *
   * 委托给当前注册的适配器。后续 Phase 2 可在此加入 `llm/stream`
   * waterfall 事件，允许插件拦截/缓存/限流。
   */
  async *stream(options: GenerateOptions, signal: AbortSignal): AsyncIterable<StreamChunk> {
    const adapter = this.getAdapter()
    if (!adapter) {
      throw new Error('No LLM adapter registered. Call ctx.llm.registerAdapter() first.')
    }
    for await (const chunk of adapter.stream(options, signal)) {
      yield chunk
    }
  }
}

/**
 * LLM 提供者插件：注册 LlmRuntime 服务 + 内置 OpenAI 兼容适配器
 * （/chat/completions）。
 *
 * 在 bootstrap index.ts 中调用：
 * ```ts
 * ctx.plugin(llmProvider)
 * ```
 */
export const llmProvider = (ctx: Context) => {
  const runtime = new LlmRuntime(ctx)
  runtime.registerAdapter('openai-compatible', openaiAdapter)
}

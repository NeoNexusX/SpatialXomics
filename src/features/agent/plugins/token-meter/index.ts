/** ctx.tokenMeter 服务：从会话日志折叠用量和上下文占用，界面、压缩和统计读同一份结果 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { TokenUsage } from '../llm'
import type { RequestSnapshot, Session } from '../session'
import type { SessionProjectionDefinition } from '../session-projection'
import { estimateMessage, estimateOverhead, inputBudgetOf, type ContextPressure } from './estimate'
import { addUsage, totalInputTokens } from '../llm'

declare module '@deepseek-ai/cordis' {
  interface Context {
    tokenMeter: TokenMeter
  }
}

interface TokenUsageState {
  attempts: Record<string, TokenUsage>
}

/** Cumulative provider-reported usage. One attempt is replaced by its own id, retries add. */
export const tokenUsageProjection: SessionProjectionDefinition<
  TokenUsageState,
  TokenUsage | undefined
> = {
  key: 'tokenUsage',
  init: () => ({ attempts: {} }),
  apply: (state, event) => {
    if (event.type === 'attempt/end' && event.usage) {
      return {
        attempts: {
          ...state.attempts,
          [event.attemptId]: event.usage,
        },
      }
    }
    if (event.type === 'compaction/end' && event.usage) {
      return {
        attempts: {
          ...state.attempts,
          [`compaction:${event.compactionId}`]: event.usage,
        },
      }
    }
    return state
  },
  view: (state) => {
    let total: TokenUsage | undefined
    for (const usage of Object.values(state.attempts)) total = addUsage(total, usage)
    return total
  },
}

interface PressureState {
  surfaceTokens: number
  nodeTokens: Record<number, number>
  request?: RequestSnapshot
  usage?: TokenUsage
  sampledSurfaceTokens?: number
}

function replaceSurface(
  state: PressureState,
  nodes: readonly number[],
  seq: number,
  tokens: number,
): PressureState {
  const nodeTokens = { ...state.nodeTokens }
  let surfaceTokens = state.surfaceTokens
  for (const node of nodes) {
    surfaceTokens -= nodeTokens[node] ?? 0
    delete nodeTokens[node]
  }
  nodeTokens[seq] = tokens
  return {
    ...state,
    nodeTokens,
    surfaceTokens: surfaceTokens + tokens,
  }
}

/** Provider-anchored, surface-aware occupancy shared by UI, compaction, and stats. */
export const contextPressureProjection: SessionProjectionDefinition<
  PressureState,
  ContextPressure | undefined
> = {
  key: 'contextPressure',
  init: () => ({ surfaceTokens: 0, nodeTokens: {} }),
  apply: (state, event) => {
    if (event.type === 'message') {
      const tokens = estimateMessage(event.message)
      if (typeof event.surfaceOp === 'object')
        return replaceSurface(state, event.surfaceOp.nodes, event.seq, tokens)
      return {
        ...state,
        surfaceTokens: state.surfaceTokens + tokens,
        nodeTokens: { ...state.nodeTokens, [event.seq]: tokens },
      }
    }
    if (event.type === 'surface/reset') {
      const nodeTokens: Record<number, number> = {}
      let surfaceTokens = 0
      for (const seq of event.nodes) {
        const tokens = state.nodeTokens[seq] ?? 0
        nodeTokens[seq] = tokens
        surfaceTokens += tokens
      }
      return { ...state, nodeTokens, surfaceTokens, usage: undefined, sampledSurfaceTokens: undefined }
    }
    if (event.type === 'request/context' || event.type === 'attempt/start') {
      // `request/context` is the normal pre-dispatch snapshot. The
      // attempt fallback keeps logs written before that event reconstructable.
      if (event.type === 'attempt/start' && state.request !== undefined) return state
      return {
        ...state,
        request: event.request,
        usage: undefined,
        sampledSurfaceTokens: state.surfaceTokens,
      }
    }
    if (event.type === 'attempt/end' && event.usage) {
      return { ...state, usage: event.usage }
    }
    return state
  },
  view: (state) => {
    const request = state.request
    if (!request) return undefined
    const contextWindow = request.contextWindow
    const outputReserve = request.maxTokens ?? 0
    const inputBudget = inputBudgetOf(contextWindow, outputReserve)
    if (inputBudget <= 0) return undefined
    const base = estimateOverhead(request.system ?? '', request.tools ?? []) + state.surfaceTokens
    let inputTokens = base
    let estimated = true
    if (state.usage) {
      const pressure = totalInputTokens(state.usage)
      inputTokens = Math.max(base, pressure + state.surfaceTokens - (state.sampledSurfaceTokens ?? 0))
      estimated = false
    }
    return {
      inputTokens,
      contextWindow,
      outputReserve,
      inputBudget,
      ratio: inputTokens / inputBudget,
      estimated,
    }
  },
}

export class TokenMeter extends Service {
  static inject = ['sessionProjections']

  constructor(ctx: Context) {
    super(ctx, 'tokenMeter')
    ctx.effect(() => ctx.sessionProjections.register(tokenUsageProjection))
    ctx.effect(() => ctx.sessionProjections.register(contextPressureProjection))
  }

  /** 这个会话当前的上下文占用；还没有发过请求、或输出预留占满窗口时没有结果 */
  pressure(session: Session): ContextPressure | undefined {
    return this.ctx.sessionProjections.viewOf<ContextPressure>(session, 'contextPressure')
  }
}

export * from './estimate'

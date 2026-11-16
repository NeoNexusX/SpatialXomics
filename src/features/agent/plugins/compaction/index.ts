/**
 * ctx.compaction 服务：什么时候压缩。怎么压缩见 region.ts。
 *
 * 占用超过阈值时在请求前压缩，端点确认超窗时压缩后重试，用户也可以手动触发。
 * 压缩失败不影响这一轮：历史保持原样，能不能放下由端点判断。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { AttemptContext } from '../agent'
import { LlmCode } from '../llm'
import type { Session } from '../session'
import { headroomTokens, resolvePolicy } from './policy'
import { compactRegion, selectRegion } from './region'

declare module '@deepseek-ai/cordis' {
  interface Context {
    compaction: Compaction
  }
}

/** 压缩后占用仍超过阈值时，最多再压缩几次 */
const COMPACTION_RETRIES = 1

export type CompactionRequest = Pick<
  AttemptContext,
  'session' | 'system' | 'tools' | 'connection' | 'contextWindow' | 'signal' | 'setPhase' | 'notify'
>

/** 一轮内的压缩状态 */
interface TurnState {
  turnId?: string
  /** 摘要失败过的区间，这一轮不再为它重复付费 */
  failedRegion?: string
  /** 超窗恢复每轮一次：当前轮次不动，恢复过之后更早的内容已经压完了 */
  overflowRecovered: boolean
}

export class Compaction extends Service {
  static inject = ['attachments', 'llm', 'tokenMeter']

  private states = new WeakMap<Session, TurnState>()

  constructor(ctx: Context) {
    super(ctx, 'compaction')
    ctx.on('agent/pre-request', async (attempt) => {
      const { thresholdTokens, retainTokens } = resolvePolicy(
        attempt.contextWindow,
        attempt.outputReserve,
      )
      let compacted = false
      for (let round = 0; round <= COMPACTION_RETRIES; round++) {
        const pressure = this.ctx.tokenMeter.pressure(attempt.session)
        if (!pressure || pressure.inputTokens < thresholdTokens) break
        if (!(await this.compactFor(attempt, retainTokens, attempt.turnId))) break
        compacted = true
      }
      if (compacted) await attempt.recordRequest()
    })
    // 排在最前面：超窗要先压缩，压缩不动才交给重试策略
    ctx.on(
      'agent/request-error',
      async (failed, next) => {
        if (failed.failure.code !== LlmCode.CONTEXT_WINDOW_EXCEEDED) return next()
        const state = this.stateOf(failed.session, failed.turnId)
        if (state.overflowRecovered) return next()
        state.overflowRecovered = true
        return (await this.compactFor(failed, 0, failed.turnId)) ? { kind: 'retry' } : next()
      },
      true,
    )
  }

  /** 手动压缩，不看阈值，只留最后一段完整内容。返回上下文是否变小了 */
  compact(request: CompactionRequest): Promise<boolean> {
    this.states.delete(request.session)
    return this.compactFor(request, 0, undefined)
  }

  private stateOf(session: Session, turnId: string | undefined): TurnState {
    let state = this.states.get(session)
    if (!state || state.turnId !== turnId) {
      state = { turnId, overflowRecovered: false }
      this.states.set(session, state)
    }
    return state
  }

  private async compactFor(
    request: CompactionRequest,
    retainTokens: number,
    protectedTurn: string | undefined,
  ): Promise<boolean> {
    const { session, system, tools, connection, contextWindow, signal } = request
    const count = selectRegion({
      session,
      system,
      tools,
      contextWindow,
      retainTokens,
      protectedTurn,
    })
    if (count === 0) return false
    const state = this.stateOf(session, protectedTurn)
    const region = JSON.stringify(session.nodes.slice(0, count))
    if (state.failedRegion === region) return false
    request.setPhase('compacting')
    try {
      await compactRegion({
        session,
        system,
        tools,
        count,
        signal,
        prepareSummary: () =>
          this.ctx.llm.prepareCall(signal, {
            connection,
            maxTokens: headroomTokens(contextWindow),
          }),
        hydrate: (messages) => this.ctx.attachments.hydrate(session.storage, messages),
      })
      return true
    } catch (error) {
      if (signal.aborted || session.hasUnstoredBatch) throw error
      state.failedRegion = region
      request.notify()
      return false
    }
  }
}

export * from './policy'
export * from './region'
export * from './summarizer'

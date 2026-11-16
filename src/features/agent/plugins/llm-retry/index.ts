/**
 * 在循环的步骤边界执行适配器的重试策略：失败那次的输出从不写入历史，重跑的请求和原来的一样。
 * 重试次数按步骤计，新的一步重新计数。
 */

import type { Context } from '@deepseek-ai/cordis'
import { nextRetryDelayMs, waitForRetry } from '../llm'
import type { Session } from '../session'

export const name = 'llm-retry'

export function apply(ctx: Context) {
  const counters = new WeakMap<Session, { step: string; retries: number }>()
  ctx.on('agent/request-error', async (failed, next) => {
    const step = `${failed.turnId}:${failed.step}`
    let counter = counters.get(failed.session)
    if (counter?.step !== step) {
      counter = { step, retries: 0 }
      counters.set(failed.session, counter)
    }
    const delay = nextRetryDelayMs(failed.retryPolicy, ++counter.retries, failed.failure)
    if (delay === undefined) return next()
    failed.showRetry(counter.retries, failed.retryPolicy.maxRetries)
    if (!(await waitForRetry(delay, failed.signal))) failed.signal.throwIfAborted()
    return { kind: 'retry' }
  })
}

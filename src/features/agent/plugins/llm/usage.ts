/** token 用量的计算 */

import type { TokenUsage } from './types'

const OPTIONAL_COUNTS = [
  'totalTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'reasoningTokens',
] as const

/** 这次请求的全部输入：未缓存的加上缓存读写 */
export function totalInputTokens(usage: TokenUsage): number {
  return usage.promptTokens ?? usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

/** 累加多次调用的用量。一个回合的总量就是计费的总量，每一步的输入都要算 */
export function addUsage(total: TokenUsage | undefined, usage: TokenUsage): TokenUsage {
  if (!total) return usage
  const sum: TokenUsage = {
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
  }
  if (total.promptTokens !== undefined || usage.promptTokens !== undefined) sum.promptTokens = totalInputTokens(total) + totalInputTokens(usage)
  for (const key of OPTIONAL_COUNTS) {
    if (total[key] !== undefined || usage[key] !== undefined) {
      sum[key] = (total[key] ?? 0) + (usage[key] ?? 0)
    }
  }
  return sum
}

/** 压缩的预算：什么时候触发、逐字保留多少最近内容、摘要最多写多长。W 是上下文窗口，O 是输出预留 */

/** 占用到窗口的这个比例就压缩 */
const THRESHOLD_RATIO = 0.8
/** 逐字保留的最近内容占 W − O 的比例 */
const RETAIN_RATIO = 0.16
/** 输出预留之外再留的余量上限 */
const MAX_HEADROOM_TOKENS = 65_536

/**
 * 输出预留之外再留的余量，也是摘要的输出上限（思考也计入这个上限）。
 * 窗口是用户设的，小窗口放不下固定的余量，所以跟着窗口收缩。
 */
export function headroomTokens(contextWindow: number): number {
  return Math.min(MAX_HEADROOM_TOKENS, Math.floor(contextWindow / 4))
}

export interface CompactionPolicy {
  /** 输入估算达到这个数就压缩 */
  thresholdTokens: number
  /** 逐字保留的最近内容 */
  retainTokens: number
}

export function resolvePolicy(contextWindow: number, outputReserve: number): CompactionPolicy {
  const messageBudget = contextWindow - outputReserve
  return {
    thresholdTokens: Math.floor(
      Math.min(contextWindow * THRESHOLD_RATIO, messageBudget - headroomTokens(contextWindow)),
    ),
    retainTokens: Math.floor(messageBudget * RETAIN_RATIO),
  }
}

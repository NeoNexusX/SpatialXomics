/** 把失败快照翻译成界面文案。文案只在这里按 code 生成，其他地方不解析 message */

import type { LlmFailure } from './types'
import type { ResolvedEndpoint } from '../connection'
import { t } from '@/i18n'
import { LlmCode } from './error'

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

/** 端点原话和请求 id，排查时要用 */
function upstreamDetail(failure: LlmFailure): string {
  const generic = failure.message === `HTTP ${failure.status}`
  const message = generic ? '' : `: ${failure.message}`
  return failure.requestId ? `${message} (${failure.requestId})` : message
}

export function describeFailure(
  failure: LlmFailure,
  endpoint: Pick<ResolvedEndpoint, 'baseUrl'> | null | undefined,
): string {
  const host = endpoint ? hostOf(endpoint.baseUrl) : ''
  const { status } = failure
  const detail = upstreamDetail(failure)
  switch (failure.code) {
    case LlmCode.NO_CONNECTION:
      return t('common.agent.noApiConfigured')
    case LlmCode.INVALID_CREDENTIAL:
      return t('common.agent.errors.invalidKey')
    case LlmCode.AUTH:
      return t('common.agent.errors.auth', { status: status ?? 401 }) + detail
    case LlmCode.QUOTA:
      return t('common.agent.errors.quota') + detail
    case LlmCode.RATE_LIMIT:
      return t('common.agent.errors.rateLimited') + detail
    case LlmCode.CONTEXT_WINDOW_EXCEEDED:
      return t('common.agent.errors.contextWindow') + detail
    case LlmCode.TRANSPORT:
      return t('common.agent.errors.network', { host })
    case LlmCode.STREAM_CLOSED:
      return t('common.agent.errors.interrupted', { host })
    case LlmCode.TIMEOUT:
      return t('common.agent.errors.timeout', { host })
    case LlmCode.MALFORMED_RESPONSE:
      return t('common.agent.errors.badResponse', { host })
    case LlmCode.EMPTY_RESPONSE:
      return t('common.agent.emptyResponse')
  }
  if (status === 404) return t('common.agent.errors.notFound') + detail
  if (status !== undefined) {
    return (
      (status >= 500
        ? t('common.agent.errors.server', { status })
        : t('common.agent.errors.http', { status })) + detail
    )
  }
  return failure.message || t('common.agent.errors.unknown')
}

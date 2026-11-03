import type { ChatMessage, GenerateOptions, LlmFailure, TokenUsage, UserMessage } from '../llm'
import type { ResolvedConnection } from '../connection'
import type { PageState, AnnotationScoreWeights } from '../../bridge/analysisTypes'

export interface AnalysisBinding {
  datasetId: string
  generation: number
  page: PageState
  selection?: {
    clusters: number[]
    pixel?: { index: number; x: number; y: number }
    annotationWeights?: AnnotationScoreWeights
  }
}

export interface RequestSnapshot extends Omit<GenerateOptions, 'messages' | 'onCompatibility'> {
  nodes: number[]
  route: Pick<ResolvedConnection, 'endpoint' | 'baseUrl' | 'model'>
  contextWindow: number
  imageMode: 'image' | 'placeholder'
  purpose: 'conversation' | 'compaction'
}

type Payload =
  | {
      type: 'turn/start'
      turnId: string
      user: UserMessage
      binding: AnalysisBinding
      baseSurface: number[]
      retryOf?: string
    }
  | {
      type: 'turn/end'
      turnId: string
      reason: 'completed' | 'interrupted' | 'failed'
      error?: string
      failure?: LlmFailure
    }
  | { type: 'step/start'; turnId: string; step: number }
  | { type: 'step/end'; turnId: string; step: number }
  | {
      type: 'message'
      turnId?: string
      message: ChatMessage
      callKey?: string
      archiveId?: string
      origin?: 'context'
      /** How the message enters the surface. Omitted means append. */
      surfaceOp?: 'append' | { op: 'replace'; nodes: number[] }
      /** tool-retention 和 image-offload 只出现在旧日志里 */
      surfaceReason?: 'summary' | 'tool-retention' | 'image-offload'
    }
  | {
      type: 'request/context'
      turnId?: string
      attemptId: string
      request: RequestSnapshot
    }
  | {
      type: 'attempt/start'
      turnId: string
      attemptId: string
      step: number
      request: RequestSnapshot
    }
  | {
      type: 'attempt/end'
      turnId: string
      attemptId: string
      status: 'committed' | 'failed' | 'interrupted'
      usage?: TokenUsage
      failure?: LlmFailure
    }
  | {
      type: 'tool/start'
      turnId: string
      callKey: string
      callId: string
      name: string
      input: unknown
    }
  | { type: 'surface/reset'; nodes: number[] }
  /** 只出现在旧日志里。现在摘要请求可以从日志还原，不再单独记录 */
  | { type: 'compaction/request'; compactionId: string; inputId: string; request: RequestSnapshot }
  | { type: 'compaction/start'; compactionId: string; nodes: number[] }
  | {
      type: 'compaction/summary'
      compactionId: string
      summary: string
      route: Pick<ResolvedConnection, 'endpoint' | 'baseUrl' | 'model'>
      maxTokens: number
    }
  | {
      type: 'compaction/end'
      compactionId: string
      error?: string
      beforeTokens?: number
      afterTokens?: number
      usage?: TokenUsage
    }
  | { type: 'instructions/set'; name: string; text: string }
  | {
      type: 'transport/strategy'
      attemptId: string
      strategy: { replay: string; thinking: string }
    }

export type SessionEventInput = Payload
export type SessionEvent = Payload & { seq: number; id: string; time: number }

export function eventMessage(event: SessionEvent): ChatMessage | undefined {
  if (event.type === 'message') return event.message
  return undefined
}

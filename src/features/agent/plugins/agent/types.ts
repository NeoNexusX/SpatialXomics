import type { ResolvedConnection } from '../connection'
import type { LlmFailure, ResolvedRetryPolicy, TokenUsage, ToolSchema, UserMessage } from '../llm'
import type { AnalysisBinding, Session, SessionEventInput } from '../session'
import type { ToolExecutionResult } from '../tools'
import type { LiveAttempt, UiChatItem } from '../session-transcript'
import type { ContextPressure } from '../token-meter'
import type { SessionArchive, SessionStorage, StoredSessionInfo } from '../session-persistence'

declare module '@deepseek-ai/cordis' {
  /** 循环的扩展点。监听方抛错就结束这一轮，不会影响下一轮 */
  interface Events {
    /** 轮次开始、每步开始、每个工具前后各检查一次，还能不能继续 */
    'agent/guard'(binding: AnalysisBinding, toolName?: string): void
    /** 提交轮次开头的事件之前，追加同批提交的事件 */
    'agent/pre-turn'(context: TurnStart, next: () => SessionEventInput[]): SessionEventInput[]
    /** request/context 提交之后、请求发出之前 */
    'agent/pre-request'(attempt: AttemptContext): void | Promise<void>
    /** 请求失败后决定要不要重试，都不处理时这一轮以失败结束 */
    'agent/request-error'(
      failed: RequestFailure,
      next: () => Promise<RequestRecovery>,
    ): Promise<RequestRecovery>
    /** 工具结果写进历史之前，决定模型看到什么 */
    'agent/tool-result'(
      context: ToolResultContext,
      next: () => Promise<StoredToolResult>,
    ): Promise<StoredToolResult>
  }
}

export interface TurnStart {
  plan: TurnPlan
  turnId: string
}

/** 一次请求尝试的上下文 */
export interface AttemptContext {
  session: Session
  turnId: string
  step: number
  attemptId: string
  system: string
  tools: ToolSchema[]
  connection: ResolvedConnection
  contextWindow: number
  /** 这次请求给输出预留的 token 数 */
  outputReserve: number
  signal: AbortSignal
  setPhase(phase: AgentPhase): void
  notify(): void
  /** 上下文变了之后，按当前内容重新提交 request/context */
  recordRequest(): Promise<void>
}

export interface RequestFailure extends AttemptContext {
  failure: LlmFailure
  retryPolicy: ResolvedRetryPolicy
  /** 让界面显示正在等第几次重试 */
  showRetry(retry: number, maxRetries: number): void
}

export type RequestRecovery = { kind: 'retry' } | undefined

export interface ToolResultContext {
  session: Session
  signal: AbortSignal
  result: ToolExecutionResult
}

export interface StoredToolResult {
  attachments?: import('../llm').ImageAttachment[]
  isError?: boolean
  content: string
  archiveId?: string
}

export type AgentPhase =
  | 'restoring'
  | 'idle'
  | 'preparing'
  | 'generating'
  | 'executing-tools'
  | 'compacting'
  | 'stopping'
  | 'storage-error'
  | 'disposed'
export interface AgentSnapshot {
  sessionId: string
  phase: AgentPhase
  mode: SessionStorage['mode']
  messages: UiChatItem[]
  error: string | null
  pressure?: ContextPressure
  tokenUsage?: TokenUsage
  instructions?: { name: string; text: string }
}

/** Consumers depend on this contract, never on a loop implementation. */
export interface Agent {
  ready(): Promise<void>
  snapshot(): AgentSnapshot
  subscribe(listener: (snapshot: AgentSnapshot) => void): () => void
  send(text: string, images?: string[]): Promise<boolean>
  stop(): void
  whenIdle(): Promise<void>
  regenerate(): Promise<boolean>
  compact(): Promise<void>
  conversations(): Promise<StoredSessionInfo[]>
  newConversation(): Promise<void>
  openConversation(id: string): Promise<void>
  deleteConversation(id: string): Promise<void>
  importConversation(archive: SessionArchive): Promise<void>
  retrySave(): Promise<void>
  setInstructions(name: string, text: string): Promise<void>
  imageUrl(id: string): Promise<string>
  dispose(): Promise<void>
}

export interface TurnPlan {
  user: UserMessage
  binding: AnalysisBinding
  system: string
  connection?: ResolvedConnection
  retryOf?: string
  baseSurface?: number[]
}

export interface AgentDriver {
  readonly phase: AgentPhase
  readonly error: string | null
  readonly live?: LiveAttempt
  send(plan: TurnPlan): Promise<boolean>
  stop(): void
  whenIdle(): Promise<void>
  compact(system: string, binding: AnalysisBinding): Promise<void>
  storageRecovered(): void
}

/** 驱动器由实现插件注册，ctx.agent 为每个会话创建一个 */
export type DriverFactory = (session: Session, notify: () => void) => AgentDriver

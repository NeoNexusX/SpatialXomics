import type { Context } from '@deepseek-ai/cordis'
import type { AssistantMessage, ImageAttachment, PreparedLlmCall, ToolSchema } from '../llm'
import type { AnalysisBinding, RequestSnapshot, Session, SessionEventInput } from '../session'
import type {
  AgentDriver,
  AgentPhase,
  AttemptContext,
  RequestRecovery,
  StoredToolResult,
  TurnPlan,
} from '../agent'
import { newId } from '../session-persistence'
import {
  BlockAssembler,
  DEFAULT_CONTEXT_WINDOW,
  describeFailure,
  getContextWindow,
  hasDeliverableContent,
  MAX_OUTPUT_TOKENS,
  normalizeLlmFailure,
  parseToolArguments,
} from '../llm'
import type { LiveAttempt } from '../session-transcript'
import { t } from '@/i18n'

/**
 * 循环驱动器：一个任务负责一轮的全部过程，包括取消后的收尾。
 * 只管轮次、步骤、尝试和工具调度，其余策略都由监听 agent/* 事件的插件决定。
 */
export class LoopDriver implements AgentDriver {
  phase: AgentPhase = 'idle'
  error: string | null = null
  live?: LiveAttempt
  private controller?: AbortController
  private activity: Promise<void> = Promise.resolve()

  constructor(
    readonly session: Session,
    private ctx: Context,
    private notify: () => void,
  ) {}

  send(plan: TurnPlan): Promise<boolean> {
    if (this.phase !== 'idle') return Promise.resolve(false)
    this.phase = 'preparing'
    this.error = null
    this.controller = new AbortController()
    const signal = this.controller.signal
    let acknowledge!: (accepted: boolean) => void
    const accepted = new Promise<boolean>((resolve) => {
      acknowledge = resolve
    })
    this.activity = this.run(plan, signal, acknowledge).finally(() => {
      acknowledge(false)
      this.live = undefined
      this.controller = undefined
      this.phase = this.session.hasUnstoredBatch ? 'storage-error' : 'idle'
      this.notify()
    })
    this.notify()
    return accepted
  }

  stop(): void {
    if (!this.controller) return
    this.phase = 'stopping'
    this.controller.abort()
    this.notify()
  }

  async whenIdle(): Promise<void> {
    await this.activity
  }

  storageRecovered(): void {
    this.phase = 'idle'
    this.error = null
    this.notify()
  }

  private status(phase: AgentPhase): void {
    this.phase = phase
    this.notify()
  }

  private guard(binding: AnalysisBinding, toolName?: string): void {
    this.ctx.bail('agent/guard', binding, toolName)
  }

  /** 顺序要固定：工具列表是请求前缀的一部分，变了端点的提示词缓存就失效了 */
  private toolSchemas(): ToolSchema[] {
    return this.ctx.tools.schemas().sort((a, b) => a.name.localeCompare(b.name))
  }

  private async run(
    plan: TurnPlan,
    signal: AbortSignal,
    acknowledge: (accepted: boolean) => void,
  ): Promise<void> {
    const turnId = newId()
    let opened = false
    let ended = false
    try {
      this.guard(plan.binding)
      const current = plan.connection ?? this.ctx.connection.current()
      if (!current) throw new Error(t('common.agent.noApiConfigured'))
      const connection = Object.freeze({ ...current })
      const resolved = await this.ctx.llm.prepareCall(signal, { connection })
      const contextWindow = getContextWindow(
        connection,
        connection.model,
        resolved.model.context?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      )
      const tools = this.toolSchemas()
      const maxTokens = Math.min(MAX_OUTPUT_TOKENS, Math.floor(contextWindow / 4))
      const firstCall =
        maxTokens === resolved.maxTokens
          ? resolved
          : await this.ctx.llm.prepareCall(signal, { connection, maxTokens })
      signal.throwIfAborted()
      const baseSurface = plan.baseSurface ?? this.session.nodes
      const start: SessionEventInput[] = []
      if (plan.retryOf) start.push({ type: 'surface/reset', nodes: baseSurface })
      start.push(
        {
          type: 'turn/start',
          turnId,
          user: plan.user,
          binding: plan.binding,
          baseSurface,
          retryOf: plan.retryOf,
        },
        { type: 'message', turnId, message: plan.user },
      )
      start.push(...this.ctx.waterfall('agent/pre-turn', { plan, turnId }, () => []))
      await this.session.commit(start)
      opened = true
      acknowledge(true)
      let call = firstCall
      // step 数不设上限：模型不再调工具时这一轮结束，失控时靠用户停止或超窗失败
      for (let step = 1; ; step++) {
        signal.throwIfAborted()
        this.guard(plan.binding)
        await this.session.commit([{ type: 'step/start', turnId, step }])
        while (true) {
          signal.throwIfAborted()
          const attemptId = newId()
          let request = this.requestSnapshot(plan.system, tools, call, contextWindow, turnId)
          await this.session.commit([{ type: 'request/context', turnId, attemptId, request }])
          const attempt: AttemptContext = {
            session: this.session,
            turnId,
            step,
            attemptId,
            system: plan.system,
            tools,
            connection,
            contextWindow,
            outputReserve: call.maxTokens,
            signal,
            setPhase: (phase) => this.status(phase),
            notify: () => this.notify(),
            recordRequest: async () => {
              request = this.requestSnapshot(plan.system, tools, call, contextWindow, turnId)
              await this.session.commit([{ type: 'request/context', turnId, attemptId, request }])
            },
          }
          await this.ctx.serial('agent/pre-request', attempt)
          const storedMessages = this.session.deriveMessages(request.nodes)
          const messages = await this.ctx.attachments.hydrate(this.session.storage, storedMessages)
          signal.throwIfAborted()
          await this.session.commit([{ type: 'attempt/start', turnId, step, attemptId, request }])
          this.live = { turnId, attemptId, parts: [] }
          this.status('generating')
          const assembler = new BlockAssembler()
          try {
            for await (const chunk of call.stream(
              {
                system: plan.system,
                tools,
                messages,
                turnStart: request.turnStart,
                onCompatibility: async (strategy) => {
                  signal.throwIfAborted()
                  await this.session.commit([{ type: 'transport/strategy', attemptId, strategy }])
                },
              },
              signal,
            )) {
              if (signal.aborted) break
              assembler.push(chunk)
              this.live = { turnId, attemptId, parts: assembler.blocks() }
              this.notify()
            }
          } catch (error) {
            if (!signal.aborted)
              assembler.push({
                type: 'finish',
                reason: { kind: 'error', failure: normalizeLlmFailure(error) },
              })
          }
          const finish = assembler.finish
          if (signal.aborted) {
            const parts = assembler.interruptedBlocks()
            const settlement: SessionEventInput[] = [
              {
                type: 'attempt/end',
                turnId,
                attemptId,
                status: 'interrupted',
                usage: assembler.usage,
              },
            ]
            if (hasDeliverableContent(parts))
              settlement.push({
                type: 'message',
                turnId,
                message: {
                  role: 'assistant',
                  parts,
                  source: {
                    endpoint: connection.endpoint,
                    baseUrl: connection.baseUrl,
                    model: connection.model,
                  },
                },
              })
            this.live = undefined
            await this.session.commit(settlement)
            signal.throwIfAborted()
          }
          if (finish.kind === 'error' || finish.kind === 'aborted') {
            this.live = undefined
            await this.session.commit([
              {
                type: 'attempt/end',
                turnId,
                attemptId,
                status: 'failed',
                usage: assembler.usage,
                failure: finish.failure,
              },
            ])
            const recovery = await this.ctx.waterfall(
              'agent/request-error',
              {
                ...attempt,
                failure: finish.failure,
                retryPolicy: call.retryPolicy,
                showRetry: (retry, maxRetries) => {
                  this.live = { turnId, attemptId, parts: [], retrying: { retry, maxRetries } }
                  this.notify()
                },
              },
              async (): Promise<RequestRecovery> => undefined,
            )
            if (recovery?.kind !== 'retry')
              throw new Error(describeFailure(finish.failure, connection))
            call = firstCall.again()
            continue
          }
          const message: AssistantMessage = {
            role: 'assistant',
            parts: assembler.blocks(),
            source: {
              endpoint: connection.endpoint,
              baseUrl: connection.baseUrl,
              model: connection.model,
              replayState: assembler.replayState,
            },
          }
          const settlement: SessionEventInput[] = [
            { type: 'attempt/end', turnId, attemptId, status: 'committed', usage: assembler.usage },
          ]
          if (hasDeliverableContent(message.parts))
            settlement.push({ type: 'message', turnId, message })
          this.live = undefined
          const committed = await this.session.commit(settlement)
          if (finish.kind === 'refusal') throw new Error(t('common.agent.errors.refused'))
          if (finish.kind === 'max-tokens') throw new Error(t('common.agent.errors.outputLimit'))
          if (!hasDeliverableContent(message.parts))
            throw new Error(t('common.agent.emptyResponse'))
          const agentEvent = committed.find((event) => event.type === 'message')!
          const calls = message.parts.flatMap((part, index) =>
            part.type === 'tool-call' ? [{ ...part, callKey: `${agentEvent.seq}:${index}` }] : [],
          )
          if (!calls.length) {
            await this.session.commit([
              { type: 'step/end', turnId, step },
              { type: 'turn/end', turnId, reason: 'completed' },
            ])
            ended = true
            return
          }
          this.status('executing-tools')
          for (const tool of calls) {
            signal.throwIfAborted()
            this.guard(plan.binding, tool.name)
            const input = parseToolArguments(tool.arguments)
            await this.session.commit([
              {
                type: 'tool/start',
                turnId,
                callKey: tool.callKey,
                callId: tool.id,
                name: tool.name,
                input: input ?? null,
              },
            ])
            const result = await this.ctx.tools.execute({
              callId: tool.id,
              name: tool.name,
              arguments: input,
              signal,
              allowedTools: tools.map((schema) => schema.name),
              session: this.session,
            })
            signal.throwIfAborted()
            this.guard(plan.binding)
            const pendingImages: ImageAttachment[] = []
            try {
              const stored = await this.ctx.waterfall(
                'agent/tool-result',
                { session: this.session, signal, result },
                async (): Promise<StoredToolResult> => {
                  try {
                    const attachments = await this.ctx.attachments.saveTools(
                      this.session.storage,
                      result.images ?? [],
                      signal,
                    )
                    pendingImages.push(...attachments)
                    return {
                      content: result.content,
                      ...(attachments.length ? { attachments } : {}),
                    }
                  } catch (error) {
                    signal.throwIfAborted()
                    return { content: `Tool image storage failed: ${String(error)}`, isError: true }
                  }
                },
              )
              signal.throwIfAborted()
              await this.session.commit([
                {
                  type: 'message',
                  turnId,
                  callKey: tool.callKey,
                  archiveId: stored.archiveId,
                  message: {
                    role: 'tool',
                    toolCallId: tool.id,
                    name: tool.name,
                    content: stored.content,
                    isError: stored.isError ?? result.isError,
                    ...(stored.attachments?.length ? { attachments: stored.attachments } : {}),
                  },
                },
              ])
            } catch (error) {
              if (!this.session.hasUnstoredBatch) {
                await Promise.allSettled(
                  pendingImages.map((ref) => this.session.storage.deleteArtifact(ref.id)),
                )
              }
              throw error
            }
          }
          await this.session.commit([{ type: 'step/end', turnId, step }])
          call = firstCall.again()
          break
        }
      }
    } catch (error) {
      this.error = signal.aborted ? null : error instanceof Error ? error.message : String(error)
      if (opened && !ended && !this.session.hasUnstoredBatch) {
        const closers = this.session.toolClosers(turnId)
        const openStep = [...this.session.events]
          .reverse()
          .find((event) => event.type === 'step/start' && event.turnId === turnId)
        const stepEnded =
          openStep?.type === 'step/start' &&
          this.session.events.some(
            (event) =>
              event.type === 'step/end' && event.turnId === turnId && event.step === openStep.step,
          )
        if (openStep?.type === 'step/start' && !stepEnded)
          closers.push({ type: 'step/end', turnId, step: openStep.step })
        closers.push({
          type: 'turn/end',
          turnId,
          reason: signal.aborted ? 'interrupted' : 'failed',
          error: this.error ?? undefined,
        })
        try {
          await this.session.commit(closers)
        } catch (saveError) {
          this.error = String(saveError)
        }
      }
      acknowledge(false)
    }
  }

  private requestSnapshot(
    system: string,
    tools: ToolSchema[],
    call: PreparedLlmCall,
    contextWindow: number,
    turnId: string,
  ): RequestSnapshot {
    const nodes = this.session.nodes
    const turnStart = nodes.findIndex((seq) => {
      const event = this.session.events[seq]!
      return event.type === 'message' && event.turnId === turnId && event.message.role === 'user'
    })
    return {
      system,
      tools,
      nodes,
      route: {
        endpoint: call.connection.endpoint,
        baseUrl: call.connection.baseUrl,
        model: call.connection.model,
      },
      maxTokens: call.maxTokens,
      contextWindow,
      imageMode: 'image',
      purpose: 'conversation',
      turnStart,
    }
  }

  async compact(system: string, binding: AnalysisBinding): Promise<void> {
    if (this.phase !== 'idle') return
    this.controller = new AbortController()
    const signal = this.controller.signal
    this.status('compacting')
    this.activity = (async () => {
      try {
        this.guard(binding)
        const call = await this.ctx.llm.prepareCall(signal)
        const contextWindow = getContextWindow(
          call.connection,
          call.connection.model,
          call.model.context?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
        )
        const changed = await this.ctx.get('compaction')?.compact({
          session: this.session,
          system,
          tools: this.toolSchemas(),
          connection: call.connection,
          contextWindow,
          signal,
          setPhase: (phase) => this.status(phase),
          notify: () => this.notify(),
        })
        if (!changed) this.error = t('common.agent.compactionNoProgress')
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
      } finally {
        this.controller = undefined
        this.phase = this.session.hasUnstoredBatch ? 'storage-error' : 'idle'
        this.notify()
      }
    })()
    await this.activity
  }
}

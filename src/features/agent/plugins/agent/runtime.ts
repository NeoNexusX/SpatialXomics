/**
 * ctx.agent 服务：界面面对的 Agent 门面。
 *
 * 管会话的打开和切换、提问的准入、状态快照。具体怎么跑一轮由驱动器决定，
 * 驱动器和存储、提示词、绑定都来自各自的插件。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent, AgentDriver, AgentSnapshot, DriverFactory, TurnPlan } from './types'
import type { Instructions } from '../agent-instructions'
import type { ContextPressure } from '../token-meter'
import type { TokenUsage } from '../llm'
import type { AnalysisBinding, Session } from '../session'
import {
  SessionBusyError,
  type SessionArchive,
  type SessionStorage,
  type SessionTarget,
  type StoredSessionInfo,
} from '../session-persistence'
import { withLiveTranscript } from '../session-transcript'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agent: AgentRuntime
  }
}

export class AgentRuntime extends Service implements Agent {
  static inject = [
    'analysisBinding',
    'attachments',
    'connection',
    'sessionPersistence',
    'sessionProjections',
    'sessions',
    'systemPrompt',
  ]

  private session?: Session
  private driver?: AgentDriver
  private driverFactory?: DriverFactory
  private opening?: Promise<void>
  private transition: Promise<void> = Promise.resolve()
  private transitionCount = 0
  private instructionTask: Promise<void> = Promise.resolve()
  private changing = false
  private disposed = false
  private admission?: AbortController
  private admissionTask: Promise<boolean> = Promise.resolve(false)
  private listeners = new Set<(snapshot: AgentSnapshot) => void>()
  private storageError: string | null = null
  private actionError: string | null = null
  private unsubscribeSession?: () => void

  constructor(ctx: Context) {
    super(ctx, 'agent')
    ctx.on('analysis-binding/changed', () => {
      this.stop()
      if (this.opening && !this.disposed) void this.followDataset()
    })
    ctx.effect(() => () => this.dispose())
  }

  /** 实现插件注册驱动器工厂，返回注销函数 */
  setDriverFactory(factory: DriverFactory): () => void {
    this.driverFactory = factory
    return () => {
      if (this.driverFactory === factory) this.driverFactory = undefined
    }
  }

  async ready(): Promise<void> {
    if (this.disposed) throw new Error('Agent is disposed')
    await this.transition
    this.opening ??= this.open('last')
    await this.opening
  }

  private async restore(storage: SessionStorage): Promise<Session> {
    try {
      if (!this.driverFactory) throw new Error('No agent driver is registered')
      return await this.ctx.sessions.restore(storage)
    } catch (error) {
      await storage.close()
      throw error
    }
  }

  private attach(session: Session): void {
    this.session = session
    this.driver = this.driverFactory!(session, () => this.publish())
    this.unsubscribeSession = session.subscribe(() => {
      this.publish()
    })
    this.storageError = null
    this.actionError = null
    this.publish()
  }

  private openStorage(target: SessionTarget): Promise<SessionStorage> {
    return this.ctx.sessionPersistence.open(this.ctx.analysisBinding.datasetId(), target)
  }

  private async open(target: SessionTarget): Promise<void> {
    const storage = await this.openStorage(target)
    try {
      this.attach(await this.restore(storage))
    } catch (error) {
      this.storageError = String(error)
      this.publish()
      throw error
    }
  }

  snapshot(): AgentSnapshot {
    const driver = this.driver
    const session = this.session
    let phase = driver?.phase ?? 'restoring'
    if (this.admission && phase === 'idle')
      phase = this.admission.signal.aborted ? 'stopping' : 'preparing'
    if (this.changing) phase = 'restoring'
    if (this.storageError || session?.hasUnstoredBatch) phase = 'storage-error'
    if (this.disposed) phase = 'disposed'
    const projected = session
      ? this.ctx.sessionProjections.viewOf<AgentSnapshot['messages']>(session, 'transcript')
      : undefined
    const messages = withLiveTranscript(projected ?? [], driver?.live).map((item) => ({
      ...item,
    }))
    for (const message of messages) {
      if (message.attachments?.length)
        message.images = message.attachments
          .map((ref) => this.ctx.attachments.urlOf(session!.storage, ref.id))
          .filter((url): url is string => !!url)
      message.parts = message.parts?.map((part) => {
        if (part.type !== 'tool' || !part.attachments?.length) return part
        return {
          ...part,
          images: part.attachments.map(
            (ref) => this.ctx.attachments.urlOf(session!.storage, ref.id) ?? '',
          ),
        }
      })
      if (session?.storage.mode === 'read-only' && message.pending) {
        message.pending = false
        message.interrupted = true
      }
    }
    return {
      sessionId: session?.storage.id ?? '',
      phase,
      mode: session?.storage.mode ?? 'temporary',
      messages,
      error: this.storageError ?? this.actionError ?? driver?.error ?? null,
      pressure: session
        ? this.ctx.sessionProjections.viewOf<ContextPressure>(session, 'contextPressure')
        : undefined,
      tokenUsage: session
        ? this.ctx.sessionProjections.viewOf<TokenUsage>(session, 'tokenUsage')
        : undefined,
      instructions: session
        ? this.ctx.sessionProjections.viewOf<Instructions>(session, 'instructions')
        : undefined,
    }
  }

  subscribe(listener: (snapshot: AgentSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  private publish(): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch (error) {
        console.error('Agent observer failed', error)
      }
    }
    const storage = this.session?.storage
    if (!storage) return
    for (const item of snapshot.messages)
      for (const ref of [
        ...(item.attachments ?? []),
        ...(item.parts ?? []).flatMap((part) =>
          part.type === 'tool' ? (part.attachments ?? []) : [],
        ),
      ]) {
        if (this.ctx.attachments.requested(storage, ref.id)) continue
        void this.imageUrl(ref.id)
          .then(() => this.publish())
          .catch((error) => {
            console.error('Attachment unavailable', error)
          })
      }
  }

  private renderPrompt(binding: AnalysisBinding): string {
    return this.ctx.systemPrompt.render({ session: this.session!, binding })
  }

  send(text: string, images?: string[]): Promise<boolean> {
    if (
      this.admission ||
      this.changing ||
      this.disposed ||
      (this.driver && this.driver.phase !== 'idle')
    )
      return Promise.resolve(false)
    if (!text.trim() && !images?.length) return Promise.resolve(false)
    const controller = new AbortController()
    this.actionError = null
    this.admission = controller
    const binding = this.ctx.analysisBinding.capture()
    const connection = this.ctx.connection.current()
    this.admissionTask = (async () => {
      try {
        await this.ready()
        controller.signal.throwIfAborted()
        if (this.session!.storage.mode === 'read-only')
          throw new Error('This conversation is open in another tab')
        this.ctx.analysisBinding.assert(binding)
        const attachments = []
        for (const image of images ?? []) {
          attachments.push(await this.ctx.attachments.save(this.session!.storage, image))
          controller.signal.throwIfAborted()
        }
        const plan: TurnPlan = {
          user: { role: 'user', content: text, ...(attachments.length ? { attachments } : {}) },
          binding,
          system: this.renderPrompt(binding),
          connection: connection ?? undefined,
        }
        return await this.driver!.send(plan)
      } catch (error) {
        if (!controller.signal.aborted)
          this.actionError = error instanceof Error ? error.message : String(error)
        return false
      } finally {
        this.admission = undefined
        this.publish()
      }
    })()
    this.publish()
    return this.admissionTask
  }

  stop(): void {
    this.admission?.abort()
    this.driver?.stop()
  }

  async whenIdle(): Promise<void> {
    await this.admissionTask
    await this.driver?.whenIdle()
    await this.instructionTask.catch(() => {})
  }

  async regenerate(): Promise<boolean> {
    if (this.admission || this.changing || this.driver?.phase !== 'idle') return false
    const turn = [...this.session!.events].reverse().find((event) => event.type === 'turn/start')
    if (turn?.type !== 'turn/start') return false
    const binding = this.ctx.analysisBinding.rebase(turn.binding)
    try {
      this.ctx.analysisBinding.assert(binding)
      return await this.driver!.send({
        user: turn.user,
        binding,
        retryOf: turn.turnId,
        baseSurface: turn.baseSurface,
        system: this.renderPrompt(binding),
      })
    } catch (error) {
      this.actionError = error instanceof Error ? error.message : String(error)
      this.publish()
      return false
    }
  }

  async compact(): Promise<void> {
    await this.ready()
    if (this.admission || this.changing) return
    const binding = this.ctx.analysisBinding.captureDataset()
    await this.driver!.compact(this.renderPrompt(binding), binding)
  }

  async retrySave(): Promise<void> {
    try {
      if (!this.session) {
        this.opening = undefined
        await this.ready()
        return
      }
      await this.whenIdle()
      await this.session.retrySave()
      await this.session.recover()
      this.driver!.storageRecovered()
      this.storageError = null
    } catch (error) {
      this.storageError = String(error)
    }
    this.publish()
  }

  /** 当前数据集的对话。空白的不算，它们随时可以被复用或回收 */
  async conversations(): Promise<StoredSessionInfo[]> {
    const sessions = await this.ctx.sessionPersistence.list(this.ctx.analysisBinding.datasetId())
    return sessions.filter((session) => !session.blank)
  }

  /** 当前对话还是空白的就留在原地。到上限时抛 SessionLimitError，当前对话不受影响 */
  newConversation(): Promise<void> {
    return this.whenNotRunning(() =>
      this.enqueue(async () => {
        if (this.vacant()) return
        await this.swapTo('new')
      }),
    )
  }

  openConversation(id: string): Promise<void> {
    return this.whenNotRunning(() =>
      this.enqueue(async () => {
        if (this.session?.storage.id !== id) await this.swapTo({ id })
      }),
    )
  }

  /** 删掉当前对话后回到最近更新的一段；一段都不剩就新建 */
  deleteConversation(id: string): Promise<void> {
    return this.whenNotRunning(async () => {
      const scope = this.ctx.analysisBinding.datasetId()
      const current = this.session?.storage
      if (current && current.id !== id) return this.ctx.sessionPersistence.remove(scope, id)
      if (current?.mode === 'read-only') throw new SessionBusyError()
      // 没有当前对话说明它打不开，删掉后同样要重新打开一段
      return this.enqueue(async () => {
        await this.closeSession()
        try {
          await this.ctx.sessionPersistence.remove(scope, id)
        } finally {
          this.opening = this.open('last')
          await this.opening
        }
      })
    })
  }

  /** 写入后切到导入的对话。当前对话还是空白的就让出位置，失败时再打开回来 */
  importConversation(archive: SessionArchive): Promise<void> {
    return this.whenNotRunning(() =>
      this.enqueue(async () => {
        const vacated = this.vacant()
        if (vacated) await this.closeSession()
        try {
          const id = await this.ctx.sessionPersistence.importSession(
            this.ctx.analysisBinding.datasetId(),
            archive,
          )
          await this.swapTo({ id })
        } catch (error) {
          if (vacated && !this.session) {
            this.opening = this.open('last')
            await this.opening
          }
          throw error
        }
      }),
    )
  }

  /** 当前对话可写，而且还没有提问过 */
  private vacant(): boolean {
    return (
      !!this.session &&
      this.session.storage.mode !== 'read-only' &&
      !this.session.events.some((event) => event.type === 'turn/start')
    )
  }

  /** 用户发起的切换不打断运行中的轮次。保存失败时不算运行中，要能切走或删除别的对话腾空间 */
  private whenNotRunning(action: () => Promise<void>): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Agent is disposed'))
    const phase = this.driver?.phase ?? 'idle'
    if (this.admission || this.changing || (phase !== 'idle' && phase !== 'storage-error'))
      return Promise.reject(new Error('Wait for the current turn to finish'))
    return action()
  }

  /** 先打开目标，成功了才放下当前对话。打不开时当前对话不受影响 */
  private async swapTo(target: SessionTarget): Promise<void> {
    const session = await this.restore(await this.openStorage(target))
    await this.closeSession()
    this.opening = Promise.resolve()
    this.attach(session)
  }

  /** 换了数据集：作废当前对话，打开新数据集上次的对话 */
  private followDataset(): Promise<void> {
    return this.enqueue(async () => {
      try {
        await this.closeSession()
        if (!this.disposed) {
          this.opening = this.open('last')
          await this.opening
        }
      } catch (error) {
        this.storageError = String(error)
      }
    })
  }

  /** 切换排队执行，进行期间界面看到的是 restoring。step 的错误抛给调用方 */
  private enqueue(step: () => Promise<void>): Promise<void> {
    this.transitionCount++
    this.changing = true
    this.stop()
    const run = this.transition
      .then(async () => {
        await this.whenIdle()
        await this.opening?.catch(() => {})
        await step()
      })
      .finally(() => {
        this.transitionCount--
        this.changing = this.transitionCount > 0
        this.publish()
      })
    this.transition = run.catch(() => {})
    this.publish()
    return run
  }

  async setInstructions(name: string, text: string): Promise<void> {
    await this.ready()
    if (this.admission || this.changing || this.driver!.phase !== 'idle')
      throw new Error('Wait for the current turn to finish')
    if (new TextEncoder().encode(text).length > 65_536)
      throw new Error('Instruction document exceeds 64 KiB')
    this.changing = true
    this.instructionTask = (async () => {
      try {
        await this.session!.commit([{ type: 'instructions/set', name, text }])
      } finally {
        this.changing = this.transitionCount > 0
        this.publish()
      }
    })()
    await this.instructionTask
  }

  async imageUrl(id: string): Promise<string> {
    const session = this.session
    if (!session) throw new Error('No active conversation')
    return this.ctx.attachments.load(session.storage, id)
  }

  private async closeSession(): Promise<void> {
    this.unsubscribeSession?.()
    const storage = this.session?.storage
    await storage?.close()
    if (storage) this.ctx.attachments.release(storage)
    this.session = undefined
    this.driver = undefined
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.stop()
    await this.transition
    await this.whenIdle()
    await this.opening?.catch(() => {})
    await this.closeSession()
    this.publish()
    this.listeners.clear()
  }
}

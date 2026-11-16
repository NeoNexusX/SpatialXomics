import type { ChatMessage } from '../llm'
import { makeBatch, newId, type SessionStorage, type StoredBatch } from '../session-persistence'
import { eventMessage, type SessionEvent, type SessionEventInput } from './types'
import { parseEvent } from './schema'
import type { SessionProjections } from '../session-projection'
import { SurfaceFold } from './surface'

function freezeJson<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeJson(child)
    Object.freeze(value)
  }
  return value
}

/** Only this object can commit session facts. A failed batch stays retryable. */
export class Session {
  private log: readonly SessionEvent[] = Object.freeze([])
  private fold = new SurfaceFold()
  private derived?: { nodes: number[]; messages: ChatMessage[] }
  private listeners = new Set<() => void>()
  /** 写入失败、等着重新保存的批次。写入进行中不算 */
  private failedBatch: StoredBatch | undefined
  private writes: Promise<unknown> = Promise.resolve()

  constructor(
    readonly storage: SessionStorage,
    private readonly projections?: SessionProjections,
  ) {}
  get events(): readonly SessionEvent[] {
    return this.log
  }
  get nodes(): number[] {
    return [...this.fold.nodes]
  }
  get hasUnstoredBatch(): boolean {
    return this.failedBatch !== undefined
  }

  async restore(): Promise<void> {
    const events = (await this.storage.read()).flatMap((batch) => batch.events).map(parseEvent)
    events.forEach((event, seq) => {
      if (event.seq !== seq) throw new Error('Invalid session sequence')
    })
    const fold = new SurfaceFold()
    for (const event of events) fold.push(event, events)
    this.log = Object.freeze(events.map(freezeJson))
    this.fold = fold
    this.derived = undefined
    this.projections?.reset(this, this.log)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async commit(inputs: SessionEventInput[]): Promise<SessionEvent[]> {
    if (inputs.length === 0) return []
    const run = this.writes.then(async () => {
      if (this.failedBatch) throw new Error('Save the failed session batch before continuing')
      const events = inputs.map((input, i) =>
        parseEvent(
          JSON.parse(
            JSON.stringify({ ...input, seq: this.log.length + i, id: newId(), time: Date.now() }),
          ),
        ),
      )
      const next = this.fold.clone()
      for (const event of events) next.push(event, this.log)
      const batch = makeBatch(newId(), this.log.length, events)
      try {
        await this.storage.append(batch)
      } catch (error) {
        this.failedBatch = batch
        throw error
      }
      this.log = Object.freeze([...this.log, ...events.map(freezeJson)])
      this.fold = next
      this.derived = undefined
      for (const event of events) this.projections?.push(this, event)
      this.notify()
      return events
    })
    this.writes = run.catch(() => {})
    return run
  }

  async retrySave(): Promise<void> {
    await this.writes
    const batch = this.failedBatch
    if (!batch) return
    const parsed = batch.events.map(parseEvent)
    const next = this.fold.clone()
    for (const event of parsed) next.push(event, this.log)
    await this.storage.append(batch)
    const events = parsed.map(freezeJson)
    this.log = Object.freeze([...this.log, ...events])
    this.fold = next
    this.derived = undefined
    for (const event of events) this.projections?.push(this, event)
    this.failedBatch = undefined
    this.notify()
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.error('Session observer failed', error)
      }
    }
  }

  deriveMessages(nodes = this.nodes): ChatMessage[] {
    const current = this.fold.nodes
    const isCurrent =
      nodes.length === current.length && nodes.every((seq, index) => seq === current[index])
    if (isCurrent && this.derived) return [...this.derived.messages]
    const messages = nodes.map((seq) => {
      const message = eventMessage(this.log[seq]!)
      if (!message) throw new Error('Missing surface message')
      return message
    })
    if (isCurrent) this.derived = { nodes: [...nodes], messages }
    return [...messages]
  }

  async recover(): Promise<void> {
    const closers: SessionEventInput[] = []
    const openAttempts = new Map<string, Extract<SessionEvent, { type: 'attempt/start' }>>()
    const openSteps = new Map<string, Extract<SessionEvent, { type: 'step/start' }>>()
    const openCompactions = new Set<string>()
    const openTurns = new Set<string>()
    for (const event of this.log) {
      if (event.type === 'turn/start') openTurns.add(event.turnId)
      if (event.type === 'turn/end') openTurns.delete(event.turnId)
      if (event.type === 'step/start') openSteps.set(`${event.turnId}:${event.step}`, event)
      if (event.type === 'step/end') openSteps.delete(`${event.turnId}:${event.step}`)
      if (event.type === 'attempt/start') openAttempts.set(event.attemptId, event)
      if (event.type === 'attempt/end') openAttempts.delete(event.attemptId)
      if (event.type === 'compaction/start') openCompactions.add(event.compactionId)
      if (event.type === 'compaction/end') openCompactions.delete(event.compactionId)
    }
    for (const event of openAttempts.values())
      closers.push({
        type: 'attempt/end',
        turnId: event.turnId,
        attemptId: event.attemptId,
        status: 'interrupted',
      })
    for (const turnId of openTurns) closers.push(...this.toolClosers(turnId))
    for (const event of openSteps.values())
      closers.push({ type: 'step/end', turnId: event.turnId, step: event.step })
    for (const compactionId of openCompactions)
      closers.push({
        type: 'compaction/end',
        compactionId,
        error: 'Interrupted before compaction committed',
      })
    for (const turnId of openTurns)
      closers.push({ type: 'turn/end', turnId, reason: 'interrupted' })
    await this.commit(closers)
  }

  toolClosers(turnId: string): SessionEventInput[] {
    const results = new Set(
      this.log
        .filter((event) => event.type === 'message' && event.turnId === turnId && event.callKey)
        .map((event) => (event.type === 'message' ? event.callKey : undefined)),
    )
    const started = new Set(
      this.log
        .filter((event) => event.type === 'tool/start' && event.turnId === turnId)
        .map((event) => (event.type === 'tool/start' ? event.callKey : undefined)),
    )
    const events: SessionEventInput[] = []
    for (const event of this.log) {
      if (event.type !== 'message' || event.turnId !== turnId || event.message.role !== 'assistant')
        continue
      event.message.parts.forEach((part, index) => {
        const callKey = `${event.seq}:${index}`
        if (part.type !== 'tool-call' || results.has(callKey)) return
        const code = started.has(callKey) ? 'TOOL_OUTCOME_UNKNOWN' : 'TOOL_NOT_STARTED'
        events.push({
          type: 'message',
          turnId,
          callKey,
          message: {
            role: 'tool',
            toolCallId: part.id,
            name: part.name,
            isError: true,
            content: `${code}: interrupted; this operation was not automatically repeated.`,
          },
        })
      })
    }
    return events
  }
}

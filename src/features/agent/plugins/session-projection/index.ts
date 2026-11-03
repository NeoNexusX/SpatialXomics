/** ctx.sessionProjections 服务：其他插件注册只读模型，会话把提交的事件逐条折叠进去 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionEvent } from '../session'

/** One pure read model folded from the committed session log. */
export interface SessionProjectionDefinition<S = unknown, V = unknown> {
  key: string
  init(): S
  apply(state: S, event: SessionEvent): S
  view(state: S): V
}

interface ProjectionCell {
  state: unknown
  seq: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionProjections: SessionProjections
  }
}

export interface SessionProjectionSnapshot {
  /** Last committed event reflected by every value. */
  asOfSeq: number
  values: Record<string, unknown>
}

/**
 * Registry for plugin-owned session read models.
 *
 * Consumers register a projection once; the Session drives exactly the same
 * committed event into every registered unit. UI, compaction, and statistics
 * read the resulting snapshot instead of replaying the log independently.
 */
export class SessionProjections extends Service {
  private definitions = new Map<string, SessionProjectionDefinition<unknown, unknown>>()
  private cells = new WeakMap<object, Map<string, ProjectionCell>>()

  constructor(ctx: Context) {
    super(ctx, 'sessionProjections')
  }

  register<S, V>(definition: SessionProjectionDefinition<S, V>): () => void {
    if (this.definitions.has(definition.key)) {
      throw new Error(`Session projection "${definition.key}" is already registered`)
    }
    this.definitions.set(
      definition.key,
      definition as SessionProjectionDefinition<unknown, unknown>,
    )
    return () => {
      this.definitions.delete(definition.key)
    }
  }

  /** Rebuild every unit from a restored log. */
  reset(owner: object, events: readonly SessionEvent[]): void {
    const cells = new Map<string, ProjectionCell>()
    for (const [key, definition] of this.definitions) {
      let state = definition.init()
      for (const event of events) state = definition.apply(state, event)
      cells.set(key, {
        state,
        seq: events[events.length - 1]?.seq ?? -1,
      })
    }
    this.cells.set(owner, cells)
  }

  /** Fold one newly committed event into every unit. */
  push(owner: object, event: SessionEvent): void {
    let cells = this.cells.get(owner)
    if (!cells) {
      cells = new Map()
      this.cells.set(owner, cells)
    }
    for (const [key, definition] of this.definitions) {
      const cell = cells.get(key) ?? { state: definition.init(), seq: -1 }
      cells.set(key, {
        state: definition.apply(cell.state, event),
        seq: event.seq,
      })
    }
  }

  /** Consistent current view, detached from projection-owned state. */
  snapshot(owner: object): SessionProjectionSnapshot {
    const cells = this.cells.get(owner)
    const values: Record<string, unknown> = {}
    let asOfSeq = -1
    for (const [key, definition] of this.definitions) {
      const cell = cells?.get(key)
      if (!cell) continue
      values[key] = structuredClone(definition.view(cell.state))
      asOfSeq = Math.max(asOfSeq, cell.seq)
    }
    return { asOfSeq, values }
  }

  /** Current view for one key, or undefined when the plugin is not mounted. */
  viewOf<V>(owner: object, key: string): V | undefined {
    const cell = this.cells.get(owner)?.get(key)
    const definition = this.definitions.get(key)
    if (!cell || !definition) return undefined
    return structuredClone(definition.view(cell.state)) as V
  }
}

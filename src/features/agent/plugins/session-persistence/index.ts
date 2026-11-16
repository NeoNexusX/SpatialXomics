/**
 * 会话存储的接缝：存储接口、批次校验，以及 ctx.sessionPersistence 服务的抽象。
 * 具体后端（如 session-persistence-opfs）继承 SessionPersistence 并实现它的方法。
 */

import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionPersistence: SessionPersistence
  }
}

/** Browser-only, versioned session storage. Each line commits one complete batch. */
export interface StoredBatch {
  id: string
  from: number
  events: unknown[]
  checksum: string
}

export interface SessionStorage {
  readonly id: string
  readonly mode: 'persistent' | 'temporary' | 'read-only'
  read(): Promise<StoredBatch[]>
  append(batch: StoredBatch): Promise<void>
  putArtifact(value: Blob): Promise<string>
  getArtifact(id: string): Promise<Blob>
  deleteArtifact(id: string): Promise<void>
  listArtifacts(): Promise<string[]>
  close(): Promise<void>
}

/** 每个作用域（数据集）最多保留的对话数 */
export const MAX_SESSIONS = 3

/** 要打开哪段对话 */
export type SessionTarget =
  /** 上次打开的；不在了就取最近更新的；一段都没有就新建 */
  | 'last'
  /** 空白对话：有没人用的就复用，否则新建。到上限时抛 SessionLimitError */
  | 'new'
  /** 指定的对话。readOnly 不抢写入权，用于导出 */
  | { id: string; readOnly?: boolean }

/** 不打开日志正文就能知道的信息 */
export interface StoredSessionInfo {
  id: string
  /** 第一条提问。纯图片提问或读不出来时为 null */
  title: string | null
  /** 还没有提问过 */
  blank: boolean
  updatedAt: number
}

/** 导入时写进存储的内容。artifacts 的 id 写在消息正文里，不能改 */
export interface SessionArchive {
  /** 想沿用的对话 id，被占用或不合法时后端会换一个 */
  id: string
  batches: StoredBatch[]
  artifacts: Map<string, Blob>
}

export class SessionLimitError extends Error {
  constructor() {
    super(`A dataset can keep at most ${MAX_SESSIONS} conversations`)
    this.name = 'SessionLimitError'
  }
}

export class SessionBusyError extends Error {
  constructor() {
    super('This conversation is open in another tab')
    this.name = 'SessionBusyError'
  }
}

const encoder = new TextEncoder()

export function newId(): string {
  return crypto.randomUUID()
}

/** Integrity checksum for torn/corrupted records, not an authentication digest. */
export function checksum(value: string): string {
  let hash = 0x811c9dc5
  for (const byte of encoder.encode(value)) hash = Math.imul(hash ^ byte, 0x01000193)
  return (hash >>> 0).toString(16)
}

export function makeBatch(id: string, from: number, events: unknown[]): StoredBatch {
  return { id, from, events, checksum: checksum(JSON.stringify({ id, from, events })) }
}

export function validateBatch(value: unknown, from: number): StoredBatch {
  const batch = value as StoredBatch
  if (
    !batch ||
    typeof batch.id !== 'string' ||
    batch.from !== from ||
    !Array.isArray(batch.events) ||
    batch.events.length === 0 ||
    makeBatch(batch.id, batch.from, batch.events).checksum !== batch.checksum
  ) {
    throw new Error('Session log is corrupted')
  }
  return batch
}

/**
 * 写入前的检查：批次已经写过就返回 false（上次写入结果不确定时会重发同一批），
 * 同 id 内容不同或接不上已有事件时抛错。
 */
export function isNewBatch(stored: StoredBatch[], batch: StoredBatch): boolean {
  const existing = stored.find((entry) => entry.id === batch.id)
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(batch))
      throw new Error('Conflicting session batch')
    return false
  }
  validateBatch(
    batch,
    stored.reduce((count, entry) => count + entry.events.length, 0),
  )
  return true
}

/** 附件 id 会用作文件名，也可能来自导入的文件 */
export function assertArtifactId(id: string): string {
  if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error('Invalid session attachment reference')
  return id
}

/** 批次里的第一条提问。它是对话的标题，也说明对话不是空白的 */
export function firstQuestion(batch: StoredBatch): string | undefined {
  for (const event of batch.events as { type?: string; user?: { content?: string } }[])
    if (event?.type === 'turn/start') return event.user?.content ?? ''
  return undefined
}

export function createMemoryStorage(): SessionStorage {
  const batches: StoredBatch[] = []
  const artifacts = new Map<string, Blob>()
  return {
    id: newId(),
    mode: 'temporary',
    async read() {
      return structuredClone(batches)
    },
    async append(batch) {
      if (isNewBatch(batches, batch)) batches.push(structuredClone(batch))
    },
    async putArtifact(blob) {
      const id = newId()
      artifacts.set(id, blob)
      return id
    },
    async getArtifact(id) {
      const value = artifacts.get(id)
      if (!value) throw new Error('Session attachment is missing')
      return value
    },
    async deleteArtifact(id) {
      artifacts.delete(id)
    },
    async listArtifacts() {
      return [...artifacts.keys()]
    },
    async close() {},
  }
}

/** 管理某个作用域（数据集）下的对话 */
export abstract class SessionPersistence extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sessionPersistence')
  }

  abstract open(scope: string, target?: SessionTarget): Promise<SessionStorage>
  /** 全部对话，最近更新的在前。临时存储返回空列表 */
  abstract list(scope: string): Promise<StoredSessionInfo[]>
  /** 对话在别的标签页里写入时抛 SessionBusyError。当前标签页要先关掉它 */
  abstract remove(scope: string, id: string): Promise<void>
  /** 写入导入的对话，返回它的 id。到上限时抛 SessionLimitError */
  abstract importSession(scope: string, archive: SessionArchive): Promise<string>
}

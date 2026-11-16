/** OPFS 上的会话存储：每个数据集一个目录，每段对话一个子目录，事件按分段文件追加，附件单独存放 */

import {
  assertArtifactId,
  createMemoryStorage,
  firstQuestion,
  isNewBatch,
  MAX_SESSIONS,
  newId,
  SessionBusyError,
  SessionLimitError,
  SessionPersistence,
  validateBatch,
  type SessionArchive,
  type SessionStorage,
  type SessionTarget,
  type StoredBatch,
  type StoredSessionInfo,
} from '../session-persistence'

const ROOT = 'sxo-sessions-v1'
const HEADER = 'header.json'
const POINTER = 'active.json'
const SEGMENT_BYTES = 1_048_576
const SEGMENT = /^events-(\d+)\.jsonl$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TITLE_CHARS = 120
const encoder = new TextEncoder()

type Release = () => Promise<void>

interface Scope {
  datasetId: string
  dir: FileSystemDirectoryHandle
  lock: string
}

function missing(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'NotFoundError'
  )
}

function unsupported(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    ['SecurityError', 'NotSupportedError', 'NotAllowedError'].includes(String(error.name))
  )
}

async function optionalText(dir: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  try {
    return await (await (await dir.getFileHandle(name)).getFile()).text()
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
}

async function writeFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: string | Blob,
): Promise<void> {
  const file = await dir.getFileHandle(name, { create: true })
  if (typeof file.createWritable !== 'function')
    throw new DOMException('Writable OPFS is unavailable', 'NotSupportedError')
  const writer = await file.createWritable()
  try {
    await writer.write(data)
    await writer.close()
  } catch (error) {
    await writer.abort().catch(() => {})
    throw error
  }
}

async function entriesOf(dir: FileSystemDirectoryHandle): Promise<[string, FileSystemHandle][]> {
  const directory = dir as FileSystemDirectoryHandle & {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>
  }
  const entries: [string, FileSystemHandle][] = []
  for await (const entry of directory.entries()) entries.push(entry)
  return entries
}

async function lease(key: string): Promise<Release | null> {
  let announce!: (release: Release | null) => void
  const acquired = new Promise<Release | null>((resolve) => {
    announce = resolve
  })
  const request = navigator.locks
    .request(key, { ifAvailable: true }, async (lock) => {
      if (!lock) {
        announce(null)
        return
      }
      await new Promise<void>((resolve) =>
        announce(async () => {
          resolve()
          await request
        }),
      )
    })
    .catch(() => announce(null))
  return acquired
}

/** 浏览器没有 OPFS 时返回 null */
async function openScope(datasetId: string): Promise<Scope | null> {
  if (!navigator.storage?.getDirectory || !navigator.locks?.request) return null
  try {
    const root = await navigator.storage.getDirectory()
    const base = await root.getDirectoryHandle(ROOT, { create: true })
    // Encode the full identity, avoiding collisions between unrelated datasets.
    const name = Array.from(encoder.encode(JSON.stringify(datasetId)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')
    const dir = await base.getDirectoryHandle(name, { create: true })
    return { datasetId, dir, lock: `${ROOT}:${name}` }
  } catch (error) {
    if (unsupported(error)) return null
    throw error
  }
}

/**
 * 打开、新建、删除、导入都先拿目录锁，多个标签页才不会一起越过上限。
 * 只在操作期间持有；对话的写入权是另一把锁，持有多久都不影响这里。
 */
function withCatalog<T>(scope: Scope, task: () => Promise<T>): Promise<T> {
  // request 会展开回调返回的 Promise，类型声明没有体现这一点
  return navigator.locks.request(`${scope.lock}:catalog`, task) as unknown as Promise<T>
}

function leaseSession(scope: Scope, id: string): Promise<Release | null> {
  return lease(`${scope.lock}:${id}`)
}

/**
 * header.json 最后写、最先删，所以没有它的目录是没写完的导入或没删完的对话，不算存在。
 * 写了一半只会留下 0 字节文件，一样按没有算。其余读不懂的（比如更新版本写的）不能当垃圾清掉。
 */
async function headerState(
  scope: Scope,
  id: string,
  dir: FileSystemDirectoryHandle,
): Promise<'valid' | 'missing' | 'unsupported'> {
  const raw = await optionalText(dir, HEADER)
  if (!raw) return 'missing'
  try {
    const header = JSON.parse(raw)
    return header?.version === 1 && header.id === id && header.datasetId === scope.datasetId
      ? 'valid'
      : 'unsupported'
  } catch {
    return 'unsupported'
  }
}

/** 第一条提问几乎总在首段的开头。读不出来的对话算非空白，界面上才能看到它、删除它 */
async function describeLog(
  dir: FileSystemDirectoryHandle,
): Promise<Pick<StoredSessionInfo, 'title' | 'blank'>> {
  const raw = (await optionalText(dir, 'events-0.jsonl')) ?? ''
  try {
    // 最后一行可能没写完
    for (const line of raw.slice(0, raw.lastIndexOf('\n') + 1).split('\n')) {
      if (!line) continue
      const question = firstQuestion(JSON.parse(line))
      if (question === undefined) continue
      return { title: question.trim().slice(0, TITLE_CHARS) || null, blank: false }
    }
    return { title: null, blank: true }
  } catch {
    return { title: null, blank: false }
  }
}

async function readInfo(
  scope: Scope,
  id: string,
  dir: FileSystemDirectoryHandle,
): Promise<StoredSessionInfo | null> {
  const state = await headerState(scope, id, dir)
  if (state === 'missing') return null
  let updatedAt = 0
  for (const [name, handle] of await entriesOf(dir)) {
    if (name !== HEADER && !SEGMENT.test(name)) continue
    const file = await (handle as FileSystemFileHandle).getFile()
    updatedAt = Math.max(updatedAt, file.lastModified)
  }
  const log = state === 'valid' ? await describeLog(dir) : { title: null, blank: false }
  return { id, ...log, updatedAt }
}

/** 目录里的全部对话，最近更新的在前。sweep 只能在目录锁内用，顺手清掉没写完的目录 */
async function collect(scope: Scope, sweep = false): Promise<StoredSessionInfo[]> {
  const sessions: StoredSessionInfo[] = []
  for (const [id, handle] of await entriesOf(scope.dir)) {
    if (handle.kind !== 'directory') continue
    try {
      const info = await readInfo(scope, id, handle as FileSystemDirectoryHandle)
      if (info) sessions.push(info)
      else if (sweep) await scope.dir.removeEntry(id, { recursive: true })
    } catch (error) {
      // 别的标签页刚好删掉了它
      if (!missing(error)) throw error
    }
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
}

async function createSession(scope: Scope): Promise<string> {
  const id = newId()
  const dir = await scope.dir.getDirectoryHandle(id, { create: true })
  await writeFile(dir, HEADER, JSON.stringify({ version: 1, id, datasetId: scope.datasetId }))
  return id
}

/** active.json 只是指针，它指向的对话可能已经被别的标签页删掉 */
async function readPointer(scope: Scope): Promise<string | null> {
  const raw = await optionalText(scope.dir, POINTER)
  let id: string
  try {
    id = assertArtifactId(String(JSON.parse(raw ?? '').id))
  } catch {
    return null
  }
  try {
    const dir = await scope.dir.getDirectoryHandle(id)
    return (await headerState(scope, id, dir)) === 'missing' ? null : id
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
}

/** 决定打开哪段对话并尽量拿到它的写入权。拿不到说明别的标签页在写，只能读 */
async function claim(
  scope: Scope,
  target: SessionTarget,
): Promise<{ id: string; release: Release | null }> {
  const claimed = async (id: string) => ({ id, release: await leaseSession(scope, id) })
  if (typeof target === 'object') return claimed(assertArtifactId(target.id))
  if (target === 'last') {
    const pointer = await readPointer(scope)
    if (pointer) return claimed(pointer)
  }
  const sessions = await collect(scope, true)
  if (target === 'last' && sessions.length > 0)
    return claimed((sessions.find((session) => !session.blank) ?? sessions[0]!).id)
  if (target === 'new') {
    for (const session of sessions) {
      if (!session.blank) continue
      const release = await leaseSession(scope, session.id)
      if (release) return { id: session.id, release }
    }
    if (sessions.length >= MAX_SESSIONS) throw new SessionLimitError()
  }
  return claimed(await createSession(scope))
}

async function storageOf(scope: Scope, id: string, release: Release | null): Promise<OpfsStorage> {
  const dir = await scope.dir.getDirectoryHandle(id)
  if ((await headerState(scope, id, dir)) !== 'valid') throw new Error('Unsupported session format')
  if (release) {
    const probe = `probe-${newId()}`
    await writeFile(dir, probe, '')
    await dir.removeEntry(probe)
  }
  return new OpfsStorage(id, dir, release)
}

export async function openSessionStorage(
  datasetId: string,
  target: SessionTarget = 'last',
): Promise<SessionStorage> {
  const scope = await openScope(datasetId)
  if (!scope) return createMemoryStorage()
  try {
    if (typeof target === 'object' && target.readOnly)
      return await storageOf(scope, assertArtifactId(target.id), null)
    return await withCatalog(scope, async () => {
      const { id, release } = await claim(scope, target)
      try {
        const storage = await storageOf(scope, id, release)
        if (release) await writeFile(scope.dir, POINTER, JSON.stringify({ id }))
        return storage
      } catch (error) {
        await release?.()
        throw error
      }
    })
  } catch (error) {
    if (unsupported(error)) return createMemoryStorage()
    throw error
  }
}

export async function listSessions(datasetId: string): Promise<StoredSessionInfo[]> {
  const scope = await openScope(datasetId)
  return scope ? collect(scope) : []
}

async function removeDirectory(scope: Scope, id: string): Promise<void> {
  try {
    const dir = await scope.dir.getDirectoryHandle(id)
    await dir.removeEntry(HEADER).catch((error) => {
      if (!missing(error)) throw error
    })
    await scope.dir.removeEntry(id, { recursive: true })
  } catch (error) {
    if (!missing(error)) throw error
  }
}

export async function removeSession(datasetId: string, id: string): Promise<void> {
  const scope = await openScope(datasetId)
  if (!scope) return
  assertArtifactId(id)
  await withCatalog(scope, async () => {
    const release = await leaseSession(scope, id)
    if (!release) throw new SessionBusyError()
    try {
      await removeDirectory(scope, id)
    } finally {
      await release()
    }
  })
}

async function writeSegments(dir: FileSystemDirectoryHandle, batches: StoredBatch[]) {
  let segment = 0
  let lines: string[] = []
  let size = 0
  for (const batch of batches) {
    const line = JSON.stringify(batch) + '\n'
    const bytes = encoder.encode(line).byteLength
    if (size > 0 && size + bytes > SEGMENT_BYTES) {
      await writeFile(dir, `events-${segment++}.jsonl`, lines.join(''))
      lines = []
      size = 0
    }
    lines.push(line)
    size += bytes
  }
  if (lines.length > 0) await writeFile(dir, `events-${segment}.jsonl`, lines.join(''))
}

export async function importSession(datasetId: string, archive: SessionArchive): Promise<string> {
  const scope = await openScope(datasetId)
  if (!scope) throw new Error('Browser storage is unavailable')
  return withCatalog(scope, async () => {
    const kept: StoredSessionInfo[] = []
    for (const session of await collect(scope, true)) {
      // 没人用的空白对话给导入的对话让位
      const release = session.blank ? await leaseSession(scope, session.id) : null
      if (!release) {
        kept.push(session)
        continue
      }
      try {
        await removeDirectory(scope, session.id)
      } finally {
        await release()
      }
    }
    if (kept.length >= MAX_SESSIONS) throw new SessionLimitError()
    const taken = kept.some((session) => session.id === archive.id)
    const id = UUID.test(archive.id) && !taken ? archive.id : newId()
    const dir = await scope.dir.getDirectoryHandle(id, { create: true })
    try {
      if (archive.artifacts.size > 0) {
        const artifacts = await dir.getDirectoryHandle('artifacts', { create: true })
        for (const [name, blob] of archive.artifacts)
          await writeFile(artifacts, assertArtifactId(name), blob)
      }
      await writeSegments(dir, archive.batches)
      await writeFile(dir, HEADER, JSON.stringify({ version: 1, id, datasetId }))
      return id
    } catch (error) {
      await scope.dir.removeEntry(id, { recursive: true }).catch(() => {})
      throw error
    }
  })
}

class OpfsStorage implements SessionStorage {
  readonly mode: 'persistent' | 'read-only'
  private batches: StoredBatch[] = []
  private segment = 0
  private segmentSize = 0
  private loaded = false
  private closed = false

  constructor(
    readonly id: string,
    private dir: FileSystemDirectoryHandle,
    private release: Release | null,
  ) {
    this.mode = release ? 'persistent' : 'read-only'
  }

  private assertWritable(): void {
    if (this.closed || this.mode === 'read-only') throw new Error('Session is read-only')
  }

  async read(): Promise<StoredBatch[]> {
    const batches: StoredBatch[] = []
    const segments: number[] = []
    for (const [name] of await entriesOf(this.dir)) {
      const match = SEGMENT.exec(name)
      if (match) segments.push(Number(match[1]))
    }
    segments.sort((a, b) => a - b)
    if (segments.some((segment, index) => segment !== index))
      throw new Error('Missing session segment')
    let next = 0
    let segment = 0
    for (; ; segment++) {
      const name = `events-${segment}.jsonl`
      const raw = await optionalText(this.dir, name)
      if (raw === null) break
      const end = raw.lastIndexOf('\n') + 1
      const complete = raw.slice(0, end)
      for (const line of complete.split('\n').filter(Boolean)) {
        const batch = validateBatch(JSON.parse(line), next)
        if (batches.some((entry) => entry.id === batch.id))
          throw new Error('Duplicate session batch')
        batches.push(batch)
        next += batch.events.length
      }
      if (end !== raw.length) {
        if ((await optionalText(this.dir, `events-${segment + 1}.jsonl`)) !== null)
          throw new Error('Corrupt session segment')
        if (this.mode === 'persistent') await writeFile(this.dir, name, complete)
      }
      this.segment = segment
      this.segmentSize = encoder.encode(complete).byteLength
    }
    this.batches = batches
    this.loaded = true
    return structuredClone(batches)
  }

  async append(batch: StoredBatch): Promise<void> {
    this.assertWritable()
    // Re-read on every failed/uncertain write before retrying the exact batch.
    if (!this.loaded) await this.read()
    if (!isNewBatch(this.batches, batch)) return
    const text = JSON.stringify(batch) + '\n'
    const bytes = encoder.encode(text).byteLength
    if (this.segmentSize > 0 && this.segmentSize + bytes > SEGMENT_BYTES) {
      this.segment++
      this.segmentSize = 0
    }
    const file = await this.dir.getFileHandle(`events-${this.segment}.jsonl`, { create: true })
    try {
      const writer = await file.createWritable({ keepExistingData: true })
      try {
        await writer.write({ type: 'write', position: this.segmentSize, data: text })
        await writer.close()
      } catch (error) {
        await writer.abort().catch(() => {})
        throw error
      }
      this.segmentSize += bytes
      this.batches.push(structuredClone(batch))
    } catch (error) {
      this.loaded = false
      throw error
    }
  }

  async putArtifact(value: Blob): Promise<string> {
    this.assertWritable()
    const id = newId()
    const dir = await this.dir.getDirectoryHandle('artifacts', { create: true })
    await writeFile(dir, id, value)
    return id
  }

  async getArtifact(id: string): Promise<Blob> {
    const dir = await this.dir.getDirectoryHandle('artifacts')
    return (await dir.getFileHandle(assertArtifactId(id))).getFile()
  }

  async deleteArtifact(id: string): Promise<void> {
    this.assertWritable()
    const dir = await this.dir.getDirectoryHandle('artifacts')
    await dir.removeEntry(assertArtifactId(id))
  }

  async listArtifacts(): Promise<string[]> {
    try {
      const dir = await this.dir.getDirectoryHandle('artifacts')
      return (await entriesOf(dir)).map(([name]) => name)
    } catch (error) {
      if (missing(error)) return []
      throw error
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.release?.()
  }
}

export class OpfsSessionPersistence extends SessionPersistence {
  open(scope: string, target?: SessionTarget): Promise<SessionStorage> {
    return openSessionStorage(scope, target)
  }

  list(scope: string): Promise<StoredSessionInfo[]> {
    return listSessions(scope)
  }

  remove(scope: string, id: string): Promise<void> {
    return removeSession(scope, id)
  }

  importSession(scope: string, archive: SessionArchive): Promise<string> {
    return importSession(scope, archive)
  }
}

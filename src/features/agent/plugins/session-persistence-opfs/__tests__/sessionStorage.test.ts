import { Blob as NodeBlob } from 'node:buffer'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import {
  makeBatch,
  MAX_SESSIONS,
  SessionBusyError,
  SessionLimitError,
  type SessionStorage,
} from '../../session-persistence'
import { importSession, listSessions, openSessionStorage, removeSession } from '../index'

let clock = 0

class Dir {
  readonly kind = 'directory'
  files = new Map<string, Uint8Array>()
  dirs = new Map<string, Dir>()
  modified = new Map<string, number>()
  failAfterClose = false
  failWrites = false
  private notFound(): never {
    throw new DOMException('Missing', 'NotFoundError')
  }
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<Dir> {
    if (!this.dirs.has(name)) {
      if (!options?.create) return this.notFound()
      this.dirs.set(name, new Dir())
    }
    return this.dirs.get(name)!
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!options?.create) return this.notFound()
      this.files.set(name, new Uint8Array())
    }
    return {
      kind: 'file',
      getFile: async () =>
        Object.assign(new NodeBlob([this.files.get(name)!]), {
          lastModified: this.modified.get(name) ?? 0,
        }),
      createWritable: async (opts?: { keepExistingData?: boolean }) => {
        if (this.failWrites) throw new DOMException('Quota', 'QuotaExceededError')
        let data = opts?.keepExistingData ? this.files.get(name)! : new Uint8Array()
        return {
          write: async (value: string | Blob | { position: number; data: string }) => {
            const at = typeof value === 'object' && 'position' in value ? value.position : 0
            const content = typeof value === 'object' && 'data' in value ? value.data : value
            const bytes =
              typeof content === 'string'
                ? new TextEncoder().encode(content)
                : new Uint8Array(await (content as Blob).arrayBuffer())
            const next = new Uint8Array(Math.max(data.length, at + bytes.length))
            next.set(data)
            next.set(bytes, at)
            data = next
          },
          close: async () => {
            this.files.set(name, data)
            this.modified.set(name, ++clock)
            if (this.failAfterClose) {
              this.failAfterClose = false
              throw new Error('uncertain close')
            }
          },
          abort: async () => {},
        }
      },
    }
  }
  async *entries() {
    for (const name of this.files.keys()) yield [name, await this.getFileHandle(name)] as const
    for (const [name, dir] of this.dirs) yield [name, dir] as const
  }
  async removeEntry(name: string) {
    if (!this.files.has(name) && !this.dirs.has(name)) this.notFound()
    this.files.delete(name)
    this.dirs.delete(name)
  }
}

type LockCallback = (lock: object | null) => Promise<unknown>

let root: Dir
beforeEach(() => {
  root = new Dir()
  const held = new Set<string>()
  vi.stubGlobal('navigator', {
    storage: { getDirectory: async () => root },
    locks: {
      request: async (
        key: string,
        second: { ifAvailable?: boolean } | LockCallback,
        third?: LockCallback,
      ) => {
        const callback = third ?? (second as LockCallback)
        if (third && (second as { ifAvailable?: boolean }).ifAvailable && held.has(key))
          return callback(null)
        while (held.has(key)) await new Promise((resolve) => setTimeout(resolve, 0))
        held.add(key)
        try {
          return await callback({})
        } finally {
          held.delete(key)
        }
      },
    },
  })
})
afterEach(() => vi.unstubAllGlobals())

function scopeDir(): Dir {
  return [...root.dirs.get('sxo-sessions-v1')!.dirs.values()][0]!
}

function sessionDir(): Dir {
  return [...scopeDir().dirs.values()][0]!
}

/** 让对话不再是空白的 */
async function ask(storage: SessionStorage, content: string): Promise<SessionStorage> {
  const from = (await storage.read()).flatMap((batch) => batch.events).length
  await storage.append(makeBatch(`b${from}`, from, [{ type: 'turn/start', user: { content } }]))
  return storage
}

const UUID_A = '11111111-1111-4111-8111-111111111111'
const archive = (id = UUID_A, content = 'imported') => ({
  id,
  batches: [makeBatch('one', 0, [{ type: 'turn/start', user: { content } }])],
  artifacts: new Map([['art-1', new NodeBlob(['evidence']) as unknown as Blob]]),
})

describe('versioned browser session storage', () => {
  it('appends UTF-8 batches and restores the current session without localStorage', async () => {
    const first = await openSessionStorage('样本')
    await first.read()
    const batch = makeBatch('one', 0, [{ text: '中文🧪' }])
    await first.append(batch)
    await first.append(makeBatch('two', 1, [{ text: 'next' }]))
    await first.close()
    const next = await openSessionStorage('样本')
    expect(next.id).toBe(first.id)
    expect(await next.read()).toEqual([batch, makeBatch('two', 1, [{ text: 'next' }])])
    await next.close()
  })

  it('deduplicates an uncertain close and rejects conflicting batch ids', async () => {
    const store = await openSessionStorage('a')
    await store.read()
    const batch = makeBatch('one', 0, [{ text: 'one' }])
    sessionDir().failAfterClose = true
    await expect(store.append(batch)).rejects.toThrow('uncertain')
    await store.append(batch)
    expect(await store.read()).toEqual([batch])
    await expect(store.append(makeBatch('one', 0, [{ text: 'changed' }]))).rejects.toThrow(
      'Conflicting',
    )
    await store.close()
  })

  it('holds an exclusive writer lease and opens the second tab read-only', async () => {
    const writer = await openSessionStorage('a')
    const reader = await openSessionStorage('a')
    expect(reader.mode).toBe('read-only')
    await expect(reader.append(makeBatch('x', 0, [1]))).rejects.toThrow('read-only')
    await reader.close()
    await writer.close()
  })

  it('repairs only an incomplete physical tail', async () => {
    const store = await openSessionStorage('a')
    await store.read()
    await store.append(makeBatch('one', 0, [1]))
    const dir = sessionDir()
    const bytes = dir.files.get('events-0.jsonl')!
    const broken = new TextEncoder().encode('{"incomplete')
    const combined = new Uint8Array(bytes.length + broken.length)
    combined.set(bytes)
    combined.set(broken, bytes.length)
    dir.files.set('events-0.jsonl', combined)
    expect(await store.read()).toHaveLength(1)
    expect(new TextDecoder().decode(dir.files.get('events-0.jsonl'))).toBe(
      new TextDecoder().decode(bytes),
    )
    dir.files.set('events-0.jsonl', new TextEncoder().encode('{broken}\n'))
    await expect(store.read()).rejects.toThrow()
    await store.close()
  })

  it('scopes artifacts and deletion to the current session', async () => {
    const a = await openSessionStorage('a')
    const id = await a.putArtifact(new NodeBlob(['evidence']) as unknown as Blob)
    expect(await a.listArtifacts()).toEqual([id])
    const b = await openSessionStorage('b')
    expect(await b.listArtifacts()).toEqual([])
    await expect(b.getArtifact(id)).rejects.toThrow()
    expect(await (await a.getArtifact(id)).text()).toBe('evidence')
    await a.close()
    await removeSession('a', a.id)
    expect(await listSessions('a')).toEqual([])
    await b.append(makeBatch('one', 0, [1]))
    expect(await b.read()).toHaveLength(1)
    await b.close()
  })

  it('uses a visible temporary backend when browser persistence is unavailable', async () => {
    vi.stubGlobal('navigator', {})
    const store = await openSessionStorage('a')
    expect(store.mode).toBe('temporary')
    await store.append(makeBatch('one', 0, [1]))
    expect(await store.read()).toHaveLength(1)
    expect(await listSessions('a')).toEqual([])
    await expect(importSession('a', archive())).rejects.toThrow('unavailable')
    await removeSession('a', store.id)
  })
})

describe('conversations of one dataset', () => {
  it('lists them newest first, titled by the first question', async () => {
    const first = await ask(await openSessionStorage('a'), '  第一个问题\n第二行 ')
    await ask(first, 'not the title')
    await first.close()
    const second = await ask(await openSessionStorage('a', 'new'), 'second')
    await second.close()
    const list = await listSessions('a')
    expect(list.map((item) => item.id)).toEqual([second.id, first.id])
    expect(list[1]).toMatchObject({ title: '第一个问题\n第二行', blank: false })
    expect(list[1]!.updatedAt).toBeGreaterThan(0)
    expect(await listSessions('other')).toEqual([])
  })

  it('reports a blank conversation and an image-only question', async () => {
    const blank = await openSessionStorage('a')
    expect((await listSessions('a'))[0]).toMatchObject({ title: null, blank: true })
    await ask(blank, '')
    expect((await listSessions('a'))[0]).toMatchObject({ title: null, blank: false })
    await blank.close()
  })

  it('counts instructions-only logs as blank and ignores an incomplete last line', async () => {
    const store = await openSessionStorage('a')
    await store.read()
    await store.append(makeBatch('one', 0, [{ type: 'instructions/set', name: 'x', text: 'y' }]))
    const file = sessionDir().files
    const bytes = new TextDecoder().decode(file.get('events-0.jsonl'))
    file.set('events-0.jsonl', new TextEncoder().encode(`${bytes}{"incomplete`))
    expect((await listSessions('a'))[0]).toMatchObject({ blank: true })
    await store.close()
  })

  it('stays listed when its log cannot be read, so it can be deleted', async () => {
    const store = await ask(await openSessionStorage('a'), 'q')
    await store.close()
    sessionDir().files.set('events-0.jsonl', new TextEncoder().encode('{broken}\n'))
    expect(await listSessions('a')).toMatchObject([{ id: store.id, title: null, blank: false }])
    await removeSession('a', store.id)
    expect(await listSessions('a')).toEqual([])
  })

  it('reuses a free blank conversation instead of creating another', async () => {
    const first = await ask(await openSessionStorage('a'), 'q')
    await first.close()
    const blank = await openSessionStorage('a', 'new')
    expect(blank.id).not.toBe(first.id)
    await blank.close()
    const again = await openSessionStorage('a', 'new')
    expect(again.id).toBe(blank.id)
    await again.close()
    expect(await listSessions('a')).toHaveLength(2)
  })

  it(`refuses more than ${MAX_SESSIONS} and counts blank ones held by another tab`, async () => {
    const stores: SessionStorage[] = [await ask(await openSessionStorage('a'), 'q0')]
    for (let i = 1; i < MAX_SESSIONS - 1; i++)
      stores.push(await ask(await openSessionStorage('a', 'new'), `q${i}`))
    const heldBlank = await openSessionStorage('a', 'new')
    await expect(openSessionStorage('a', 'new')).rejects.toBeInstanceOf(SessionLimitError)
    await ask(heldBlank, 'filled')
    await expect(openSessionStorage('a', 'new')).rejects.toBeInstanceOf(SessionLimitError)
    expect(await listSessions('a')).toHaveLength(MAX_SESSIONS)
    expect((await openSessionStorage('b', 'new')).mode).toBe('persistent')

    await heldBlank.close()
    await removeSession('a', heldBlank.id)
    const next = await openSessionStorage('a', 'new')
    expect(next.mode).toBe('persistent')
    for (const store of [...stores, next]) await store.close()
  })

  it('never lets two tabs pass the limit together', async () => {
    const stores = await Promise.all(
      Array.from({ length: MAX_SESSIONS + 2 }, () =>
        openSessionStorage('a', 'new').then(
          (store) => ask(store, 'q'),
          (error: unknown) => error,
        ),
      ),
    )
    const opened = stores.filter((item): item is SessionStorage => 'mode' in (item as object))
    expect(opened).toHaveLength(MAX_SESSIONS)
    expect(stores.filter((item) => item instanceof SessionLimitError)).toHaveLength(2)
    for (const store of opened) await store.close()
  })

  it('locks each conversation separately', async () => {
    const first = await ask(await openSessionStorage('a'), 'q')
    const second = await openSessionStorage('a', 'new')
    expect([first.mode, second.mode]).toEqual(['persistent', 'persistent'])
    const sameAsFirst = await openSessionStorage('a', { id: first.id })
    expect(sameAsFirst.mode).toBe('read-only')
    await sameAsFirst.close()
    await first.close()
    await second.close()
  })

  it('reads without claiming the writer when asked to', async () => {
    const store = await ask(await openSessionStorage('a'), 'q')
    await store.close()
    const reader = await openSessionStorage('a', { id: store.id, readOnly: true })
    expect(reader.mode).toBe('read-only')
    expect(await reader.read()).toHaveLength(1)
    const writer = await openSessionStorage('a', { id: store.id })
    expect(writer.mode).toBe('persistent')
    await reader.close()
    await writer.close()
  })

  it('reopens the conversation opened last', async () => {
    const first = await ask(await openSessionStorage('a'), 'q')
    await first.close()
    const second = await ask(await openSessionStorage('a', 'new'), 'q')
    await second.close()
    const again = await openSessionStorage('a', { id: first.id })
    await again.close()
    const last = await openSessionStorage('a')
    expect(last.id).toBe(first.id)
    await last.close()
  })

  it('falls back to the newest conversation when the pointer is stale or broken', async () => {
    const older = await ask(await openSessionStorage('a'), 'q')
    await older.close()
    const newer = await ask(await openSessionStorage('a', 'new'), 'q')
    await newer.close()
    const blank = await openSessionStorage('a', 'new')
    await blank.close()
    await removeSession('a', blank.id)
    const afterRemoval = await openSessionStorage('a')
    expect(afterRemoval.id).toBe(newer.id)
    await afterRemoval.close()

    scopeDir().files.set('active.json', new TextEncoder().encode('not json'))
    const afterDamage = await openSessionStorage('a')
    expect(afterDamage.id).toBe(newer.id)
    await afterDamage.close()
  })

  it('prefers a real conversation over a newer blank one', async () => {
    const real = await ask(await openSessionStorage('a'), 'q')
    await real.close()
    const blank = await openSessionStorage('a', 'new')
    await blank.close()
    scopeDir().files.delete('active.json')
    const opened = await openSessionStorage('a')
    expect(opened.id).toBe(real.id)
    await opened.close()
  })

  it('opens the directory an older build left behind', async () => {
    const legacy = await ask(await openSessionStorage('a'), 'old question')
    await legacy.close()
    expect(new TextDecoder().decode(sessionDir().files.get('header.json'))).toBe(
      JSON.stringify({ version: 1, id: legacy.id, datasetId: 'a' }),
    )
    expect([...scopeDir().files.keys()]).toEqual(['active.json'])
    expect((await listSessions('a'))[0]).toMatchObject({ id: legacy.id, title: 'old question' })
    const reopened = await openSessionStorage('a')
    expect(reopened.id).toBe(legacy.id)
    expect(await reopened.read()).toHaveLength(1)
    await reopened.close()
  })

  it('refuses to delete a conversation another tab is writing', async () => {
    const store = await ask(await openSessionStorage('a'), 'q')
    await expect(removeSession('a', store.id)).rejects.toBeInstanceOf(SessionBusyError)
    expect(await listSessions('a')).toHaveLength(1)
    await store.close()
    await removeSession('a', store.id)
    await removeSession('a', store.id)
    expect(await listSessions('a')).toEqual([])
  })

  it('treats a directory without a header as not existing and sweeps it', async () => {
    const store = await ask(await openSessionStorage('a'), 'q')
    await store.close()
    const leftover = await scopeDir().getDirectoryHandle('half-written', { create: true })
    leftover.files.set('events-0.jsonl', new TextEncoder().encode('{}\n'))
    const empty = await scopeDir().getDirectoryHandle('empty-header', { create: true })
    empty.files.set('header.json', new Uint8Array())
    expect((await listSessions('a')).map((item) => item.id)).toEqual([store.id])
    expect(scopeDir().dirs.has('half-written')).toBe(true)

    const next = await openSessionStorage('a', 'new')
    expect(scopeDir().dirs.has('half-written')).toBe(false)
    expect(scopeDir().dirs.has('empty-header')).toBe(false)
    await next.close()
  })

  it('removes the header first, so an interrupted delete cannot resurrect a conversation', async () => {
    const store = await ask(await openSessionStorage('a'), 'q')
    await store.close()
    const dir = sessionDir()
    const remove = scopeDir().removeEntry.bind(scopeDir())
    scopeDir().removeEntry = async () => {
      throw new DOMException('Crash', 'AbortError')
    }
    await expect(removeSession('a', store.id)).rejects.toThrow('Crash')
    scopeDir().removeEntry = remove
    expect(dir.files.has('header.json')).toBe(false)
    expect(await listSessions('a')).toEqual([])
  })

  it('keeps a directory it cannot understand, and refuses to open it', async () => {
    const store = await ask(await openSessionStorage('a'), 'q')
    await store.close()
    const future = JSON.stringify({ version: 2, id: store.id, datasetId: 'a' })
    sessionDir().files.set('header.json', new TextEncoder().encode(future))
    const next = await openSessionStorage('a', 'new')
    await next.close()
    expect((await listSessions('a')).map((item) => item.id)).toContain(store.id)
    await expect(openSessionStorage('a', { id: store.id })).rejects.toThrow('Unsupported')
    const again = await openSessionStorage('a', { id: next.id })
    expect(again.mode).toBe('persistent')
    await again.close()
  })

  it('rejects ids that are not a safe directory name', async () => {
    await expect(openSessionStorage('a', { id: '../other' })).rejects.toThrow('Invalid')
    await expect(removeSession('a', '../other')).rejects.toThrow('Invalid')
  })
})

describe('importing a conversation', () => {
  it('writes the log and artifacts so the conversation opens and lists like any other', async () => {
    const id = await importSession('a', archive())
    expect(id).toBe(UUID_A)
    expect((await listSessions('a'))[0]).toMatchObject({ id, title: 'imported', blank: false })
    const store = await openSessionStorage('a', { id })
    expect(store.mode).toBe('persistent')
    expect(await store.read()).toEqual(archive().batches)
    expect(await store.listArtifacts()).toEqual(['art-1'])
    expect(await (await store.getArtifact('art-1')).text()).toBe('evidence')
    await store.append(makeBatch('two', 1, [{ type: 'x' }]))
    expect(await store.read()).toHaveLength(2)
    await store.close()
  })

  it('keeps the id when free and mints a new one when taken or unsafe', async () => {
    expect(await importSession('a', archive())).toBe(UUID_A)
    const second = await importSession('a', archive())
    expect(second).not.toBe(UUID_A)
    expect(await importSession('b', archive())).toBe(UUID_A)
    const unsafe = await importSession('c', archive('../../escape'))
    expect(unsafe).toMatch(/^[0-9a-f-]{36}$/)
    expect(root.dirs.get('sxo-sessions-v1')!.dirs.has('escape')).toBe(false)
  })

  it('takes the place of a free blank conversation but not of one in use', async () => {
    const filled = await ask(await openSessionStorage('a'), 'q')
    await filled.close()
    const second = await ask(await openSessionStorage('a', 'new'), 'q')
    await second.close()
    const freeBlank = await openSessionStorage('a', 'new')
    await freeBlank.close()
    const id = await importSession('a', archive())
    expect((await listSessions('a')).map((item) => item.id)).not.toContain(freeBlank.id)
    expect((await listSessions('a')).map((item) => item.id)).toContain(id)
    await removeSession('a', id)

    const heldBlank = await openSessionStorage('a', 'new')
    await expect(importSession('a', archive())).rejects.toBeInstanceOf(SessionLimitError)
    expect((await listSessions('a')).map((item) => item.id)).toContain(heldBlank.id)
    await heldBlank.close()
  })

  it(`refuses a conversation past ${MAX_SESSIONS}`, async () => {
    for (let i = 0; i < MAX_SESSIONS; i++) await importSession('a', archive(`id-${i}`))
    await expect(importSession('a', archive())).rejects.toBeInstanceOf(SessionLimitError)
    expect(await listSessions('a')).toHaveLength(MAX_SESSIONS)
  })

  it('splits a large log into the same segments the writer uses', async () => {
    const payload = 'x'.repeat(600_000)
    const batches = [0, 1, 2].map((from) => makeBatch(`b${from}`, from, [{ payload }]))
    const id = await importSession('a', { id: UUID_A, batches, artifacts: new Map() })
    const dir = scopeDir().dirs.get(id)!
    expect([...dir.files.keys()].filter((name) => name.startsWith('events-')).sort()).toEqual([
      'events-0.jsonl',
      'events-1.jsonl',
      'events-2.jsonl',
    ])
    const store = await openSessionStorage('a', { id })
    expect(await store.read()).toEqual(batches)
    await store.append(makeBatch('next', 3, [{ small: true }]))
    expect(await store.read()).toHaveLength(4)
    await store.close()
  })

  it('leaves nothing behind when writing fails', async () => {
    const write = Dir.prototype.getDirectoryHandle
    const spy = vi.spyOn(Dir.prototype, 'getDirectoryHandle')
    spy.mockImplementation(async function (this: Dir, name, options) {
      const dir = await write.call(this, name, options)
      if (name === UUID_A) dir.failWrites = true
      return dir
    })
    await expect(importSession('a', archive())).rejects.toThrow('Quota')
    spy.mockRestore()
    expect(scopeDir().dirs.has(UUID_A)).toBe(false)
    expect(await listSessions('a')).toEqual([])
  })

  it('never writes an artifact whose name could escape its directory', async () => {
    const unsafe = archive()
    unsafe.artifacts.set('../../header.json', new NodeBlob(['x']) as unknown as Blob)
    await expect(importSession('a', unsafe)).rejects.toThrow('Invalid')
    expect(scopeDir().dirs.has(UUID_A)).toBe(false)
  })
})

it('uses temporary storage when the browser exposes but denies OPFS', async () => {
  vi.stubGlobal('navigator', {
    storage: {
      getDirectory: async () => {
        throw new DOMException('Private mode', 'SecurityError')
      },
    },
    locks: { request: vi.fn() },
  })
  expect((await openSessionStorage('private')).mode).toBe('temporary')
})

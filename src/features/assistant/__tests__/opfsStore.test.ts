import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * OPFS mock：内存实现的 FileSystemDirectoryHandle/FileHandle 子集
 * （getDirectoryHandle / getFileHandle / createWritable / entries / removeEntry），
 * 覆盖 opfsStore 用到的全部 API 形态。createWritable 实现真实语义：
 * 默认截断、keepExistingData 保留旧内容、write({position}) 定位写不移动
 * 隐式偏移（pwrite），close 才落盘。
 */
class FakeFile {
  lastModified = Date.now()
  text = ''
}
class FakeFileHandle {
  constructor(public file: FakeFile) {}
  getFile() {
    const f = this.file
    return Promise.resolve({
      text: () => Promise.resolve(f.text),
      lastModified: f.lastModified,
      get size() {
        return f.text.length
      },
    } as File)
  }
  createWritable(opts?: { keepExistingData?: boolean }) {
    const file = this.file
    let buf = opts?.keepExistingData ? file.text : ''
    let offset = 0
    const writeAt = (pos: number, data: string): void => {
      buf = buf.slice(0, pos) + data + buf.slice(pos + data.length)
    }
    return Promise.resolve({
      write: (data: string | { type: 'write'; position?: number; data: string }) => {
        if (typeof data === 'string') {
          writeAt(offset, data)
          offset += data.length
        } else if (data.type === 'write') {
          const pos = data.position ?? offset
          writeAt(pos, data.data)
          if (data.position == null) offset = pos + data.data.length
        }
        return Promise.resolve()
      },
      close: () => {
        file.text = buf
        file.lastModified = Date.now()
        return Promise.resolve()
      },
    })
  }
}
class FakeDir {
  files = new Map<string, FakeFile>()
  dirs = new Map<string, FakeDir>()
  getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    let d = this.dirs.get(name)
    if (!d) {
      if (!opts?.create) return Promise.reject(new Error('NotFoundError'))
      d = new FakeDir()
      this.dirs.set(name, d)
    }
    return Promise.resolve(d)
  }
  getFileHandle(name: string, opts?: { create?: boolean }) {
    let f = this.files.get(name)
    if (!f) {
      if (!opts?.create) return Promise.reject(new Error('NotFoundError'))
      f = new FakeFile()
      this.files.set(name, f)
    }
    return Promise.resolve(new FakeFileHandle(f))
  }
  async *entries(): AsyncIterableIterator<[string, FakeFileHandle]> {
    for (const [name, f] of this.files) yield [name, new FakeFileHandle(f)]
  }
  removeEntry(name: string) {
    this.files.delete(name)
    this.dirs.delete(name)
    return Promise.resolve()
  }
}

let root: FakeDir

async function loadStore() {
  // 每个用例重置模块状态（availablePromise 缓存 + 会话 id）
  vi.resetModules()
  root = new FakeDir()
  vi.stubGlobal('navigator', {
    storage: { getDirectory: async () => root },
  })
  return await import('../utils/opfsStore')
}

beforeEach(() => {
  localStorage.clear()
})

describe('opfsStore', () => {
  it('appends and reads back history lines (jsonl, order preserved)', async () => {
    const store = await loadStore()
    await store.appendHistoryLines([{ id: 'a', role: 'user', content: 'hi' }])
    await store.appendHistoryLines([{ id: 'b', role: 'assistant', content: 'hello' }])
    const lines = (await store.readHistoryLines()) as { id: string }[]
    expect(lines.map((l) => l.id)).toEqual(['a', 'b'])
  })

  it('concurrent batch appends lose no lines (write queue serializes)', async () => {
    const store = await loadStore()
    // appendFile 是定位写：没有写队列时并发 createWritable 的提交顺序未定义，
    // 后提交者可能整段覆盖先提交者（每批 3 行只剩最后一批的 3 行）
    const batches = Array.from({ length: 5 }, (_, b) =>
      store.appendHistoryLines(
        Array.from({ length: 3 }, (_, i) => ({ id: `b${b}_m${i}`, role: 'user', content: 'x' })),
      ),
    )
    await Promise.all(batches)
    const lines = (await store.readHistoryLines()) as { id: string }[]
    expect(lines).toHaveLength(15)
    // 批内顺序保持
    for (let b = 0; b < 5; b++) {
      const ids = lines.filter((l) => l.id.startsWith(`b${b}_`)).map((l) => l.id)
      expect(ids).toEqual([`b${b}_m0`, `b${b}_m1`, `b${b}_m2`])
    }
  })

  it('writeArchive overwrites (idempotent), never concatenates', async () => {
    const store = await loadStore()
    await store.writeArchive('call_x', 'first version')
    await store.writeArchive('call_x', 'second version')
    expect(await store.readArchive('call_x')).toBe('second version')
    // 空 id 直接拒绝（防写入 ".txt"）
    expect(await store.writeArchive('', 'text')).toBeNull()
  })

  it('skips corrupted lines instead of failing the whole read', async () => {
    const store = await loadStore()
    await store.appendHistoryLines([{ id: 'ok', role: 'user', content: 'x' }])
    const dir = await root.getDirectoryHandle('assistant-history', { create: true })
    const handle = await dir.getFileHandle(`${store.getSessionId()}.jsonl`, { create: true })
    const w = await handle.createWritable()
    await w.write('{"id":"ok"}\nnot-json\n')
    await w.close()
    const lines = (await store.readHistoryLines()) as { id: string }[]
    expect(lines).toHaveLength(1)
    expect(lines[0]!.id).toBe('ok')
  })

  it('writes and reads archives; missing archive → null', async () => {
    const store = await loadStore()
    const id = await store.writeArchive('call_1', 'A'.repeat(3000))
    expect(id).toBe('call_1')
    expect((await store.readArchive('call_1'))!.length).toBe(3000)
    expect(await store.readArchive('nope')).toBeNull()
  })

  it('sessionId is stable within a session and clear() wipes all assistant data', async () => {
    const store = await loadStore()
    const id1 = store.getSessionId()
    expect(store.getSessionId()).toBe(id1)
    await store.appendHistoryLines([{ id: 'a', role: 'user', content: 'x' }])
    await store.writeArchive('c1', 'text')
    await store.clearAssistantOpfs()
    expect(await store.readHistoryLines()).toEqual([])
    expect(await store.readArchive('c1')).toBeNull()
  })

  it('rotateSessionId starts a fresh session file (old one left for trimming)', async () => {
    const store = await loadStore()
    const id1 = store.getSessionId()
    await store.appendHistoryLines([{ id: 'a', role: 'user', content: 'x' }])
    store.rotateSessionId()
    const id2 = store.getSessionId()
    expect(id2).not.toBe(id1)
    await store.appendHistoryLines([{ id: 'b', role: 'user', content: 'y' }])
    // 新会话文件只含新行；旧会话文件原样保留（loadEarlier 显式传 id 可读）
    expect(await store.readHistoryLines()).toEqual([{ id: 'b', role: 'user', content: 'y' }])
    expect(await store.readHistoryLines(id1)).toEqual([{ id: 'a', role: 'user', content: 'x' }])
  })

  it('degrades to empty/null when OPFS is unavailable', async () => {
    vi.resetModules()
    vi.stubGlobal('navigator', {})
    const store = await import('../utils/opfsStore')
    // 不抛，且返回 false 供调用方决定是否标记「已持久化」
    expect(await store.appendHistoryLines([{ id: 'a', role: 'user', content: 'x' }])).toBe(false)
    expect(await store.readHistoryLines()).toEqual([])
    expect(await store.writeArchive('c', 't')).toBeNull()
  })
})

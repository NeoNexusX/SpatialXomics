/**
 * assistant 的 OPFS（Origin Private File System）存储。
 *
 * 背景：会话历史（含完整工具结果/推理）与工具结果全文放进 localStorage
 * 会撞 ~5MB 配额，放内存则刷新即失且无上限——OPFS 是浏览器提供的同源
 * 私有文件系统（容量级 GB），适合存"大而不常读"的内容：
 *
 *   assistant-history/<sessionId>.jsonl   每 turn 追加一行（完整 UiChatItem）
 *   assistant-archive/<archiveId>.txt     被截断的工具结果全文（按 archiveId 取回）
 *
 * 全部 API 失败安全：OPFS 不可用（旧浏览器/隐私模式/配额）时降级为
 * no-op / null，调用方无需 try-catch（localStorage 精简历史兜底）。
 * 本模块历史上是应用中唯一在用的 OPFS 代码路径（上传管线曾用
 * pending_upload.zip，已废弃清理——见 uploadResume.deleteLegacyOpfsZip）。
 */

import { STORAGE_KEYS } from '@/shared/config/storageKeys'

const HISTORY_DIR = 'assistant-history'
const ARCHIVE_DIR = 'assistant-archive'
/** 保留的会话文件数上限（每个会话一个 jsonl；超出删最旧） */
const MAX_SESSION_FILES = 10

/** OPFS 是否可用（能力探测缓存，避免重复 await） */
async function rootDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const nav = navigator as Navigator & {
      storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> }
    }
    if (!nav.storage?.getDirectory) return null
    return await nav.storage.getDirectory()
  } catch {
    return null
  }
}

async function subdir(
  name: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  const root = await rootDir()
  if (!root) return null
  try {
    return await (root as FileSystemDirectoryHandle & {
      getDirectoryHandle: (n: string, o?: { create?: boolean }) => Promise<FileSystemDirectoryHandle>
    }).getDirectoryHandle(name, { create })
  } catch {
    return null
  }
}

type WritableLike = {
  write: (data: string | { type: 'write'; position: number; data: string }) => Promise<void>
  close: () => Promise<void>
}

/** 全局写队列：定位写虽不再「读旧覆盖」，但两个并发 createWritable 的
 *  提交顺序在部分实现里未定义。所有写操作串行排队；单项失败不断链。 */
let writeQueue: Promise<unknown> = Promise.resolve()

function enqueueWrite<T>(op: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(op, op)
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** 追加写：keepExistingData + 定位到文件尾写入——不读旧内容，每轮追加
 *  从 O(会话字节数)（读旧 + 整写回）降为 O(新增行)，长会话不再二次方放大。 */
async function appendFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  text: string,
): Promise<boolean> {
  return enqueueWrite(async () => {
    try {
      const dirAny = dir as FileSystemDirectoryHandle & {
        getFileHandle: (n: string, o?: { create?: boolean }) => Promise<FileSystemFileHandleLike>
      }
      const handle = await dirAny.getFileHandle(name, { create: true })
      const size = (await handle.getFile()).size
      const writable = await handle.createWritable({ keepExistingData: true })
      await writable.write({ type: 'write', position: size, data: text })
      await writable.close()
      return true
    } catch {
      return false
    }
  })
}

/** 整文件覆盖写（不读旧内容；createWritable 默认即截断）。存档按 id 寻址、
 *  内容不可变——同 id 重写覆盖，绝不叠加。 */
async function writeWholeFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  text: string,
): Promise<boolean> {
  return enqueueWrite(async () => {
    try {
      const dirAny = dir as FileSystemDirectoryHandle & {
        getFileHandle: (n: string, o?: { create?: boolean }) => Promise<FileSystemFileHandleLike>
      }
      const handle = await dirAny.getFileHandle(name, { create: true })
      const writable = (await handle.createWritable()) as WritableLike
      await writable.write(text)
      await writable.close()
      return true
    } catch {
      return false
    }
  })
}

interface FileSystemFileHandleLike {
  getFile: () => Promise<File>
  createWritable: (opts?: { keepExistingData?: boolean }) => Promise<WritableLike>
}

/** 读整个文本文件 */
async function readTextFile(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<string | null> {
  try {
    const handle = await (
      dir as FileSystemDirectoryHandle & {
        getFileHandle: (n: string) => Promise<FileSystemFileHandleLike>
      }
    ).getFileHandle(name)
    const file = await handle.getFile()
    return await file.text()
  } catch {
    return null
  }
}

// ---- 会话历史（JSONL） ----

/** 会话内单调递增序号（跨刷新从 localStorage 续接；键名收口在 STORAGE_KEYS） */

/** 会话 id 生成：时间戳 + 模块内序号（同毫秒轮换/创建也不会撞名） */
let sessionSeq = 0
function newSessionId(): string {
  return `s_${Date.now().toString(36)}_${++sessionSeq}`
}

export function getSessionId(): string {
  try {
    let id = localStorage.getItem(STORAGE_KEYS.assistantSessionId)
    if (!id) {
      id = newSessionId()
      localStorage.setItem(STORAGE_KEYS.assistantSessionId, id)
    }
    return id
  } catch {
    return newSessionId()
  }
}

/** 轮换会话 id：清空/切换对话后新开一个会话文件——否则所有历史永远写进
 *  同一个无限增长的 jsonl，trimOldSessions 的按量清理也永远没有第二个
 *  文件可删。旧文件留在原地由 trimOldSessions 按 MAX_SESSION_FILES 收。 */
export function rotateSessionId(): void {
  try {
    localStorage.setItem(STORAGE_KEYS.assistantSessionId, newSessionId())
  } catch {
    /* localStorage 不可用时 getSessionId 每次都退化为新时间戳 id，等效轮换 */
  }
}

/** 会话文件名（jsonl） */
function sessionFile(id: string): string {
  return `${id}.jsonl`
}

/** 批量追加多条消息（一次定位写，替代逐条并发写）。turn 结束时整批调用。
 *  @returns 是否写入成功——调用方据此决定是否标记「已持久化」（失败保持
 *  未标记，下一轮自然重试整批，而非静默丢失） */
export async function appendHistoryLines(items: unknown[]): Promise<boolean> {
  if (items.length === 0) return true
  const dir = await subdir(HISTORY_DIR, true)
  if (!dir) return false
  const text = items.map((i) => JSON.stringify(i)).join('\n') + '\n'
  const ok = await appendFile(dir, sessionFile(getSessionId()), text)
  if (ok) void trimOldSessions(dir)
  return ok
}

/** 读当前会话历史（全部行，解析失败行跳过） */
export async function readHistoryLines(sessionId = getSessionId()): Promise<unknown[]> {
  const dir = await subdir(HISTORY_DIR, false)
  if (!dir) return []
  const text = await readTextFile(dir, sessionFile(sessionId))
  if (!text) return []
  const out: unknown[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      /* 损坏行跳过 */
    }
  }
  return out
}

/** 只保留最近 MAX_SESSION_FILES 个会话文件（按修改时间） */
async function trimOldSessions(dir: FileSystemDirectoryHandle): Promise<void> {
  try {
    const dirAny = dir as unknown as {
      entries: () => AsyncIterableIterator<[string, unknown]>
      removeEntry: (n: string) => Promise<void>
    }
    const files: { name: string; lastModified: number }[] = []
    for await (const [name, handle] of dirAny.entries()) {
      const h = handle as FileSystemFileHandleLike
      if (typeof h?.getFile !== 'function') continue
      const file = await h.getFile()
      files.push({ name, lastModified: file.lastModified })
    }
    if (files.length <= MAX_SESSION_FILES) return
    files.sort((a, b) => a.lastModified - b.lastModified)
    for (const f of files.slice(0, files.length - MAX_SESSION_FILES)) {
      await dirAny.removeEntry(f.name).catch(() => {})
    }
  } catch {
    /* 清理失败无害 */
  }
}

/** 清空 assistant 的全部 OPFS 数据（清空历史按钮） */
export async function clearAssistantOpfs(): Promise<void> {
  const root = await rootDir()
  if (!root) return
  const rootAny = root as unknown as {
    removeEntry: (n: string, o?: { recursive?: boolean }) => Promise<void>
  }
  await Promise.all([
    rootAny.removeEntry(HISTORY_DIR, { recursive: true }).catch(() => {}),
    rootAny.removeEntry(ARCHIVE_DIR, { recursive: true }).catch(() => {}),
  ])
}

// ---- 工具结果存档 ----

/** 写入一份被截断的工具结果全文（同 id 整文件覆盖，幂等）；返回存档 id
 *  （失败返回 null=没存上，调用方据此决定是否在历史里保留全文） */
export async function writeArchive(id: string, text: string): Promise<string | null> {
  if (!id) return null
  const dir = await subdir(ARCHIVE_DIR, true)
  if (!dir) return null
  const ok = await writeWholeFile(dir, `${id}.txt`, text)
  return ok ? id : null
}

/** 按 id 取回存档全文（不存在/OPFS 不可用 → null） */
export async function readArchive(id: string): Promise<string | null> {
  const dir = await subdir(ARCHIVE_DIR, false)
  if (!dir) return null
  return readTextFile(dir, `${id}.txt`)
}

/**
 * 主线程这一侧的注释引擎客户端：库 CSV 的解析、匹配和打分都优先放在 worker 里。
 * worker 构造失败或崩溃后闩锁，之后（包括崩溃时正在进行的那次运行、还没解析完的库）
 * 都改在主线程同步跑。
 */

import type {
  AnnotationDb,
  AnnotationDbInfo,
  AnnotationResult,
  SpatialPatch,
} from '@/features/vizworkbench/types/annotation'
import type { AnnotationWorkerRequest, AnnotationWorkerResponse } from './annotation.worker'
import { AnnotationDbCsvError, dbInfoOf, parseUserDbCsv } from './annotationDb'
import { AnnotationSession, type SessionInput } from './pipeline'

/** 一次运行的输入：会话输入（库另行设置）+ 运行编号 */
export type RunRequest = Omit<SessionInput, 'db'> & { runKey: number }

export interface EngineHandlers {
  onResult: (runKey: number, result: AnnotationResult) => void
  onPatch: (runKey: number, patch: SpatialPatch) => void
  onError: (runKey: number, message: string) => void
}

export interface EngineClient {
  /**
   * 解析库 CSV 并设为当前库，返回库名与分子式数；多次调用按调用顺序生效。
   * 解析失败时 reject（格式问题为 AnnotationDbCsvError），当前库不变。
   */
  loadDb(fileName: string, text: string): Promise<AnnotationDbInfo>
  run(req: RunRequest): void
  /** images 的 buffer 会被转移，调用方传副本；null = 读取失败，undefined = 未传图（已缓存） */
  spatial(
    runKey: number,
    job: string,
    images: (Float32Array | null | undefined)[],
    width: number,
    height: number,
  ): void
  dispose(): void
}

interface DbCsv {
  fileName: string
  text: string
}

interface PendingDb {
  csv: DbCsv
  resolve: (info: AnnotationDbInfo) => void
  reject: (err: Error) => void
}

function spawnAnnotationWorker(): Worker {
  return new Worker(new URL('./annotation.worker.ts', import.meta.url), { type: 'module' })
}

/** spawnWorker 只在测试里替换 */
export function createEngineClient(
  handlers: EngineHandlers,
  spawnWorker: () => Worker = spawnAnnotationWorker,
): EngineClient {
  let worker: Worker | null = null
  let broken = false
  let disposed = false
  let lastRun: RunRequest | null = null
  /** 当前库的 CSV（与 worker 里的库一致）；改在主线程跑时据此解析 */
  let dbCsv: DbCsv | null = null
  /** 已发给 worker、还没回复的库解析 */
  const pendingDb = new Map<number, PendingDb>()
  let dbSeq = 0
  // 主线程兜底
  let mainDb: AnnotationDb | null = null
  let session: AnnotationSession | null = null
  let sessionKey = -1

  function setCurrentDb(csv: DbCsv, parsed: AnnotationDb | null): void {
    dbCsv = csv
    mainDb = parsed
    session = null
  }

  /** 在主线程解析并设为当前库；失败时抛错，当前库不变 */
  function loadDbOnMain(csv: DbCsv): AnnotationDbInfo {
    const parsed = parseUserDbCsv(csv.fileName, csv.text)
    setCurrentDb(csv, parsed)
    return dbInfoOf(parsed)
  }

  function runOnMain(req: RunRequest): void {
    try {
      if (!dbCsv) throw new Error('annotation database not set')
      // worker 解析的库主线程还没有，用到时再解析
      mainDb ??= parseUserDbCsv(dbCsv.fileName, dbCsv.text)
      session = new AnnotationSession({ db: mainDb, ...req })
      sessionKey = req.runKey
      handlers.onResult(req.runKey, session.run())
    } catch (e) {
      handlers.onError(req.runKey, e instanceof Error ? e.message : String(e))
    }
  }

  function onDbReply(msg: Extract<AnnotationWorkerResponse, { type: 'db' | 'dbError' }>): void {
    const p = pendingDb.get(msg.id)
    if (!p) return
    pendingDb.delete(msg.id)
    if (msg.type === 'db') {
      setCurrentDb(p.csv, null)
      p.resolve(msg.info)
    } else {
      p.reject(msg.code ? new AnnotationDbCsvError(msg.message, msg.code) : new Error(msg.message))
    }
  }

  function markBroken(): void {
    broken = true
    worker?.terminate()
    worker = null
    if (disposed) return
    // 崩溃时正在进行的运行改到主线程重跑，还没回复的库改在主线程解析
    if (lastRun) runOnMain(lastRun)
    const waiting = [...pendingDb.values()]
    pendingDb.clear()
    for (const p of waiting) {
      try {
        p.resolve(loadDbOnMain(p.csv))
      } catch (e) {
        p.reject(e instanceof Error ? e : new Error(String(e)))
      }
    }
  }

  function ensureWorker(): Worker | null {
    if (broken) return null
    if (worker) return worker
    try {
      worker = spawnWorker()
    } catch {
      broken = true
      return null
    }
    worker.onmessage = (e: MessageEvent<AnnotationWorkerResponse>) => {
      const msg = e.data
      if (msg.type === 'db' || msg.type === 'dbError') onDbReply(msg)
      else if (msg.type === 'result') handlers.onResult(msg.runKey, msg.result)
      else if (msg.type === 'patch') handlers.onPatch(msg.runKey, msg.patch)
      else handlers.onError(msg.runKey, msg.message)
    }
    worker.onerror = () => markBroken()
    return worker
  }

  return {
    async loadDb(fileName, text) {
      const csv = { fileName, text }
      const w = ensureWorker()
      if (!w) return loadDbOnMain(csv)
      const id = ++dbSeq
      return new Promise<AnnotationDbInfo>((resolve, reject) => {
        pendingDb.set(id, { csv, resolve, reject })
        w.postMessage({ type: 'db', id, ...csv } satisfies AnnotationWorkerRequest)
      })
    },
    run(req) {
      lastRun = req
      const w = ensureWorker()
      if (!w) {
        runOnMain(req)
        return
      }
      w.postMessage({ type: 'run', ...req } satisfies AnnotationWorkerRequest)
    },
    spatial(runKey, job, images, width, height) {
      const w = ensureWorker()
      if (!w) {
        if (!session || runKey !== sessionKey) return
        const patch = session.applySpatial(job, images, width, height)
        if (patch) handlers.onPatch(runKey, patch)
        return
      }
      const transfer = images
        .filter((img): img is Float32Array => img != null)
        .map((img) => img.buffer)
      w.postMessage(
        { type: 'spatial', runKey, job, images, width, height } satisfies AnnotationWorkerRequest,
        transfer,
      )
    },
    dispose() {
      disposed = true
      worker?.terminate()
      worker = null
      session = null
      // 页面已卸载：还没解析完的库不再回调
      pendingDb.clear()
    },
  }
}

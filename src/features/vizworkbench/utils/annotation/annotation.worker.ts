/**
 * 注释 worker：解析并持有注释库，持有当前一次运行的 AnnotationSession，计算全部在这里做。
 *
 * 协议：
 *   main → worker
 *     { type: 'db', id, fileName, text }                        解析库 CSV，成功则替换当前库
 *     { type: 'run', runKey, peaks, adducts, tolerance, config }
 *     { type: 'spatial', runKey, job, images, width, height }   一个空间任务的离子图
 *   worker → main
 *     { type: 'db', id, info } / { type: 'dbError', id, message, code }
 *     { type: 'result', runKey, result }
 *     { type: 'patch', runKey, patch }
 *     { type: 'error', runKey, message }
 *
 * 库解析失败时保留原来的库。runKey 不是当前运行的 spatial 消息直接丢弃（主线程已经开始了新的运行）。
 */

import type {
  AnnotationDb,
  AnnotationDbInfo,
  AnnotationResult,
  SpatialPatch,
} from '@/features/vizworkbench/types/annotation'
import {
  AnnotationDbCsvError,
  dbInfoOf,
  parseUserDbCsv,
  type AnnotationDbCsvErrorCode,
} from './annotationDb'
import type { RunRequest } from './engineClient'
import { AnnotationSession } from './pipeline'

export type AnnotationWorkerRequest =
  | { type: 'db'; id: number; fileName: string; text: string }
  | ({ type: 'run' } & RunRequest)
  | {
      type: 'spatial'
      runKey: number
      job: string
      images: (Float32Array | null | undefined)[]
      width: number
      height: number
    }

export type AnnotationWorkerResponse =
  | { type: 'db'; id: number; info: AnnotationDbInfo }
  | { type: 'dbError'; id: number; message: string; code: AnnotationDbCsvErrorCode | null }
  | { type: 'result'; runKey: number; result: AnnotationResult }
  | { type: 'patch'; runKey: number; patch: SpatialPatch }
  | { type: 'error'; runKey: number; message: string }

let db: AnnotationDb | null = null
let session: AnnotationSession | null = null
let sessionKey = -1

function post(msg: AnnotationWorkerResponse): void {
  self.postMessage(msg)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

self.onmessage = (e: MessageEvent<AnnotationWorkerRequest>) => {
  const req = e.data
  if (req.type === 'db') {
    try {
      db = parseUserDbCsv(req.fileName, req.text)
      session = null
      post({ type: 'db', id: req.id, info: dbInfoOf(db) })
    } catch (err) {
      const code = err instanceof AnnotationDbCsvError ? err.code : null
      post({ type: 'dbError', id: req.id, message: errorMessage(err), code })
    }
    return
  }
  const runKey = req.runKey
  try {
    if (req.type === 'run') {
      if (!db) throw new Error('annotation database not set')
      session = new AnnotationSession({ db, ...req })
      sessionKey = runKey
      post({ type: 'result', runKey, result: session.run() })
      return
    }
    if (req.type === 'spatial') {
      if (!session || runKey !== sessionKey) return
      const patch = session.applySpatial(req.job, req.images, req.width, req.height)
      if (patch) post({ type: 'patch', runKey, patch })
    }
  } catch (err) {
    post({ type: 'error', runKey, message: errorMessage(err) })
  }
}

import ZipCompressWorker from '@/workers/zip-compress.worker?worker'
import { ProgressTracker, type ImzmlFilePair } from './imzmlHelper'
import { reasonOf } from './uploadAbort'
import { OSS_UPLOAD } from '@/shared/config'

/** 哈希阶段的进度。上传阶段的进度另走 UnifiedUploadProgress */
interface CompressProgressEvent {
  percent: number
  speedStr?: string
  etaStr?: string
}

export interface CompressOptions {
  onProgress?: (e: CompressProgressEvent) => void
  signal?: AbortSignal
}

/** 压缩侧的实时统计，由 worker 定期上报 */
interface CompressStats {
  /** zip 产物总字节的最新估计。只用来给消息文案算「第几片 / 共几片」 */
  estZipBytes: number
  /** 已从源文件读出的字节数。压缩速度的分子 */
  srcDone: number
  /** 生产端因额度耗尽挂起的累计时长。压缩速度的分母要扣掉它 */
  stalledMs: number
}

interface StreamCompressOptions {
  entryNames: { imzmlName: string; ibdName: string }
  partSize: number
  /** 初始信用额度 = 主线程缓冲区容量（分片数） */
  initialCredits: number
  maxPartCount: number
  /** ibd 是否参与压缩。参与 zip 字节，续传必须沿用 */
  compressIbd: boolean
  /** 续传：这些分片号已在 OSS 上，重新生成但不再上传 */
  donePartNumbers?: number[]
  /** 续传：需要回传 MD5 做可复现性校验的分片号 */
  verifyPartNo?: number | null
  /**
   * 收到一个待上传分片。**同步入队即可返回**，不要在这里等上传完成 ——
   * 放行下一片靠的是额度，调用方**取走**分片时调 `addCredits()` 归还即可。
   * 等上传结果才放行的话，一次重试就会冻住整条压缩流水线。
   */
  onPart: (partNo: number, blob: Blob) => void
  /**
   * 切出一片时报告它消耗了多少**源文件**字节。进度条的数据源。
   *
   * 必定先于同一片的 `onPart` 触发（postMessage 保序）。
   * 续传时被跳过、不走 `onPart` 的分片同样会触发这个回调。
   */
  onCut?: (partNo: number, srcSpan: number) => void
  /** 压缩侧统计，每 500ms 一次（含停滞时的心跳） */
  onStats?: (stats: CompressStats) => void
  /** 续传校验回调：返回 false 表示 zip 字节与上次不一致，压缩会以错误中止 */
  onVerify?: (partNo: number, md5: string) => boolean
}

export interface UploadPreparation {
  fileHash: string
  /**
   * preflight 之后调用，开始压缩并逐片外发。秒传命中时不要调用，改调 `dispose()`。
   *
   * 它 resolve 表示「字节全部外发」，**不表示全部上传完成** —— 后者由调用方
   * 自己 await 消费者。
   */
  startCompress: (options: StreamCompressOptions) => Promise<void>
  /** 归还缓冲区空位，放行后续分片。消费端出队即调用，与上传成败无关 */
  addCredits: (count?: number) => void
  /** 让压缩流在下一个检查点抛出（消费端失败 / zip 字节不可复现）。幂等 */
  failCompress: (message: string) => void
  /**
   * 不压缩就终止已暂停的 worker（秒传命中，或压缩开始前就失败）。
   * 幂等；压缩已结束或已中止后是空操作。
   */
  dispose: () => void
}

/** zip 字节不可复现时抛出的哨兵，调用方据此放弃续传、重新开一轮完整上传 */
export const NON_DETERMINISTIC_ZIP = 'Archive bytes are not reproducible; cannot resume'

/** worker 自身崩溃（两个阶段共用） */
const WORKER_FAILED = 'Zip compression worker failed'

/**
 * 阶段一：起 worker 算源文件哈希，然后停在压缩之前。
 *
 * 立即把哈希交给调用方去做 preflight。要继续就调 `startCompress(...)`；
 * 不继续（例如秒传命中）必须调 `dispose()` —— 暂停中的专用 worker 不会被自动回收。
 *
 * 中止一律沿用 `signal.reason`（见 uploadAbort.ts）：新建一个 AbortError
 * 会丢掉「用户取消 / 组件卸载」的意图，上传 pipeline 的 catch 就分不了支。
 */
export function prepareUpload(
  pair: ImzmlFilePair,
  options?: CompressOptions,
): Promise<UploadPreparation> {
  if (options?.signal?.aborted) {
    throw reasonOf(options.signal)
  }

  const totalBytes = pair.ibd.size + pair.imzml.size
  const worker = new ZipCompressWorker()
  const tracker = new ProgressTracker()
  let lastReportTime = 0

  /** 哈希阶段的字节进度，节流到 100ms。压缩阶段的进度改由上传片数驱动 */
  const report = (msg: { loaded: number }, cb?: (e: CompressProgressEvent) => void) => {
    if (!cb) return
    const now = Date.now()
    if (now - lastReportTime <= 100) return
    lastReportTime = now
    const { speedStr, etaStr } = tracker.update(msg.loaded, totalBytes)
    cb({
      percent: Math.min(100, Math.round((msg.loaded / totalBytes) * 100)),
      speedStr,
      etaStr,
    })
  }

  return new Promise((resolve, reject) => {
    let settled = false
    // 压缩已启动时由它接管中止；为 null 表示还停在哈希阶段
    let rejectCompress: ((reason: unknown) => void) | null = null

    const cleanup = () => {
      if (settled) return
      settled = true
      worker.terminate()
      options?.signal?.removeEventListener('abort', handleAbort)
    }

    /**
     * 全流程**只注册这一个**中止监听器，由 `rejectCompress` 路由到当前该拒绝
     * 的那个 promise。
     *
     * 不能拆成两个（外层一个、startCompress 里再加一个）：cleanup 会在 abort
     * 事件派发途中移除后者，而 DOM 规定派发中被移除且尚未调用的监听器不再调用，
     * 于是 startCompress 的 promise 永远不 settle，整条流水线挂死。
     */
    const handleAbort = () => {
      const reason = reasonOf(options?.signal)
      const rejectActive = rejectCompress ?? reject
      cleanup()
      rejectActive(reason)
    }

    options?.signal?.addEventListener('abort', handleAbort, { once: true })

    // worker 回收后是空操作：消费者可能比 done/abort 晚一拍才发现自己失败，
    // 那时 postMessage 已经没有接收方了。
    const post = (msg: unknown) => {
      if (!settled) worker.postMessage(msg)
    }
    const addCredits = (count = 1) => post({ type: 'credit', count })
    const failCompress = (message: string) => post({ type: 'fail', message })

    const startCompress = (opts: StreamCompressOptions) =>
      new Promise<void>((res, rej) => {
        const fail = (err: unknown) => {
          cleanup()
          rej(err)
        }
        // 交接中止处理权：此后 handleAbort 要 reject 的是这个 promise
        rejectCompress = rej

        if (options?.signal?.aborted) {
          fail(reasonOf(options.signal))
          return
        }

        worker.onerror = () => fail(new Error(WORKER_FAILED))

        worker.onmessage = (ev: MessageEvent) => {
          const m = ev.data

          switch (m.type) {
            case 'part':
              // 同步入队，立即返回。额度由调用方出队时归还
              opts.onPart(m.partNo, m.blob)
              return

            case 'cut':
              opts.onCut?.(m.partNo, m.srcSpan)
              return

            case 'stats':
              opts.onStats?.({
                estZipBytes: m.estZipBytes,
                srcDone: m.srcDone,
                stalledMs: m.stalledMs,
              })
              return

            case 'part-verify':
              if (opts.onVerify && !opts.onVerify(m.partNo, m.md5)) {
                failCompress(NON_DETERMINISTIC_ZIP)
              }
              return

            case 'done':
              cleanup()
              res()
              return

            case 'error':
              fail(new Error(m.message))
              return
          }
        }

        worker.postMessage({
          type: 'compress',
          imzmlName: opts.entryNames.imzmlName,
          ibdName: opts.entryNames.ibdName,
          partSize: opts.partSize,
          initialCredits: opts.initialCredits,
          maxPartCount: opts.maxPartCount,
          compressIbd: opts.compressIbd,
          donePartNumbers: opts.donePartNumbers ?? [],
          verifyPartNo: opts.verifyPartNo ?? null,
        })
      })

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data

      switch (msg.type) {
        case 'progress':
          report(msg, options?.onProgress)
          return

        case 'hash-ready':
          resolve({
            fileHash: msg.hash,
            startCompress,
            addCredits,
            failCompress,
            dispose: cleanup,
          })
          return

        case 'error':
          cleanup()
          reject(new Error(msg.message))
          return
      }
    }

    worker.onerror = () => {
      cleanup()
      reject(new Error(WORKER_FAILED))
    }

    worker.postMessage({
      type: 'start',
      imzml: pair.imzml,
      ibd: pair.ibd,
      readChunkSize: OSS_UPLOAD.readChunkSize,
    })
  })
}

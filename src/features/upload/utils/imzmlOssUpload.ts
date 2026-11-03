import { type ImzmlFilePair, type UnifiedUploadProgress, type PartRetryInfo } from './imzmlHelper'
import { prepareUpload, NON_DETERMINISTIC_ZIP } from './imzmlCompress'
import { auth_api } from '@/shared/api/httpClient'
import {
  saveUploadSession,
  loadUploadSession,
  cleanupResumable,
  resetSessionForReupload,
  type UploadSession,
  type UploadSourceIdentity,
} from './uploadResume'
import { openMultipartSession, normalizeEtag, type MultipartUploadSession } from './ossMultipart'
import { abortIntentOf, messageOf, reasonOf } from './uploadAbort'
import { OSS_UPLOAD, ENV, pickPartPlan, planForPartSize } from '@/shared/config'
import { generateDatasetFilename } from './filenameGenerator'
import { PartQueue } from './partQueue'
import { UploadProgressMeter } from './zipSizeEstimator'
import { ConcurrencyGovernor } from './concurrencyGovernor'
import { t } from '@/i18n'

// POST /files/upload 的返回
interface OssUploadResponse {
  oss_sts_token: {
    AccessKeyId: string
    AccessKeySecret: string
    SecurityToken: string
    Expiration: string
  }
  oss_bucket: string
  oss_path: string
  oss_region_id: string
}

export interface UploadImzmlOssConfig {
  files?: ImzmlFilePair
  datasetName?: string
  metadata?: Record<string, any>
  signal?: AbortSignal
  onProgress?: (progress: UnifiedUploadProgress) => void
  resume?: boolean
}

export function sourceIdentityOf(pair: ImzmlFilePair): UploadSourceIdentity {
  return {
    imzmlName: pair.imzml.name,
    imzmlSize: pair.imzml.size,
    ibdName: pair.ibd.name,
    ibdSize: pair.ibd.size,
  }
}

/** 名称+大小的即时比对。真正的判据是哈希，这里只是为了尽早给出可读的错误 */
export function sourceMatches(a: UploadSourceIdentity, b: UploadSourceIdentity): boolean {
  return (
    a.imzmlName === b.imzmlName &&
    a.imzmlSize === b.imzmlSize &&
    a.ibdName === b.ibdName &&
    a.ibdSize === b.ibdSize
  )
}

/** 用户可见文案，抛出时才按当前界面语言取（不参与任何字符串比较） */
const mismatchedSource = () => t('upload.error.mismatchedSource')

/**
 * 一次上传失败之后，会话和 OSS 分片该怎么处置。
 *
 *   discard-session  zip 字节不可复现 —— 这一轮 multipart 已不可信，全部丢弃
 *   reset-parts      用户主动放弃 —— 作废 OSS 分片并清空分片轮次，保留 filePublicId/STS
 *   keep-session     组件卸载 / 网络失败 / STS 过期 —— 原样保留，供续传
 *
 * 抽成纯函数是为了能单独测：三者的差别只在「保留什么」，混在 catch 里写很容易
 * 把用户取消和网络失败当成同一回事，而前者必须清掉已作废的 uploadId。
 */
export type FailureDisposition = 'discard-session' | 'reset-parts' | 'keep-session'

function dispositionFor(err: unknown, zipMismatch: boolean): FailureDisposition {
  if (zipMismatch || (err as { message?: unknown } | null)?.message === NON_DETERMINISTIC_ZIP) {
    return 'discard-session'
  }
  if (abortIntentOf(err) === 'user-cancel') return 'reset-parts'
  return 'keep-session'
}

/** 超限文案：UI 预检和管线兜底共用，避免两处措辞不一致 */
export function tooLargeMessage(sourceBytes: number): string {
  const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`
  return t('upload.error.tooLarge', { size: gb(sourceBytes), max: gb(OSS_UPLOAD.maxUploadBytes) })
}

/**
 * imzML → OSS 上传流水线（边压边传，不落本地磁盘）。
 *
 *   1. Worker 读源文件算 MD5，停在压缩之前
 *   2. 用「原始大小 + 哈希」preflight → public_id；命中秒传直接返回
 *   3. 取 STS 凭证并 initMultipartUpload —— 必须在压缩之前，因为压缩即上传
 *   4. worker 产出分片 → PartQueue 缓冲 → k 个消费者并发传 OSS。
 *      背压走信用额度（出队即归还），所以单片重试不会冻住压缩
 *   5. 合并分片
 *
 * 续传的代价：本地没有缓存的 ZIP，所以必须请用户重新选同一对源文件重压一遍。
 * 已传到 OSS 的分片不重传，前提是「同样的输入 → 同样的 zip 字节」；重新生成
 * 第一个已完成分片时用 MD5 对一次 ETag 来验证这个前提，对不上就整轮作废。
 */
export async function uploadImzmlZipFileOSS({
  files,
  datasetName = 'mass_dataset',
  metadata = {},
  signal,
  onProgress,
  resume = false,
}: UploadImzmlOssConfig) {
  if (signal?.aborted) throw reasonOf(signal)
  if (!files) throw new Error('No files provided for upload')

  // 体积上限放在算哈希之前 —— 否则会先把整个数据集读一遍才拒绝
  const sourceBytes = files.imzml.size + files.ibd.size
  if (sourceBytes > OSS_UPLOAD.maxUploadBytes) {
    throw new Error(tooLargeMessage(sourceBytes))
  }

  // ---------- 续传会话 ----------
  let session: UploadSession | null = null
  if (resume) {
    session = loadUploadSession()
    if (!session) throw new Error(t('upload.error.noSession'))
    if (new Date(session.stsExpiration).getTime() <= Date.now()) {
      await cleanupResumable()
      throw new Error(t('upload.error.sessionExpired'))
    }
    if (!sourceMatches(session.source, sourceIdentityOf(files))) {
      throw new Error(mismatchedSource())
    }
  }

  // -----------------------------------------------------------
  // 阶段 1：Worker 算哈希（停在压缩之前）
  // -----------------------------------------------------------
  onProgress?.({ stage: 'preflight', percent: 0, message: t('upload.progress.preparing') })
  const prep = await prepareUpload(files, {
    signal,
    onProgress: (p) =>
      onProgress?.({
        stage: 'preflight',
        percent: p.percent,
        message: t('upload.progress.preparing'),
        speedStr: p.speedStr,
        etaStr: p.etaStr,
      }),
  })
  const fileHash = prep.fileHash

  let filePublicId: string
  let normalizedFilename: string
  let entryNames: { imzmlName: string; ibdName: string }
  let ossData: OssUploadResponse

  // 这一段的任何失败都要回收 worker：它正暂停等 startCompress，不会自行退出。
  // 秒传命中是从 try 里直接 return 的成功路径，它自己显式 dispose。
  try {
    if (session) {
      // 哈希是「是不是同一对文件」的最终判据
      if (fileHash !== session.fileHash) throw new Error(mismatchedSource())
      filePublicId = session.filePublicId
      normalizedFilename = session.datasetName || String(datasetName || 'mass_dataset')
      entryNames = session.entryNames
      ossData = {
        oss_sts_token: {
          AccessKeyId: session.accessKeyId,
          AccessKeySecret: session.accessKeySecret,
          SecurityToken: session.stsToken,
          Expiration: session.stsExpiration,
        },
        oss_bucket: session.ossBucket,
        oss_path: session.ossPath,
        oss_region_id: session.ossRegion,
      }
      onProgress?.({ stage: 'uploading', percent: 0, message: t('upload.progress.resuming') })
    } else {
      // 文件名：{hash6}_{organism}_{part}_{source}_{pixelX}_{polarity}
      normalizedFilename = generateDatasetFilename(metadata, fileHash)

      // -----------------------------------------------------------
      // 阶段 2：preflight（压缩之前做，命中秒传就省掉整个压缩）
      // -----------------------------------------------------------
      onProgress?.({
        stage: 'preflight',
        percent: 100,
        message: t('upload.progress.checkingServer'),
      })

      const preflightRes = await auth_api.post(
        '/files/preflight',
        {
          filename: normalizedFilename,
          size: sourceBytes,
          file_verify_code: fileHash,
          is_public: metadata.is_public ?? false,
          total_parts: 1,
          ...metadata,
          storage_type: 'oss',
        },
        { signal },
      )
      const preflightData = preflightRes.data || preflightRes
      filePublicId = preflightData.public_id
      if (!filePublicId) throw new Error('Preflight did not return public_id')

      if (preflightData.is_reuse) {
        prep.dispose()
        onProgress?.({
          stage: 'completed',
          percent: 100,
          message: t('upload.progress.reusedOnServer'),
        })
        return {
          public_id: filePublicId,
          fileHash,
          oss_path: '',
          reused: true,
          datasetName: normalizedFilename,
        }
      }

      // -----------------------------------------------------------
      // 阶段 3：取 OSS 凭证（压缩之前 —— 压缩产物直接就要往上传）
      // -----------------------------------------------------------
      onProgress?.({ stage: 'preflight', percent: 100, message: t('upload.progress.fetchingCredentials') })
      const uploadRes = await auth_api.post(
        '/files/upload',
        new URLSearchParams({ filename: normalizedFilename, pre_public_id: filePublicId }),
      )
      ossData = uploadRes.data || uploadRes

      if (!ossData.oss_sts_token || !ossData.oss_bucket || !ossData.oss_path) {
        throw new Error('Backend did not return complete OSS credentials')
      }

      // entry 名参与 zip 字节，必须持久化，续传时原样复用
      entryNames = {
        imzmlName: `${normalizedFilename}.imzML`,
        ibdName: `${normalizedFilename}.ibd`,
      }
    }
  } catch (err) {
    prep.dispose()
    throw err
  }

  // -----------------------------------------------------------
  // 阶段 4 & 5：边压缩边直传
  // -----------------------------------------------------------
  const clientOptions = {
    region: `oss-${ossData.oss_region_id}`,
    accessKeyId: ossData.oss_sts_token.AccessKeyId,
    accessKeySecret: ossData.oss_sts_token.AccessKeySecret,
    stsToken: ossData.oss_sts_token.SecurityToken,
    authorizationV4: true,
    bucket: ossData.oss_bucket,
    timeout: OSS_UPLOAD.timeout,
    // endpoint is a bare domain (VITE_OSS_ENDPOINT); force https so ali-oss
    // does not fall back to http:// when assembling the request URL
    secure: true,
    ...(ENV.ossEndpoint ? { endpoint: ENV.ossEndpoint } : {}),
  }
  // 延迟加载：只有真正开始上传才需要 ali-oss
  const { default: OSS } = await import('ali-oss')
  const client = new OSS(clientOptions)

  // uploadId 非空 = 有可续的分片轮次（用户取消时会被清空）。只用这一个判据，
  // 不另设标志位 —— 两个字段表达同一件事就会有不同步的时候。
  const canResumeParts = !!session && !!session.multipart.uploadId
  // 片长续传时必须沿用会话里的值，否则分片边界对不上已传的内容。
  // 并发范围也跟着**实际生效的片长**算，不能按当前档位 —— 分档阈值可能已经改过。
  const partSize = canResumeParts ? session!.multipart.partSize : pickPartPlan(sourceBytes).partSize
  const plan = planForPartSize(partSize)

  // 续传校验点：重新生成的第一个已完成分片，用它的 MD5 对上次的 ETag。
  // 从会话取而不是从 mp 取，是为了在 openMultipartSession 之前就能建好进度表。
  const resumeDoneParts = canResumeParts ? session!.multipart.doneParts : []
  const doneNumbers = resumeDoneParts.map((p) => p.number).sort((a, b) => a - b)
  const verifyPartNo = doneNumbers[0] ?? null
  const expectedEtag = resumeDoneParts.find((p) => p.number === verifyPartNo)?.etag ?? null
  let zipMismatch = false

  // 进度口径是「已确认落到 OSS 的源字节 / File.size」，两端都精确，
  // 不依赖 zip 产物大小的估算（估算只用来算文案里的「第几片 / 共几片」）。
  const meter = new UploadProgressMeter(partSize, sourceBytes, doneNumbers, files.imzml.size)
  const queue = new PartQueue()
  const governor = new ConcurrencyGovernor({
    partSize,
    min: plan.minConcurrency,
    max: plan.maxConcurrency,
  })

  const report = (retry?: PartRetryInfo | null) => {
    if (signal?.aborted) return
    const snap = meter.snapshot()
    onProgress?.({
      stage: 'uploading',
      percent: snap.percent,
      message: t('upload.progress.compressing', {
        done: meter.uploadedPartCount,
        total: meter.totalPartCount,
      }),
      speedStr: snap.speedStr,
      etaStr: snap.etaStr,
      compressSpeedStr: snap.compressSpeedStr,
      uploadSpeedStr: snap.uploadSpeedStr,
      bottleneck: snap.bottleneck,
      imzmlMilestone: snap.imzmlMilestone,
      doneSourceBytes: snap.doneSourceBytes,
      totalSourceBytes: sourceBytes,
      // 刻意区分 undefined 与 null：undefined 表示「这条消息不携带重试状态」，
      // 只有显式 null 才清除告警。否则照常流动的进度会把刚亮起的告警抹掉。
      ...(retry !== undefined ? { retry } : {}),
    })
  }

  let mp: MultipartUploadSession
  try {
    mp = await openMultipartSession(
      client,
      ossData.oss_path,
      canResumeParts
        ? { uploadId: session!.multipart.uploadId, doneParts: session!.multipart.doneParts }
        : undefined,
      { partTimeout: OSS_UPLOAD.partTimeout, signal, onRetry: (info) => report(info) },
    )
  } catch (err) {
    prep.dispose()
    throw err
  }

  /**
   * 会话是否已被下面的 catch 处置掉。
   *
   * 处置之后 persist() 必须闭嘴：ali-oss 取消不了已发出的请求，所以在
   * `cleanupResumable()` 的 await 期间，某个还在飞的消费者可能刚好传完一片
   * 并调用 persist()，把刚删掉的会话又写回去 —— 里面的 uploadId 已经作废了。
   */
  let sessionClosed = false

  const persist = () => {
    if (sessionClosed) return
    saveUploadSession({
      datasetName: normalizedFilename,
      fileHash,
      filePublicId,
      source: sourceIdentityOf(files),
      entryNames,
      ossPath: ossData.oss_path,
      ossBucket: ossData.oss_bucket,
      ossRegion: ossData.oss_region_id || '',
      stsExpiration: ossData.oss_sts_token.Expiration,
      accessKeyId: ossData.oss_sts_token.AccessKeyId,
      accessKeySecret: ossData.oss_sts_token.AccessKeySecret,
      stsToken: ossData.oss_sts_token.SecurityToken,
      zipFormatVersion: OSS_UPLOAD.zipFormatVersion,
      compressIbd: OSS_UPLOAD.compressIbd,
      multipart: { uploadId: mp.uploadId, partSize, doneParts: mp.doneParts },
    })
  }

  // 立刻落一次盘，哪怕第一片都还没传完就刷新页面也能续
  persist()
  let lastSaveTime = Date.now()

  report()

  /**
   * 任一端失败都要同时停掉另一端，否则收尾的 await 会挂在还活着的那半边：
   * 压缩端失败时消费者仍阻塞在 `queue.take()`，消费端失败时 worker 仍在等额度。
   *
   * 传给 queue 的必须是**原始** err：中止原因是个普通对象字面量而不是 Error
   * （见 uploadAbort.ts），包一层就会被压成 `"[object Object]"`，
   * dispositionFor 也就分不出「用户取消」和「组件卸载」了。
   */
  const stopAll = (err: unknown) => {
    queue.fail(err)
    // worker 那条是字符串通道，只能降级成文案
    prep.failCompress(messageOf(err))
  }

  /**
   * 消费者：取一片 → 立刻归还额度 → 上传（重试与退避在 mp.uploadPart 内）。
   *
   * 归还额度的时机是关键：额度表达的是「缓冲区空出一个位置」，与这一片传得
   * 成不成无关，所以出队就还。等上传成功才还的话，一次重试就冻住整条压缩。
   */
  const consume = async () => {
    for (;;) {
      const item = await queue.take()
      if (!item) return
      prep.addCredits(1)
      // 抛 signal.reason 本身而不是新建 AbortError，否则会丢掉中止意图
      if (signal?.aborted) throw signal.reason
      // blob 下面会被置空以尽早释放，字节数必须先取出来
      const wireBytes = item.blob!.size
      // try/finally 保证失败和中止路径也停表，否则「在飞时长」会一直走下去
      meter.uploadStarted()
      try {
        await mp.uploadPart(item.partNo, item.blob!)
      } finally {
        meter.uploadFinished()
      }
      item.blob = null
      meter.partAcked(item.partNo, wireBytes)
      scaleUp()
      report()
      if (Date.now() - lastSaveTime > OSS_UPLOAD.checkpointSaveIntervalMs) {
        lastSaveTime = Date.now()
        persist()
      }
    }
  }

  /**
   * 活跃的消费者。必须是可增长的集合而不是定长数组：收尾时要等的是**当下所有**
   * 消费者，漏掉后加的那些会让流水线在分片还没传完时就走到 complete()。
   */
  const consumers = new Set<Promise<void>>()
  /** 第一个消费者错误。集合里的 promise 一律不 reject，所以要旁路记一份 */
  let consumerError: unknown = null

  const spawnConsumer = () => {
    const task = consume()
      .catch((err) => {
        stopAll(err)
        // 刻意不重新抛出：收尾时先 await 的是生产端，它先抛的话这些 promise
        // 就没人 await，会变成 unhandled rejection
        consumerError ??= err
      })
      // 自我摘除，于是下面的 drain 循环能靠 size 判断「还有没有人在跑」
      .finally(() => consumers.delete(task))
    consumers.add(task)
  }

  /**
   * 每确认一片就问一次调度器要不要加人。
   *
   * 补额度这一步不能省：worker 初始只持有 `minConcurrency` 点额度，不同步放宽
   * 的话新起的消费者只会一起阻塞在 `queue.take()` 上 —— 并发扩了，在飞的分片数
   * 没变，等于没扩。额度与并发同步增长也正是内存上界 `2 × 并发 × 片长` 的由来。
   */
  const scaleUp = () => {
    const added = governor.update(meter.wireUploadRate)
    if (added <= 0) return
    prep.addCredits(added)
    for (let i = 0; i < added; i++) spawnConsumer()
  }

  try {
    // 计时从这里起跑而不是从 meter 构造起：中间隔着 initMultipartUpload
    // 的一次往返，算进去会让开头的速度读数无端偏低
    meter.start()
    const producing = prep
      .startCompress({
        entryNames,
        partSize,
        initialCredits: plan.minConcurrency,
        maxPartCount: OSS_UPLOAD.maxPartCount,
        compressIbd: OSS_UPLOAD.compressIbd,
        donePartNumbers: doneNumbers,
        verifyPartNo,
        onVerify: (_partNo, md5) => {
          const ok = !!expectedEtag && normalizeEtag(md5) === normalizeEtag(expectedEtag)
          if (!ok) zipMismatch = true
          return ok
        },
        // 同步入队。压缩的放行靠额度，不靠这里的返回值
        onPart: (partNo, blob) => queue.push({ partNo, blob }),
        // 进度条的数据源。必定先于同一片的 onPart 到达；续传时被跳过的分片
        // 也会走这里，它们的源字节在 partCut 里直接计入进度
        onCut: (partNo, srcSpan) => meter.partCut(partNo, srcSpan),
        onStats: ({ estZipBytes, srcDone, stalledMs }) => {
          meter.updateEstimate(estZipBytes)
          meter.compressStats(srcDone, stalledMs)
          report()
        },
      })
      .then(
        // 「字节全部外发」≠「全部上传完成」：封口后由消费者把队列排空
        () => queue.sealProducer(),
        (err) => {
          stopAll(err)
          throw err
        },
      )

    for (let i = 0; i < plan.minConcurrency; i++) spawnConsumer()

    // 集合会在 await 期间增长（scaleUp 加人），所以不能只 await 一次快照。
    // 循环到集合空为止：消费者是靠 take() 返回 null 才退出的，最后一个退出时
    // 队列必然已排空，而 scaleUp 只在 partAcked 之后调，那时不会再有人加入。
    await producing
    while (consumers.size > 0) await Promise.all([...consumers])
    if (consumerError) throw consumerError

    onProgress?.({ stage: 'syncing', percent: 100, message: t('upload.progress.finalizing') })
    await mp.complete()

    onProgress?.({ stage: 'completed', percent: 100, message: t('upload.progress.complete') })
    await cleanupResumable()

    return {
      public_id: filePublicId,
      fileHash,
      oss_path: ossData.oss_path,
      reused: false,
      datasetName: normalizedFilename,
      totalSourceBytes: sourceBytes,
    }
  } catch (err: any) {
    // 会话的处置权由这个 switch 独占。先封住 persist()，
    // 免得还在飞的消费者把已作废的 uploadId 写回去。
    const disposition = dispositionFor(err, zipMismatch)
    if (disposition !== 'keep-session') sessionClosed = true

    switch (disposition) {
      case 'discard-session':
        void mp.abort().catch(() => {})
        await cleanupResumable()
        throw new Error(t('upload.error.notReproducible'))

      case 'reset-parts':
        // abort 不 await：它只是提前释放 OSS 上的分片存储，bucket 的生命周期
        // 规则才是最终兜底。取消常常发生在网络已经坏掉的时候，让用户对着
        // 「Aborting…」干等一个可能吊满超时的 DELETE 没有意义。
        // 清空会话是同步的 localStorage 写，不依赖 DELETE 的结果。
        void mp.abort().catch(() => {})
        resetSessionForReupload()
        throw err

      case 'keep-session':
        persist()
        throw err
    }
  }
}

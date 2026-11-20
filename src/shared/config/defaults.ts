/**
 * 内部代码常量（实现层调优参数，**非**「人来配置」的内容）。
 *
 * 面向用户/运维的偏好（名称、导航、分页、验证码）放运行时 config.json（见 runtimeConfig.ts）；
 * 地址类放 env/ 目录的 .env 文件（见 env.ts）。此处只保留改了会影响实现细节、不应暴露给配置文件的常量。
 */

const MB = 1024 * 1024
const GB = 1024 * 1024 * 1024

/**
 * OSS 分片上传（凭证来自后端 STS，此处仅为客户端可调参数）。
 *
 * 片长与并发范围**不在这里**，见 `pickPartPlan()` —— 它们按数据集总大小分档，
 * 单独写成常量会和分档逻辑打架。单片超时在这里，因为它已经与片长无关。
 */
export const OSS_UPLOAD = {
  /** OSS 客户端超时（ms）。只作用于 init / complete / abort 这类控制面请求 */
  timeout: 30000,
  /** OSS 协议规定的单次 multipart 最大分片数 */
  maxPartCount: 9999,
  /**
   * ibd 是否参与压缩。**运维旋钮，不暴露给用户。**
   *
   * true：走 zip.js 默认的原生 CompressionStream。ibd 是 float 二进制，
   * deflate 压缩率约 0.85~0.95，换来 5~15% 的传输量减少，代价是压缩吞吐
   * 从 STORE 的约 300MB/s 降到 100~200MB/s。实测压缩仍远快于上传，所以划算。
   *
   * 若哪天压缩成了瓶颈（UI 上表现为 `bottleneck: 'compress'` 常驻），改成
   * false：ibd 走 `level: 0`，zip.js 据此选 STORE，字节原样写入、不进 codec。
   *
   * ⚠️ 这个值参与 zip 字节，改动后所有待续传的会话都会作废 —— 由 uploadResume
   * 的同名字段拦下，不会压到一半才报错。它是独立字段，不必动 zipFormatVersion。
   */
  compressIbd: true,
  /**
   * 源文件读块 + zip.js 内部编解码块大小（bytes）。
   *
   * 刻意与分片大小解耦：它决定单次 `FileReader` 驻留多少字节，放大到分片那个
   * 量级（50~128MB）会把峰值内存推高几百 MB，而 FileReader 的吞吐 4MB 以上
   * 就饱和了，放大买不到任何东西。
   */
  readChunkSize: 16 * MB,
  /** 单个分片失败后的重试次数（指数退避）→ 共 2 次尝试 */
  partRetries: 1,
  /**
   * 单个分片的上传超时（ms）。按时间定，与片长和并发都无关。
   *
   * 定得足够松是刻意的：它只兜底「连接既不报错也不推进」这一种情况，真正的
   * 故障绝大多数会以连接错误的形式立刻抛出。最严的一格（128MB 片跑满并发 2）
   * 也只要求 146KB/s，正常网络下不可能触发。每档的门槛有单测守着，
   * 加档位或调并发上限都会被拦下（见 uploadLimits.test.ts）。
   *
   * 代价：一个静默挂死的连接最坏要 (partRetries + 1) × 30min ≈ 60 分钟才暴露。
   */
  partTimeout: 30 * 60 * 1000,
  /**
   * 上传流水线的最坏驻留字节数。**并发上限由它反推**，见 `pickPartPlan()`。
   *
   * 最坏内存 = (信用额度 + 并发数) × 片长，而额度恒等于当前并发数
   * （消费者出队即归还，扩并发时同步补额度），所以 = 2 × 并发 × 片长。
   * 正在上传的那几片也要算：ali-oss 在浏览器端会把分片完整读成 ArrayBuffer 才发。
   *
   * 这个上界只在消费者被重试卡住时才顶得到 —— 平时消费者比生产者快，队列是空的。
   */
  maxInflightBytes: 512 * MB,
  /**
   * 单次上传的体积上限（bytes，200GB），按 **源文件之和**（imzML + ibd）计。
   *
   * 这是产品侧的策略上限。物理上限是「片长 × maxPartCount」，而片长是分档的，
   * 所以校验必须**逐档**做：每一档在它自己的大小上界处都要满足
   * `partSize × 9999 > 该档上界`，否则落在那一档的上传会走到一半才在切片处失败。
   * 只看最小档没有意义 —— 10MB 档只服务 5GB 以下的数据集。有单测逐档守着。
   *
   * 之所以按源文件而不是压缩产物计：产物大小事先未知，而且 ibd 几乎压不动，
   * 产物大小和源文件基本相当。
   */
  maxUploadBytes: 200 * GB,
  /** 会话（uploadId + 已完成分片）持久化节流间隔（ms），用于跨会话断点续传 */
  checkpointSaveIntervalMs: 5000,
  /**
   * zip 产物的格式版本。压缩参数、entry 顺序、`ZIP_EPOCH` 任一变动都要 +1。
   *
   * 续传依赖「同样的输入 → 同样的 zip 字节」。版本号让参数变更后的旧会话被
   * 直接丢弃，而不是等到重新压缩出第一个已完成分片、MD5 对不上 ETag 才发现。
   */
  zipFormatVersion: 2,
} as const

export interface PartPlan {
  /** 分片大小（bytes）。累积到 ≥ 此值即成片，尾片可以更小 */
  partSize: number
  /** 并发度的起点与下限，同时也是 worker 的初始信用额度 */
  minConcurrency: number
  /** 并发度的上限。由 `maxInflightBytes` 反推，见 pickPartPlan */
  maxConcurrency: number
}

/**
 * 并发下限 = 初始并发。
 *
 * 不设成 1：第 2 条并发买的不是吞吐（大片的固定开销早被摊薄了），
 * 而是「一片卡进重试时另一片还在跑」—— 并发 1 时任何一次退避都是整条停摆。
 */
const MIN_CONCURRENCY = 2

/**
 * 并发硬上限，与片长无关的那一道。
 *
 * HTTP/1.1 下浏览器对单个域名只开 6 条连接（不能假设 endpoint 会协商到
 * HTTP/2，按 6 算），多出来的只是排队，买不到吞吐。
 * 留 2 条给 init/complete/abort 这类控制面请求和正在退避的分片。
 */
const MAX_CONCURRENCY = 4

/**
 * 片长 → 分片计划。内存预算与连接数预算取更紧的那个。
 *
 * 必须能**按片长单独调用**：续传时片长沿用会话里的值，而分档阈值可能已经
 * 改过。按当前档位算并发、却按会话的片长切片，内存上界就会算错 —— 老会话的
 * 128MB 片配上新档位给 10MB 算出的并发 4，实际是 1GB 而不是 512MB。
 */
export function planForPartSize(partSize: number): PartPlan {
  const byMemory = Math.floor(OSS_UPLOAD.maxInflightBytes / (2 * partSize))
  return {
    partSize,
    minConcurrency: MIN_CONCURRENCY,
    maxConcurrency: Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, byMemory)),
  }
}

/**
 * 按数据集总大小（源文件之和）分档给出分片计划。
 *
 * 片长随数据集放大，既为了压请求数，也为了不撞 `maxPartCount`：200GB 用 10MB
 * 片要 20480 片，超了 9999 的分片数限制；128MB 片只要 1600 片（未计 ZIP 开销）。
 * 并发上限反向收窄，由 `maxInflightBytes` 反推，三档算出来是 4 / 4 / 2。
 *
 * 顶档停在 128MB 而不是 256MB：256MB 要压到同样内存只能把并发降到 1，
 * 而 128MB + 并发 2 内存相近、吞吐更好，单块 ArrayBuffer 也更小。
 *
 * ⚠️ 实际调节范围比上限小得多：调度器的目标是 `floor(线路速率 / 片长)`，
 * 50MB 档要 150MB/s 才升得到 3。**动态并发实质上只在 10MB 档生效**，
 * 另两档的上限是内存防御而不是调节手段。
 */
export function pickPartPlan(totalBytes: number): PartPlan {
  return planForPartSize(totalBytes < 5 * GB ? 10 * MB : totalBytes < 10 * GB ? 50 * MB : 128 * MB)
}

/** Zarr OSS Store 配置 */
export const ZARR_STORE = {
  /** intensity chunk 缓存数量（LRU） */
  intensityChunkCacheSize: 5,
  /** data/mz chunk 缓存数量（LRU），仅 processed 模式使用 */
  mzChunkCacheSize: 5,
  /** 默认 m/z 容差 */
  defaultMzTolerance: 0.0001,
  /** m/z 容差取值范围：最小 1e-8，最大 1 */
  minMzTolerance: 1e-8,
  maxMzTolerance: 1,
} as const

/** 下载限制 */
export const DOWNLOAD_LIMIT = {
  /** 两次下载之间的冷却时长（秒） */
  cooldownSeconds: 60,
} as const

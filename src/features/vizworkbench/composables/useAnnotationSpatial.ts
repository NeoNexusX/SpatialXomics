/**
 * 空间评分的取图队列。
 *
 * zarr store 和 OSS 凭证都在主线程，离子图在这里读取，副本交给 worker 计算混乱度和
 * 相关。按任务优先级排队，并发 3 个；同一张图同时只发一次请求；LRU 按字节封顶
 * （全分辨率 Float32 离子图，大图 4 MB 以上一张）。worker 按峰缓存混乱度、按峰对
 * 缓存相关，本批已经交过去的峰和峰对不再取图。
 */

import { onUnmounted } from 'vue'
import {
  getSharedZarrContext,
  loadIonMatrixByIndex,
  mzAxisRef,
} from '@/features/vizworkbench/composables/useZarrIonImage'
import { hotspotClip } from '@/features/vizworkbench/utils/annotation/chaos'
import { pairKey, pearsonUnionMask } from '@/features/vizworkbench/utils/annotation/pearson'
import { toleranceDa } from '@/features/vizworkbench/utils/annotation/tolerance'
import type { SpatialJob, Tolerance } from '@/features/vizworkbench/types/annotation'

const IMAGE_CACHE_BYTES = 128 * 1024 * 1024
const CONCURRENCY = 3

export function useAnnotationSpatial(opts: {
  /** 当前容差（决定取图窗口） */
  tolerance: () => Tolerance | null
  /**
   * 一个任务的图取齐了（与 job.axisIndices 一一对应；null = 读取失败，undefined = 这个峰的
   * 混乱度和它所在的峰对都已交给过 worker，没有取图）。传入的是副本
   */
  onImages: (
    job: SpatialJob,
    images: (Float32Array | null | undefined)[],
    width: number,
    height: number,
  ) => void
}) {
  let queue: SpatialJob[] = []
  /** queue[head] 起是还没开始的任务：出队只移动下标（几万个任务时数组 shift 是 O(n)） */
  let head = 0
  let inFlight = 0
  let generation = 0
  let disposed = false
  /** 本批已交给 worker 的有效图的峰，以及同一任务里一起交过去的峰对（pairKey） */
  let sentAxes = new Set<number>()
  let sentPairs = new Set<string>()

  /** 键 = 轴下标 + 取图窗口；换容差不用清。换了数据集（m/z 轴）下标含义就变了，必须清 */
  const cache = new Map<string, Float32Array>()
  const pending = new Map<string, Promise<Float32Array>>()
  let cacheBytes = 0
  let cacheAxis: Float64Array | null = null

  function cacheKey(axisIndex: number, tolDa: number): string {
    return `${axisIndex}@${tolDa.toPrecision(4)}`
  }

  function clearCache(): void {
    cache.clear()
    pending.clear()
    cacheBytes = 0
  }

  function remember(key: string, img: Float32Array): void {
    cache.set(key, img)
    cacheBytes += img.byteLength
    while (cache.size > 1 && cacheBytes > IMAGE_CACHE_BYTES) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cacheBytes -= cache.get(oldest)?.byteLength ?? 0
      cache.delete(oldest)
    }
  }

  function loadImage(axisIndex: number): Promise<Float32Array> {
    const tol = opts.tolerance()
    const axis = mzAxisRef.value
    if (!tol || !axis || axisIndex < 0 || axisIndex >= axis.length) {
      return Promise.reject(new Error('ion image unavailable'))
    }
    if (axis !== cacheAxis) {
      clearCache()
      cacheAxis = axis
    }
    const tolDa = toleranceDa(axis[axisIndex]!, tol)
    const key = cacheKey(axisIndex, tolDa)
    const hit = cache.get(key)
    if (hit) {
      cache.delete(key)
      cache.set(key, hit)
      return Promise.resolve(hit)
    }
    const inflight = pending.get(key)
    if (inflight) return inflight
    const p = loadIonMatrixByIndex(axisIndex, tolDa)
      .then((img) => {
        pending.delete(key)
        remember(key, img)
        return img
      })
      .catch((e: unknown) => {
        pending.delete(key)
        throw e
      })
    pending.set(key, p)
    return p
  }

  function dims(): { width: number; height: number } | null {
    const shape = getSharedZarrContext().ionShape
    return shape ? { width: shape.width, height: shape.height } : null
  }

  /** 峰本身没交过，或它和任务里另一个峰的峰对没交过，worker 才需要这张图 */
  function needsImage(axis: number, job: SpatialJob): boolean {
    return (
      !sentAxes.has(axis) ||
      job.axisIndices.some((other) => other !== axis && !sentPairs.has(pairKey(axis, other)))
    )
  }

  async function runJob(job: SpatialJob, gen: number): Promise<void> {
    try {
      const images = await Promise.all(
        job.axisIndices.map((idx) =>
          needsImage(idx, job) ? loadImage(idx).catch(() => null) : undefined,
        ),
      )
      if (gen !== generation || disposed) return
      const d = dims()
      if (!d) return
      // 与 worker 判定有效图的条件相同：这些峰的混乱度和它们两两的相关会在 worker 里缓存
      const sent = job.axisIndices.filter((_, k) => images[k]?.length === d.width * d.height)
      sent.forEach((axis, i) => {
        sentAxes.add(axis)
        for (let j = i + 1; j < sent.length; j++) sentPairs.add(pairKey(axis, sent[j]!))
      })
      // 副本交给 worker（转移副本的 buffer，缓存里的原图不动）
      opts.onImages(
        job,
        images.map((img) => (img ? new Float32Array(img) : img)),
        d.width,
        d.height,
      )
    } finally {
      if (gen === generation) {
        inFlight--
        pump()
      }
    }
  }

  function pump(): void {
    while (!disposed && inFlight < CONCURRENCY && head < queue.length) {
      const job = queue[head++]!
      inFlight++
      void runJob(job, generation)
    }
  }

  /** 开始一批新任务（丢弃上一批） */
  function start(jobs: SpatialJob[]): void {
    cancel()
    queue = [...jobs].sort((a, b) => a.priority - b.priority)
    pump()
  }

  function cancel(): void {
    generation++
    inFlight = 0
    queue = []
    head = 0
    sentAxes = new Set()
    sentPairs = new Set()
  }

  /** 把这些任务提到队首（可见行、悬停行） */
  function bump(jobKeys: string[]): void {
    if (jobKeys.length === 0) return
    const want = new Set(jobKeys)
    const pending = queue.slice(head)
    const front = pending.filter((j) => want.has(j.job))
    if (front.length === 0) return
    queue = [...front, ...pending.filter((j) => !want.has(j.job))]
    head = 0
    pump()
  }

  /** 详情卡按需计算两峰的共定位（只展示，不计入总分） */
  async function pairOnDemand(
    axisA: number,
    axisB: number,
    minPixels: number,
  ): Promise<number | null> {
    const [a, b] = await Promise.all([loadImage(axisA), loadImage(axisB)])
    return pearsonUnionMask(hotspotClip(a, 99), hotspotClip(b, 99), minPixels)
  }

  onUnmounted(() => {
    disposed = true
    cancel()
    clearCache()
  })

  return { start, cancel, bump, pairOnDemand }
}

/**
 * 空间评分的取图队列。
 *
 * zarr store 和 OSS 凭证都在主线程，离子图在这里读取，交给 worker 计算混乱度和相关。
 * ion_image 按 m/z 轴顺序把多张整图打包进一个 chunk 存，所以按轴下标从小到大读：同一
 * chunk 里的图挨着读，每个 chunk 只下载、解压一次。每个峰只读一次；worker 留着的图超出
 * 内存上限被释放、之后又要用时，在回复里列出要重读的峰，排在最前面读。
 * 开始时先读排名最前的几组（表格首屏），表格请求的组（可见行、悬停行）也提到前面。
 * 在读和等 worker 处理的图按字节封顶：worker 算得慢时读取跟着放慢。
 */

import { onUnmounted } from 'vue'
import {
  getSharedZarrContext,
  loadIonMatrixByIndex,
  mzAxisRef,
} from '@/features/vizworkbench/composables/useZarrIonImage'
import { hotspotClip } from '@/features/vizworkbench/utils/annotation/chaos'
import { pearsonUnionMask } from '@/features/vizworkbench/utils/annotation/pearson'
import { toleranceDa } from '@/features/vizworkbench/utils/annotation/tolerance'
import type { SpatialJob, Tolerance } from '@/features/vizworkbench/types/annotation'

/** 详情卡按需算相关时的离子图缓存 */
const IMAGE_CACHE_BYTES = 128 * 1024 * 1024
/** 在读和等 worker 处理的图的总字节上限 */
const IN_FLIGHT_BYTES = 32 * 1024 * 1024
const MIN_IN_FLIGHT = 4
const MAX_IN_FLIGHT = 256
/** 一个峰最多读几次（读取出错时重试） */
const MAX_ATTEMPTS = 2
/** 开始时先读排名最前的几组 */
const FIRST_JOBS = 24

interface Read {
  axis: number
  attempt: number
}

export function useAnnotationSpatial(opts: {
  /** 当前容差（决定取图窗口） */
  tolerance: () => Tolerance | null
  /**
   * 把一个峰的离子图交给 worker（null = 读取失败），buffer 会被转移。worker 处理完后 resolve，
   * 带回要重读的峰
   */
  send: (
    axis: number,
    image: Float32Array | null,
    width: number,
    height: number,
  ) => Promise<number[]>
}) {
  let generation = 0
  let disposed = false
  let inFlight = 0
  /** 本批要读的全部峰，按轴下标从小到大；cursor 之前的已经轮到过 */
  let sweep: number[] = []
  let cursor = 0
  /** 提前读的峰：越新的请求越靠前 */
  let bumped: number[] = []
  /** 重读与出错重试：最先读 */
  let urgent: Read[] = []
  /** 本批已经开始读的峰（重读和重试不受限） */
  let started = new Set<number>()
  let jobAxes = new Map<string, number[]>()

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

  /** 一个峰在当前容差下的取图窗口；数据或容差不可用时为 null */
  function windowOf(axisIndex: number): number | null {
    const tol = opts.tolerance()
    const axis = mzAxisRef.value
    if (!tol || !axis || axisIndex < 0 || axisIndex >= axis.length) return null
    return toleranceDa(axis[axisIndex]!, tol)
  }

  /** 读一个峰的离子图，每次都是新数组（交给 worker 时直接转移） */
  function readImage(axisIndex: number): Promise<Float32Array> {
    const tolDa = windowOf(axisIndex)
    if (tolDa == null) return Promise.reject(new Error('ion image unavailable'))
    return loadIonMatrixByIndex(axisIndex, tolDa)
  }

  /** 带缓存的读取（详情卡按需算相关） */
  function loadImage(axisIndex: number): Promise<Float32Array> {
    const tolDa = windowOf(axisIndex)
    if (tolDa == null) return Promise.reject(new Error('ion image unavailable'))
    const axis = mzAxisRef.value
    if (axis !== cacheAxis) {
      clearCache()
      cacheAxis = axis
    }
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

  function inFlightLimit(): number {
    const d = dims()
    const bytes = d ? d.width * d.height * 4 : 0
    if (!(bytes > 0)) return MIN_IN_FLIGHT
    return Math.min(MAX_IN_FLIGHT, Math.max(MIN_IN_FLIGHT, Math.floor(IN_FLIGHT_BYTES / bytes)))
  }

  function nextRead(): Read | undefined {
    const first = urgent.shift()
    if (first) return first
    while (bumped.length > 0) {
      const axis = bumped.shift()!
      if (!started.has(axis)) return claim(axis)
    }
    while (cursor < sweep.length) {
      const axis = sweep[cursor++]!
      if (!started.has(axis)) return claim(axis)
    }
    return undefined
  }

  function claim(axis: number): Read {
    started.add(axis)
    return { axis, attempt: 1 }
  }

  async function readAndSend({ axis, attempt }: Read, gen: number): Promise<void> {
    try {
      let image: Float32Array | null = null
      try {
        image = await readImage(axis)
      } catch {
        if (gen === generation && attempt < MAX_ATTEMPTS) {
          urgent.push({ axis, attempt: attempt + 1 })
          return
        }
      }
      if (gen !== generation || disposed) return
      const d = dims()
      const ok = image != null && d != null && image.length === d.width * d.height
      const reread = await opts.send(axis, ok ? image : null, d?.width ?? 0, d?.height ?? 0)
      if (gen !== generation || disposed) return
      for (const a of reread) urgent.push({ axis: a, attempt: 1 })
    } finally {
      if (gen === generation) {
        inFlight--
        pump()
      }
    }
  }

  function pump(): void {
    const limit = inFlightLimit()
    while (!disposed && inFlight < limit) {
      const next = nextRead()
      if (!next) return
      inFlight++
      void readAndSend(next, generation)
    }
  }

  /** 开始一批新任务（丢弃上一批） */
  function start(jobs: SpatialJob[]): void {
    cancel()
    jobAxes = new Map(jobs.map((j) => [j.job, j.axisIndices]))
    sweep = [...new Set(jobs.flatMap((j) => j.axisIndices))].sort((a, b) => a - b)
    const first = [...jobs].sort((a, b) => a.priority - b.priority).slice(0, FIRST_JOBS)
    bump(first.map((j) => j.job))
    pump()
  }

  function cancel(): void {
    generation++
    inFlight = 0
    sweep = []
    cursor = 0
    bumped = []
    urgent = []
    started = new Set()
    jobAxes = new Map()
  }

  /** 把这些任务还没读的峰提到前面（开始时的首屏、可见行、悬停行） */
  function bump(jobKeys: string[]): void {
    const front: number[] = []
    const seen = new Set<number>()
    for (const key of jobKeys) {
      for (const axis of jobAxes.get(key) ?? []) {
        if (started.has(axis) || seen.has(axis)) continue
        seen.add(axis)
        front.push(axis)
      }
    }
    if (front.length === 0) return
    bumped = [...front, ...bumped.filter((axis) => !seen.has(axis))]
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

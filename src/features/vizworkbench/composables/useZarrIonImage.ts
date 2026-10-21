/**
 * Ion image composable — loads zarr data on demand via OSS STS.
 *
 * Supports two data modes:
 *   - continuous: ion image + mean spectrum, plus per-pixel spectra read from
 *     the spectra group (the spectrum panel switches via spectrumView)
 *   - processed: TIC image + per-pixel spectrum
 *
 * selectedMzIndex is the single source of truth for the ion image (continuous);
 * pixelSpectrum is the source of truth for the per-pixel spectrum (both modes).
 * selectedMz is derived from selectedMzIndex + mzAxis (continuous only).
 *
 * ⚠️ 模块级单例：store / mzAxisRef / dataModeRef 等约 20 个状态已抽到
 * services/zarr/zarrSharedState（跨 feature 共享 API，assistant 只读消费），
 * 由可视化工作台（VizWorkbench）独占写入（useRegionComparison / useAnnotation 等横向消费）。
 * 路由是单实例（/viz 组件复用 + onUnmounted dispose），因此成立；
 * 但切勿同时挂载两个消费者（KeepAlive 多实例、第二页签组件），否则后 init 的
 * 实例会 dispose 前者仍在用的 store。如需多实例，须重构为 provide/inject 工厂。
 * 生命周期竞态由 initGeneration 代次守卫：init() 进行中发生 disposeZarrState()
 * 或新一轮 init()，旧 init 在每个 await 检查点放弃并 dispose 自己的孤儿 store。
 */

import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { getZarrAccess } from '@/services/zarr/api/zarrAccessApi'
import { ZarrIncompatibleError, ZarrOssStore } from '@/services/zarr/zarrOssStore'
import {
  // 共享状态收在 services 层（跨 feature API）：这里引入内部使用 + 转发导出
  store,
  setZarrStore,
  mzAxisRef,
  ionDims,
  dataModeRef,
  rowAxisRef,
  metadataAttrsRef,
  meanChartData,
  meanSpectrumRef,
  spectrumLoading,
  spectrumError,
  nMz,
  ticMatrix,
  ticLoading,
  ticError,
  pixelSpectrum,
  pixelSpectrumLoading,
  pixelSpectrumError,
  requestedPixelIndex,
  spectrumView,
  resetZarrSharedState,
} from '@/services/zarr/zarrSharedState'
import { buildSpectrumChartData } from '@/features/vizworkbench/utils/spectrumChartData'
import { ZARR_STORE } from '@/shared/config/defaults'
import { getConfig } from '@/shared/config'
import { formatNumber } from '@/shared/utils/format'
import { t } from '@/i18n'

// 转发导出：feature 内既有导入路径不变（SpectrumSection / useAnnotation /
// useRegionComparison / useResultMeta / VizWorkbench 等）；跨 feature 消费者
// （assistant）应直接 import '@/services/zarr/zarrSharedState'
export {
  mzAxisRef,
  dataModeRef,
  rowAxisRef,
  metadataAttrsRef,
  polarityRef,
  meanChartData,
  meanSpectrumRef,
  spectrumLoading,
  spectrumError,
  nMz,
  ticMatrix,
  ticLoading,
  ticError,
  pixelSpectrum,
  pixelSpectrumLoading,
  pixelSpectrumError,
  requestedPixelIndex,
  spectrumView,
  setSpectrumView,
  getSharedZarrContext,
} from '@/services/zarr/zarrSharedState'
export type { SpectrumView, SharedZarrContext } from '@/services/zarr/zarrSharedState'

/**
 * Release all module-level state. Call on VizWorkbench unmount so that large
 * TypedArrays (mzAxis, meanChartData, ticMatrix, pixelSpectrum) and the
 * ZarrOssStore (chunk caches, in-flight requests) become GC-eligible instead
 * of persisting for the entire SPA lifetime.
 */
export function disposeZarrState(): void {
  initGeneration++ // 作废进行中的 init（若有），它会在下个检查点自行清理
  store?.dispose()
  setZarrStore(null)

  ionImageRequestId++
  pixelSpectrumRequestId++
  normalizationRequestId++
  normalizationCache.clear()
  normalizationPending.clear()
  resetZarrSharedState()
  nMz.value = 0
}

// ---- Mean spectrum loading (continuous mode) ----

/**
 * Whether spectra are drawn as profile lines, which keep their zeros (see
 * buildSpectrumChartData). Shared by the mean spectrum and continuous pixel
 * spectra so both views filter the same way.
 */
export function isProfileSpectrum(): boolean {
  const attrs = metadataAttrsRef.value
  return !!attrs?.profile_spectrum && !attrs?.centroid_spectrum
}

/**
 * Load the mean spectrum from stats/mean_spectrum and derive non-zero chart data.
 * Only valid for continuous mode.
 */
export async function loadMeanSpectrum(): Promise<void> {
  const axis = mzAxisRef.value
  if (!store || !axis) return
  if (dataModeRef.value !== 'continuous') return

  spectrumLoading.value = true
  spectrumError.value = null

  try {
    const meanData = await store.loadMeanSpectrum()
    // store 可能在 await 期间被 disposeZarrState() 置空（用户已离开页面）
    if (!store) return
    if (!meanData) {
      spectrumLoading.value = false
      spectrumError.value = t('vizworkbench.spectrum.meanUnavailable')
      return
    }

    nMz.value = axis.length
    // Keep the raw intensity array for O(1) intensity lookup by m/z index
    // (annotation matching). meanChartData below is filtered for charting.
    meanSpectrumRef.value = meanData
    meanChartData.value = buildSpectrumChartData(axis, meanData, isProfileSpectrum())
    spectrumLoading.value = false
  } catch (e) {
    console.error('[useZarrIonImage] loadMeanSpectrum failed:', e)
    spectrumLoading.value = false
    spectrumError.value = e instanceof Error ? e.message : String(e)
  }
}

// ---- TIC image loading (processed mode) ----

export async function loadTICImage(): Promise<void> {
  if (!store) return
  if (dataModeRef.value !== 'processed') return

  ticLoading.value = true
  ticError.value = null

  try {
    // Fast path: use pre-computed stats/tic if available
    const fastMatrix = await store.loadTIC()
    if (!store) return
    if (fastMatrix) {
      ticMatrix.value = fastMatrix
      ticLoading.value = false
      return
    }

    // Fallback: compute TIC by summing all intensity chunks
    const matrix = await store.computeTICImage()
    if (!store) return
    ticMatrix.value = matrix
    ticLoading.value = false
  } catch (e) {
    console.error('[useZarrIonImage] loadTICImage failed:', e)
    ticLoading.value = false
    ticError.value = e instanceof Error ? e.message : String(e)
  }
}

// ---- Per-pixel spectrum loading (both modes) ----

/**
 * Load one pixel's spectrum (continuous: spectra group; processed: main data
 * group) and switch the spectrum panel to the pixel view.
 *
 * 加载期间保留上一条像素谱：谱图区只叠加更新遮罩、不卸载图表，缩放窗口得以保留。
 * 连续点击时只采用最后一次点击的结果，先发出、后返回的旧请求直接丢弃。
 */
export async function loadPixelSpectrum(pixelIndex: number): Promise<void> {
  const requestStore = store
  if (!requestStore) return
  if (
    requestedPixelIndex.value === pixelIndex &&
    pixelSpectrum.value?.pixelIndex === pixelIndex &&
    !pixelSpectrumLoading.value &&
    !pixelSpectrumError.value
  ) {
    spectrumView.value = 'pixel'
    return
  }
  const requestId = ++pixelSpectrumRequestId
  const isCurrent = () => requestId === pixelSpectrumRequestId && store === requestStore

  requestedPixelIndex.value = pixelIndex
  // 点击像素即切到像素谱；请求期间用户仍可切回平均谱，返回时不再强制切换
  spectrumView.value = 'pixel'
  pixelSpectrumLoading.value = true
  pixelSpectrumError.value = null

  try {
    const spectrum = await requestStore.getPixelSpectrum(pixelIndex)
    if (!isCurrent()) return
    if (!spectrum) {
      pixelSpectrum.value = null
      pixelSpectrumError.value = t('vizworkbench.spectrum.pixelEmpty')
      return
    }
    pixelSpectrum.value = spectrum
  } catch (e) {
    if (!isCurrent()) return
    console.error('[useZarrIonImage] loadPixelSpectrum failed:', e)
    // 旧谱已与当前选中的像素不对应：清空，交给错误态 + 重试
    pixelSpectrum.value = null
    pixelSpectrumError.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (isCurrent()) pixelSpectrumLoading.value = false
  }
}

// ---- Helper: find m/z range indices (continuous mode) ----

function findMzRangeIndices(targetIdx: number, tolerance: number): number[] {
  const mzAxis = mzAxisRef.value
  if (!mzAxis) return []
  const target = mzAxis[targetIdx]
  if (target == null) return [targetIdx]

  const lowerMz = target - tolerance
  const upperMz = target + tolerance

  // Lower bound: first axis value >= lowerMz.
  let lo = 0
  let hi = mzAxis.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (mzAxis[mid]! < lowerMz) lo = mid + 1
    else hi = mid
  }
  const start = lo

  // Upper bound: first axis value > upperMz.
  lo = start
  hi = mzAxis.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (mzAxis[mid]! <= upperMz) lo = mid + 1
    else hi = mid
  }
  const end = lo

  if (start >= end) return [targetIdx]
  return Array.from({ length: end - start }, (_, offset) => start + offset)
}

// ---- Helper: load ion image slice sum (continuous mode) ----

async function loadIonSliceSum(indices: number[]): Promise<Float32Array> {
  const s = store
  if (!s) throw new Error('Zarr store is unavailable')
  if (!indices.length) throw new Error('No m/z indices were selected')
  if (!ionDims.value) throw new Error('Ion-image dimensions are unavailable')
  const { width, height } = ionDims.value
  const matrix = await s.getSummedIonImageByMzIndices(indices)
  if (matrix.length !== width * height) {
    throw new Error(`ion matrix size mismatch: expected ${width * height}, got ${matrix.length}`)
  }
  return matrix
}

/**
 * Load one ion image by m/z index WITHOUT touching the single-image state
 * (`ionMatrix` / `selectedMzIndex`). Used by the multi-channel overlay, which
 * keeps its own per-channel matrices.
 *
 * Throws on any failure (missing store, non-continuous data, invalid index,
 * or a store swap while the read was in flight) — callers surface the message
 * on the channel row.
 */
export async function loadIonMatrixByIndex(idx: number, tolerance: number): Promise<Float32Array> {
  if (dataModeRef.value !== 'continuous') {
    throw new Error('Multi-ion overlay is only available for continuous data')
  }
  const requestStore = store
  const axis = mzAxisRef.value
  if (!requestStore || !axis) throw new Error('Zarr store is unavailable')
  if (idx < 0 || idx >= axis.length) throw new Error('Invalid m/z index')
  // 钳位容差到 [min, max]，与 loadForMzIndex 保持一致的语义
  const tol = Math.min(ZARR_STORE.maxMzTolerance, Math.max(ZARR_STORE.minMzTolerance, tolerance))
  const matrix = await loadIonSliceSum(findMzRangeIndices(idx, tol))
  // 读取期间 store 被 dispose/替换（换 run 或离开页面）→ 结果作废
  if (!store || store !== requestStore) throw new Error('Zarr session changed')
  return matrix
}

// ---- Binary search in m/z axis ----

export function findClosestMzIndex(target: number): number {
  const a = mzAxisRef.value
  if (!a || !a.length) return -1
  if (target <= a[0]!) return 0
  const lastIndex = a.length - 1
  if (target >= a[lastIndex]!) return lastIndex

  let lo = 0
  let hi = lastIndex
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (a[mid]! < target) lo = mid + 1
    else hi = mid
  }
  const prev = lo - 1
  return Math.abs(target - a[prev]!) <= Math.abs(a[lo]! - target) ? prev : lo
}

const normalizationCache = new Map<'tic', Float32Array>()
const normalizationPending = new Map<
  'tic',
  { store: ZarrOssStore; promise: Promise<Float32Array> }
>()
let normalizationRequestId = 0
let ionImageRequestId = 0
let pixelSpectrumRequestId = 0
/** init 代次：disposeZarrState() / 每次 init() 递增，用于作废进行中的旧 init。 */
let initGeneration = 0

// ---- Main composable ----

export function useZarrIonImage() {
  // Continuous mode state
  const selectedMzIndex = ref(0)
  const mzTolerance = ref<number>(ZARR_STORE.defaultMzTolerance)
  const ionMatrix = ref<Float32Array | null>(null)
  const normalizationFactors = shallowRef<Float32Array | null>(null)
  const normalizationLoading = ref(false)
  const normalizationError = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const ready = ref(false)

  // Computed
  const ionCols = computed(() => ionDims.value?.width ?? 0)
  const ionRows = computed(() => ionDims.value?.height ?? 0)
  const totalPeaks = computed(() => (mzAxisRef.value ? formatNumber(mzAxisRef.value.length) : '--'))

  const isContinuous = computed(() => dataModeRef.value === 'continuous')
  const isProcessed = computed(() => dataModeRef.value === 'processed')

  /** zarr 是否预存 stats/tic（TIC 归一化的唯一数据源，ready 后才有值） */
  const hasTic = computed(() => (ready.value ? !!store?.hasTIC : false))

  // selectedMz is DERIVED from selectedMzIndex + mzAxis — never written directly
  const selectedMz = computed(() => {
    const axis = mzAxisRef.value
    const idx = selectedMzIndex.value
    if (!axis || idx < 0 || idx >= axis.length) return 0
    return axis[idx]!
  })

  // ---- Continuous mode: load ion image for a given m/z index ----

  const loadForMzIndex = async (idx: number) => {
    if (!mzAxisRef.value || !ready.value || idx < 0 || idx >= mzAxisRef.value.length) return
    if (dataModeRef.value !== 'continuous') return
    const requestId = ++ionImageRequestId
    const requestStore = store
    loading.value = true
    error.value = null
    selectedMzIndex.value = idx
    // 钳位容差到 [min, max]，防止外部传入越界值导致空区间或全表扫描
    const tol = Math.min(
      ZARR_STORE.maxMzTolerance,
      Math.max(ZARR_STORE.minMzTolerance, mzTolerance.value),
    )
    try {
      const matrix = await loadIonSliceSum(findMzRangeIndices(idx, tol))
      // Ignore a stale response after another peak/run has been selected.
      if (requestId !== ionImageRequestId || store !== requestStore) return
      ionMatrix.value = matrix
    } catch (e) {
      if (requestId !== ionImageRequestId || store !== requestStore) return
      // UI 只说「什么问题」，底层原因留在控制台
      error.value = t('vizworkbench.ionImage.updateFailed')
      console.error('[useZarrIonImage] loadForMzIndex failed:', e)
    } finally {
      if (requestId === ionImageRequestId) loading.value = false
    }
  }

  const loadNormalization = async (mode: 'tic') => {
    if (!store || !ready.value) return
    const requestId = ++normalizationRequestId
    const requestStore = store
    normalizationFactors.value = null
    const cached = normalizationCache.get(mode)
    if (cached) {
      if (requestId === normalizationRequestId && store === requestStore) {
        normalizationFactors.value = cached
      }
      return
    }
    normalizationLoading.value = true
    normalizationError.value = null
    try {
      const pending = normalizationPending.get(mode)
      let promise = pending && pending.store === requestStore ? pending.promise : null
      if (!promise) {
        // 归一化因子只来自 zarr 预存的 stats/tic 矩阵（一个小数组请求），
        // 不在前端扫描 intensity；旧数据没有 stats/tic 时直接报错。
        // TIC：x / TIC[p]。
        // （RMS 归一化暂未提供：真·RMS（√(ΣI²/N)）无法从 ΣI 还原，
        //  等后端存了逐像素 RMS/平方和矩阵再加。）
        const computeFactors = async () => {
          const tic = await requestStore.loadTIC()
          if (!tic) throw new Error('This dataset has no pre-computed TIC (stats/tic)')
          return tic
        }
        promise = computeFactors()
        const trackedPromise = promise.finally(() => {
          if (normalizationPending.get(mode)?.promise === trackedPromise) {
            normalizationPending.delete(mode)
          }
        })
        normalizationPending.set(mode, { store: requestStore, promise: trackedPromise })
      }
      const factors = await promise
      if (store !== requestStore) return
      normalizationCache.set(mode, factors)
      // The computation is independent of the selected m/z. If the user switched
      // back to Linear while it was running, keep the cache but don't re-apply it.
      if (requestId !== normalizationRequestId) return
      normalizationFactors.value = factors
    } catch (e) {
      if (store !== requestStore) return
      // 「旧数据没有预计算 TIC」是用户可懂的原因，单独说明；其余统一一句话
      normalizationError.value =
        e instanceof Error && e.message.includes('no pre-computed TIC')
          ? t('vizworkbench.ionImage.noTic')
          : t('vizworkbench.ionImage.loadFailed')
      if (requestId !== normalizationRequestId) return
      normalizationFactors.value = null
    } finally {
      if (requestId === normalizationRequestId) normalizationLoading.value = false
    }
  }
  const clearNormalization = () => {
    normalizationRequestId++
    normalizationFactors.value = null
    normalizationError.value = null
    normalizationLoading.value = false
  }

  const onSpectrumClickByIndex = async (idx: number) => {
    if (!mzAxisRef.value || !ready.value) return
    if (idx < 0 || idx >= mzAxisRef.value.length) return
    await loadForMzIndex(idx)
  }

  const loadDefaultImage = async () => {
    const axis = mzAxisRef.value
    if (!axis?.length || !ready.value) return
    const idx = Math.floor(axis.length / 2)
    await loadForMzIndex(idx)
  }

  // ---- Tolerance change → reload current ion image ----
  // 输入框每按一次键都会触发 update:mzTolerance，因此做 300ms 防抖，
  // 避免连续请求 OSS chunk。防抖后仅重载当前 m/z，保持当前强度标度。
  let toleranceTimer: ReturnType<typeof setTimeout> | null = null
  watch(mzTolerance, () => {
    if (!ready.value || dataModeRef.value !== 'continuous') return
    if (selectedMzIndex.value < 0) return
    if (toleranceTimer) clearTimeout(toleranceTimer)
    toleranceTimer = setTimeout(() => {
      loadForMzIndex(selectedMzIndex.value)
    }, 300)
  })

  onBeforeUnmount(() => {
    if (toleranceTimer) {
      clearTimeout(toleranceTimer)
      toleranceTimer = null
    }
  })

  // ---- Initialization ----

  const init = async (runId: string) => {
    if (!runId) return
    loading.value = true
    error.value = null
    ready.value = false

    // Reset all state. Bumping initGeneration first invalidates any init still
    // in flight: it will abort at its next checkpoint and dispose its own
    // orphaned store (it must NOT touch the new session's store).
    const gen = ++initGeneration
    store?.dispose()
    setZarrStore(null)
    ionImageRequestId++
    pixelSpectrumRequestId++
    normalizationRequestId++
    normalizationCache.clear()
    normalizationPending.clear()
    normalizationFactors.value = null
    normalizationError.value = null
    ionMatrix.value = null
    resetZarrSharedState()

    /** True while this init is still the latest lifecycle (no dispose/re-init since). */
    const isCurrent = () => gen === initGeneration
    /** Abort this stale init: dispose the store we created (it is no longer
     *  reachable via the module-level `store`) and stop writing shared refs. */
    const abortIfStale = (s: ZarrOssStore): boolean => {
      if (isCurrent() && store === s) return false
      s.dispose()
      return true
    }

    try {
      // spectra 读取的缓存/并发走运行时 config.json 的 zarr 块（缺省 100MB/16）
      const zarrCfg = getConfig().zarr
      const s = new ZarrOssStore(await getZarrAccess(runId), {
        intensityChunkCacheSize: ZARR_STORE.intensityChunkCacheSize,
        spectraChunkCacheSize: zarrCfg?.spectraChunkCacheSize,
        spectraConcurrency: zarrCfg?.spectraConcurrency,
        // STS 过期时自动重拉凭据，避免结果页久置后所有 OSS 读取 403
        refreshAccess: () => getZarrAccess(runId),
      })
      // 如果 await getZarrAccess 期间发生了 dispose/重新 init，直接放弃本次加载
      if (!isCurrent()) {
        s.dispose()
        return
      }
      setZarrStore(s)
      await s.init()
      // 如果 await 期间发生了 disposeZarrState()（用户离开页面）或重新 init()，放弃本次加载
      if (abortIfStale(s)) return

      // Set mode and row axis
      dataModeRef.value = s.dataMode
      rowAxisRef.value = s.rowAxis
      metadataAttrsRef.value = s.metadataAttrs

      // Set spatial dimensions
      const [height, width] = s.spatialShape
      ionDims.value = { width, height }

      if (s.dataMode === 'continuous') {
        // Load shared m/z axis
        const mzAxis = await s.loadMzAxis()
        if (abortIfStale(s)) return
        if (!mzAxis) throw new Error('[useZarrIonImage] continuous data is missing its m/z axis')
        mzAxisRef.value = mzAxis

        // Set ion shape for backward compat
        const shape = s.getIonShape()
        if (shape) {
          ionDims.value = { width: shape[2]!, height: shape[1]! }
        }

        ready.value = true
        await loadDefaultImage()
        if (abortIfStale(s)) return
        loadMeanSpectrum() // background
      } else {
        // Processed mode: load TIC image
        ready.value = true
        await loadTICImage()
      }
    } catch (e) {
      if (!isCurrent()) return // 本次会话已被 dispose/替换，错误不必再呈现
      console.error('[useZarrIonImage] init failed:', e)
      // v1.0 等不再支持的布局：给出本地化的「格式不兼容」提示，而不是底层读取错误；
      // 其余失败只报一句话，原因进控制台
      error.value =
        e instanceof ZarrIncompatibleError
          ? t('vizworkbench.ionImage.incompatibleFormat')
          : t('vizworkbench.ionImage.loadFailed')
    } finally {
      if (isCurrent()) loading.value = false
    }
  }

  return {
    // Common
    selectedMzIndex,
    selectedMz,
    mzTolerance,
    ionMatrix,
    ionCols,
    ionRows,
    totalPeaks,
    isContinuous,
    isProcessed,
    loading,
    error,
    ready,
    init,

    // Continuous mode
    onSpectrumClickByIndex,
    loadForMzIndex,
    loadNormalization,
    clearNormalization,
    normalizationFactors,
    normalizationLoading,
    normalizationError,
    hasTic,
  }
}

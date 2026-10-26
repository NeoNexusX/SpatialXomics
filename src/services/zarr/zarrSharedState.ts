/**
 * Zarr 共享状态（services 层的跨 feature API）。
 *
 * 原 vizworkbench useZarrIonImage 的模块级状态：可视化工作台写入，
 * assistant（analysisContext 的 agent 上下文工具）等跨 feature 只读消费。
 * 按 docs/dev/前端架构边界.md 的规则——跨模块复用的状态收在 services 层；
 * feature 内部消费者仍从 useZarrIonImage 的转发导出导入，路径不变。
 *
 * ⚠️ 模块级单例：约 20 个状态挂在模块作用域，由可视化工作台独占使用。
 * 路由是单实例（/viz 组件复用 + onUnmounted dispose），因此成立；
 * 但切勿同时挂载两个消费者（KeepAlive 多实例、第二页签组件）。
 * 生命周期竞态由 useZarrIonImage 的 initGeneration 代次守卫。
 */

import { ref, shallowRef } from 'vue'
import type { ZarrOssStore } from './zarrOssStore'
import type { MetadataAttrs, DataMode, PixelSpectrum } from './types/zarr'

// ---- Module-level shared state ----

/**
 * Zarr store 实例。useZarrIonImage 在 init/dispose 时经 {@link setZarrStore} 维护；
 * 经 import 活绑定读取的代码始终拿到当前实例。
 */
export let store: ZarrOssStore | null = null

/** 替换 store 实例（init 建新会话 / dispose 释放）；旧实例的 dispose 由调用方负责 */
export function setZarrStore(next: ZarrOssStore | null): void {
  store = next
}

/** Shared m/z axis (Float64Array). Only populated for continuous mode. */
export const mzAxisRef = shallowRef<Float64Array | null>(null)

/** Ion image dimensions { width, height } */
export const ionDims = shallowRef<{ width: number; height: number } | null>(null)

/** Data mode: 'continuous' or 'processed' */
export const dataModeRef = shallowRef<DataMode | null>(null)

/** Row axis: 'pixel' or 'ion' */
export const rowAxisRef = shallowRef<'pixel' | 'ion' | null>(null)

/** Metadata from /metadata/.zattrs */
export const metadataAttrsRef = shallowRef<MetadataAttrs | null>(null)

/** Result polarity (e.g. 'positive'/'negative'). Written by useResultMeta
 *  (zarr metadata attrs first, source-file record as fallback). Shared so the
 *  AI assistant can read it directly like {@link mzAxisRef}. */
export const polarityRef = ref('')

// ---- Mean spectrum state (continuous mode) ----

export const meanChartData = shallowRef<[number, number][]>([])
/** Raw mean-spectrum intensities aligned with {@link mzAxisRef}. Unlike
 *  {@link meanChartData} (which drops zero/NaN points for charting), this is
 *  the unfiltered array, for per-peak intensity lookup. */
export const meanSpectrumRef = shallowRef<Float32Array | null>(null)
export const spectrumLoading = ref(false)
export const spectrumError = ref<string | null>(null)
export const nMz = ref(0)

// ---- TIC image state (processed mode) ----

export const ticMatrix = shallowRef<Float32Array | null>(null)
export const ticLoading = ref(false)
export const ticError = ref<string | null>(null)

// ---- Per-pixel spectrum state (both modes) ----

/** 当前显示的像素谱。加载下一个像素期间保留旧谱，加载失败时清空 */
export const pixelSpectrum = shallowRef<PixelSpectrum | null>(null)

export const pixelSpectrumLoading = ref(false)
export const pixelSpectrumError = ref<string | null>(null)

/** 最近一次点击的像素索引（null = 本次会话还没选过像素），失败重试沿用它 */
export const requestedPixelIndex = ref<number | null>(null)

/** continuous 模式谱图区显示平均谱还是像素谱；processed 只有像素谱，不读它 */
export type SpectrumView = 'mean' | 'pixel'
export const spectrumView = ref<SpectrumView>('mean')

/**
 * 切换谱图视图。还没选过像素时没有像素谱可看，忽略切到 'pixel' 的请求
 * （界面上对应按钮也是禁用的）。
 */
export function setSpectrumView(view: SpectrumView): void {
  if (view === 'pixel' && requestedPixelIndex.value === null) return
  spectrumView.value = view
}

// ---- Shared context snapshot ----

export interface SharedZarrContext {
  store: ZarrOssStore | null
  mzAxis: Float64Array | null
  ionShape: { width: number; height: number } | null
  dataMode: DataMode | null
  rowAxis: 'pixel' | 'ion' | null
  meanChartData: [number, number][]
  spectrumLoading: boolean
  spectrumError: string | null
  nMz: number
  ticMatrix: Float32Array | null
  pixelSpectrum: typeof pixelSpectrum.value
}

export function getSharedZarrContext(): SharedZarrContext {
  return {
    store,
    mzAxis: mzAxisRef.value,
    ionShape: ionDims.value,
    dataMode: dataModeRef.value,
    rowAxis: rowAxisRef.value,
    meanChartData: meanChartData.value,
    spectrumLoading: spectrumLoading.value,
    spectrumError: spectrumError.value,
    nMz: nMz.value,
    ticMatrix: ticMatrix.value,
    pixelSpectrum: pixelSpectrum.value,
  }
}

/**
 * Reset the module-level refs (no store disposal — callers handle the store).
 * Shared by useZarrIonImage's disposeZarrState() and init() reset block.
 */
export function resetZarrSharedState(): void {
  mzAxisRef.value = null
  ionDims.value = null
  dataModeRef.value = null
  rowAxisRef.value = null
  metadataAttrsRef.value = null
  polarityRef.value = ''

  meanChartData.value = []
  meanSpectrumRef.value = null
  spectrumLoading.value = false
  spectrumError.value = null

  ticMatrix.value = null
  ticLoading.value = false
  ticError.value = null

  pixelSpectrum.value = null
  pixelSpectrumLoading.value = false
  pixelSpectrumError.value = null
  requestedPixelIndex.value = null
  spectrumView.value = 'mean'
}

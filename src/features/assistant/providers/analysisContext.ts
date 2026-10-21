/**
 * 分析上下文采集器（provider 注册表 + 各细分 get_* 工具的实现体）。
 *
 * 复用 services/zarr/zarrSharedState 的模块级共享状态（getSharedZarrContext /
 * metadataAttrsRef / polarityRef / pixelSpectrum），禁止调 useZarrIonImage()
 * 创建失步实例。
 *
 * 实例级数据（selectedIon / kmeans / annotations）由 VizWorkbench.vue 和注释面板
 * （useAnnotation）通过 registerContextProviders / unregisterContextProviders 注入。
 */

import {
  getSharedZarrContext,
  metadataAttrsRef,
  polarityRef,
  pixelSpectrum,
} from '@/services/zarr/zarrSharedState'
import type {
  DatasetOverview,
  IonImageStats,
  SpectrumPeak,
  KmeansSummary,
  UmapSummary,
  AnnotationRow,
  AnnotationScoreWeights,
  PageState,
} from '../agenttypes/assistant'
import { STATS_SAMPLE_PIXELS } from '../agentconfig/defaults'

// ---- 实例级数据 provider 注册表 ----

export interface AnalysisContextProviders {
  selectedIon?: () => {
    mz: number
    tolerance: number
    matrix: Float32Array
    width: number
    height: number
  } | null
  kmeans?: () => {
    k: number
    clusterSizes: number[]
    selectedIds: number[]
  } | null
  /**
   * 注释行（一行 = 一个加合离子，空间分随后台评分逐步补全）。rows 按需构建：
   * 每次发送都要的页面状态只读 count，不必把全部行展开一遍。weights 为本次运行的
   * 总分权重（已归一化，用户可在注释条件里调）。
   */
  annotations?: () => {
    count: number
    rows: () => AnnotationRow[]
    weights?: AnnotationScoreWeights
  } | null
  /** UMAP 降维/聚类任务状态与栅格概要（不含逐点 embedding——量大且 LLM 用不上） */
  umap?: () => {
    ready: boolean
    visible: boolean
    computing: boolean
    error: string | null
    grid: { width: number; height: number }
  } | null
}

let providers: AnalysisContextProviders = {}

/**
 * 注册实例级数据 provider（合并语义：多个组件各注册自己的键，互不覆盖）。
 * 由 VizWorkbench / 注释面板的 setup 调用；getter 均为惰性取值。
 */
export function registerContextProviders(p: AnalysisContextProviders): void {
  providers = { ...providers, ...p }
}

/**
 * 注销 provider。
 * 不传 keys 时清空全部（ResultDetail 卸载时用）；
 * 只传自身键时仅移除对应项（注释面板卸载时用，避免误清其他组件的注册）。
 */
export function unregisterContextProviders(keys?: (keyof AnalysisContextProviders)[]): void {
  if (!keys) {
    providers = {}
    return
  }
  const next = { ...providers }
  for (const k of keys) delete next[k]
  providers = next
}

/** 全部注释行（get_annotation_detail 工具用）；注释面板还没有结果时为 null */
export function getAnnotationRows(): AnnotationRow[] | null {
  return providers.annotations?.()?.rows() ?? null
}

/** 当前注释结果的总分权重；没有结果或 provider 没给时为 null */
export function getAnnotationWeights(): AnnotationScoreWeights | null {
  return providers.annotations?.()?.weights ?? null
}

// ---- 数据集段构建 ----

export function buildDatasetOverview(): DatasetOverview | undefined {
  const shared = getSharedZarrContext()
  const attrs = metadataAttrsRef.value

  if (!shared.dataMode || !shared.ionShape) return undefined

  const overview: DatasetOverview = {
    dataMode: shared.dataMode,
    width: shared.ionShape.width,
    height: shared.ionShape.height,
    rowAxis: shared.rowAxis ?? undefined,
    name: attrs?.name,
    filename: attrs?.filename,
    pixelCount: attrs?.spectrum_count_num,
    pixelSizeHorizontal: attrs?.pixel_size_horizontal,
    pixelSizeVertical: attrs?.pixel_size_vertical,
    analyzer: attrs?.analyzer,
    ionisationSource: attrs?.ionisation_source,
    polarity: polarityRef.value || attrs?.polarity,
  }

  // continuous 模式：补充 m/z 轴信息
  if (shared.dataMode === 'continuous' && shared.mzAxis) {
    overview.mzMin = shared.mzAxis[0]
    overview.mzMax = shared.mzAxis[shared.mzAxis.length - 1]
    overview.mzCount = shared.mzAxis.length
  }

  return overview
}

// ---- 离子图段构建 ----

export function buildIonImageStats(): IonImageStats | undefined {
  const ion = providers.selectedIon?.()
  if (!ion) return undefined

  const { matrix, width, height } = ion
  const total = width * height
  let max = -Infinity
  let min = Infinity
  let sum = 0
  let nonzero = 0

  for (let i = 0; i < total; i++) {
    const v = matrix[i] ?? 0
    if (v > max) max = v
    if (v < min) min = v
    if (v !== 0) {
      sum += v
      nonzero++
    }
  }

  const mean = nonzero > 0 ? sum / nonzero : 0
  const nonzeroRatio = nonzero / total

  // 热点：找最大的 3 个
  const hotspots: { x: number; y: number; intensity: number }[] = []
  const top3 = new Array<{ idx: number; val: number }>(3)
  for (let i = 0; i < 3; i++) top3[i] = { idx: -1, val: -Infinity }
  for (let i = 0; i < total; i++) {
    const v = matrix[i] ?? 0
    for (let j = 0; j < 3; j++) {
      if (v > top3[j]!.val) {
        top3.splice(j, 0, { idx: i, val: v })
        top3.pop()
        break
      }
    }
  }
  for (const t of top3) {
    if (t.idx >= 0) {
      hotspots.push({ x: t.idx % width, y: Math.floor(t.idx / width), intensity: t.val })
    }
  }

  // 分位数：等距抽样排序
  const step = Math.max(1, Math.floor(total / STATS_SAMPLE_PIXELS))
  const sampled: number[] = []
  for (let i = 0; i < total; i += step) {
    sampled.push(matrix[i] ?? 0)
  }
  sampled.sort((a, b) => a - b)
  const pct = (p: number): number => sampled[Math.floor((sampled.length * p) / 100)] ?? 0

  return {
    mz: ion.mz,
    tolerance: ion.tolerance,
    max,
    mean,
    min,
    nonzeroRatio,
    p50: pct(50),
    p90: pct(90),
    p99: pct(99),
    hotspots,
  }
}

// ---- 平均谱 top 峰 ----

export function buildMeanSpectrumTopPeaks(topN: number = 10): SpectrumPeak[] {
  const shared = getSharedZarrContext()
  if (!shared.mzAxis || !shared.meanChartData || shared.meanChartData.length === 0) {
    return []
  }

  // meanChartData 已是 [mz, intensity] 对且已过滤零值
  const peaks = shared.meanChartData
    .map(([mz, intensity]) => ({ mz, intensity }))
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, Math.min(topN, 20))

  return peaks
}

// ---- KMeans 段 ----

export function buildKmeansSummary(): KmeansSummary | undefined {
  const kmeans = providers.kmeans?.()
  if (!kmeans) return undefined
  return {
    k: kmeans.k,
    clusterSizes: kmeans.clusterSizes,
    selectedIds: kmeans.selectedIds,
  }
}

// ---- UMAP 段 ----

export function buildUmapSummary(): UmapSummary | undefined {
  const umap = providers.umap?.()
  if (!umap) return undefined
  return umap
}

// ---- 单像素谱段 ----

/** 当前已加载的单像素谱 top 峰摘要（NaN 过滤，强度降序取 topN）。
 *  谱的**加载**是页面交互（点像素）驱动的，agent 只读当前已有的谱。 */
export function buildPixelSpectrumPeaks(
  topN = 10,
): { pixel: { index: number; x: number; y: number }; peaks: SpectrumPeak[] } | undefined {
  const ps = pixelSpectrum.value
  if (!ps || ps.intensity.length === 0) return undefined

  const total = ps.intensity.length
  // 单遍 top-K（K≤20）：continuous 模式整谱可达 1e5+ 点，全量排序会卡主线程
  const k = Math.min(topN, 20)
  const top: number[] = [] // 谱点索引，按强度降序维护
  for (let i = 0; i < total; i++) {
    const v = ps.intensity[i]!
    if (!Number.isFinite(v) || v <= 0) continue
    if (top.length === k && v <= ps.intensity[top[k - 1]!]!) continue
    let pos = top.length
    while (pos > 0 && ps.intensity[top[pos - 1]!]! < v) pos--
    top.splice(pos, 0, i)
    if (top.length > k) top.pop()
  }
  if (top.length === 0) return undefined

  const peaks = top.map((i) => ({ mz: ps.mz[i]!, intensity: ps.intensity[i]! }))

  return { pixel: { index: ps.pixelIndex, x: ps.x, y: ps.y }, peaks }
}

// ---- 注释段 ----

/** 按总分排名的前 topN 行（最多 20） */
export function buildAnnotationTop(topN: number = 10): AnnotationRow[] {
  const rows = getAnnotationRows()
  if (!rows) return []
  return [...rows].sort((a, b) => a.rank - b.rank).slice(0, Math.min(topN, 20))
}

// ---- 汇总 ----

/**
 * 页面实时状态汇总（get_page_state 工具的数据源）。
 *
 * 只读 provider 的直接字段与共享 ref，**不做任何重统计**（矩阵遍历/排序），
 * 可安全地在每次工具调用时实时求值。重统计（分位数/热点/top 峰/注释明细）
 * 由各细分 get_* 工具按需承担。
 */
export function buildPageState(): PageState {
  const state: PageState = {}

  const dataset = buildDatasetOverview()
  if (dataset) state.dataset = dataset

  const ion = providers.selectedIon?.()
  if (ion) state.selectedIon = { mz: ion.mz, tolerance: ion.tolerance }

  const kmeans = providers.kmeans?.()
  if (kmeans) {
    state.kmeans = {
      k: kmeans.k,
      clusterCount: kmeans.clusterSizes.length,
      selectedCount: kmeans.selectedIds.length,
    }
  }

  const umap = providers.umap?.()
  if (umap) {
    state.umap = { ready: umap.ready, computing: umap.computing }
  }

  const annotations = providers.annotations?.()
  if (annotations) state.annotationCount = annotations.count

  const shared = getSharedZarrContext()
  state.meanSpectrumAvailable = !!(shared.meanChartData && shared.meanChartData.length > 0)

  return state
}

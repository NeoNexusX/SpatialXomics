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

import type { PixelSpectrum } from '@/services/zarr/types/zarr'
import {
  getSharedZarrContext,
  metadataAttrsRef,
  polarityRef,
  pixelSpectrum,
  meanSpectrumRef,
  mzAxisRef,
} from '@/services/zarr/zarrSharedState'
import type {
  AnnotationPanelState,
  AnnotationRow,
  AnnotationScoreWeights,
  DatasetInfo,
  DatasetOverview,
  IonImageStats,
  IonView,
  KmeansClusterView,
  PageState,
  RankWindow,
  SpectrumPeak,
  UmapSummary,
} from './analysisTypes'
import { rankWindowMeta } from './analysisTypes'

/** 大矩阵统计采样像素数（等距抽样后排序取分位数） */
const STATS_SAMPLE_PIXELS = 10000

// ---- 实例级数据 provider 注册表 ----

export interface AnalysisContextProviders {
  selectedIon?: () => {
    mz: number
    tolerance: number
    matrix: Float32Array
    width: number
    height: number
    /** get_ion 的显示参数/谱图区/通道列表/ROI 段（VizWorkbench 注入） */
    view?: IonView
  } | null
  kmeans?: () => {
    k: number | null
    clusterSizes: number[]
    selectedIds: number[]
    /** KMeans 完整视图（簇颜色/labels 可用性/computing/visible）与栅格 */
    view?: {
      clusters: KmeansClusterView[]
      labelsAvailable: boolean
      computing: boolean
      visible: boolean
      labels: () => Int32Array | null
      rgb: () => Uint8Array | null
      dims: () => { width: number; height: number } | null
    }
  } | null
  /**
   * 注释行（一行 = 一个加合离子，空间分随后台评分逐步补全）。rows 按需构建：
   * 每次发送都要的页面状态只读 count，不必把全部行展开一遍。weights 为本次运行的
   * 总分权重（已归一化，用户可在注释条件里调）。panel 为 get_annotation 的
   * 面板状态头与全量行（rank 升序稳定排序的分页口径读它，与表格筛选解耦）。
   */
  annotations?: () => {
    count: number
    rows: () => AnnotationRow[]
    weights?: AnnotationScoreWeights
    panel?: () => Omit<AnnotationPanelState, 'rows'> | null
    panelRows?: () => AnnotationRow[] | null
  } | null
  /** UMAP 降维/聚类任务状态与栅格概要（不含逐点 embedding——量大且 LLM 用不上） */
  umap?: () => {
    ready: boolean
    visible: boolean
    computing: boolean
    error: string | null
    grid: { width: number; height: number }
    /** UMAP 栅格与占用掩膜（get_umap 附图用；occupancy 独立于 RGB 颜色） */
    rgb?: () => Uint8Array | null
    occupancyMask?: () => Uint8Array | null
  } | null
  /** 右侧数据集信息面板整体（get_dataset / get_page.dataset 用） */
  datasetInfo?: () => DatasetInfo | null
  /** 页头状态徽章（get_page.header 用；get_dataset 不含） */
  pageHeader?: () => { datasetName: string; status: string } | null
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

/** 全部注释行（get_annotation 精确查询与 tool-kegg 排名工具用）；注释面板还没有结果时为 null */
export function getAnnotationRows(): AnnotationRow[] | null {
  return providers.annotations?.()?.rows() ?? null
}

/** 当前注释结果的总分权重；没有结果或 provider 没给时为 null */
export function getAnnotationWeights(): AnnotationScoreWeights | null {
  return providers.annotations?.()?.weights ?? null
}

/** Capture identities only, without copying matrices or expanding annotation rows. */
export function buildAnalysisSelection() {
  const pixel = pixelSpectrum.value
  return {
    clusters: [...(providers.kmeans?.()?.selectedIds ?? [])],
    kmeansK: providers.kmeans?.()?.k,
    pixel: pixel ? { index: pixel.pixelIndex, x: pixel.x, y: pixel.y } : undefined,
    annotationWeights: providers.annotations?.()?.weights,
  }
}

// ---- 数据集段构建 ----

export function buildDatasetOverview(): DatasetOverview | undefined {
  const shared = getSharedZarrContext()
  const attrs = metadataAttrsRef.value

  if (!shared.dataMode || !shared.ionShape) return undefined

  // 极性展示归一：识别 +/pos/大小写等写法；无法识别保留原文（ref 优先，回退 metadata）
  const rawPolarity = polarityRef.value || attrs?.polarity

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
    polarity: normalizePolarityValue(rawPolarity) ?? rawPolarity,
  }

  // continuous 模式：补充 m/z 轴信息（首尾取 min/max：轴约定升序，防降序数据出现 mzMin > mzMax）
  const mzAxis = shared.mzAxis
  if (shared.dataMode === 'continuous' && mzAxis?.length) {
    const first = mzAxis[0]!
    const last = mzAxis[mzAxis.length - 1]!
    overview.mzMin = Math.min(first, last)
    overview.mzMax = Math.max(first, last)
    overview.mzCount = mzAxis.length
  }

  return overview
}

// ---- 离子图段构建 ----

export function getSelectedIon() {
  return providers.selectedIon?.() ?? null
}

export function buildIonImageStats(ion = getSelectedIon()): IonImageStats | undefined {
  if (!ion) return undefined

  const { matrix, width, height } = ion
  const total = width * height
  if (!Number.isSafeInteger(total) || total <= 0 || matrix.length !== total) return undefined
  let max = -Infinity
  let min = Infinity
  let sum = 0
  let nonzero = 0

  for (let i = 0; i < total; i++) {
    const v = Number.isFinite(matrix[i]) ? matrix[i]! : 0
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
    const v = Number.isFinite(matrix[i]) ? matrix[i]! : 0
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
  const step = Math.max(1, Math.ceil(total / STATS_SAMPLE_PIXELS))
  const sampled: number[] = []
  for (let i = 0; i < total; i += step) {
    sampled.push(Number.isFinite(matrix[i]) ? matrix[i]! : 0)
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

// ---- 平均谱 top 峰（任意 rank 窗口） ----

export function buildMeanSpectrumTopPeaks(
  topN = 10,
  mzMin = -Infinity,
  mzMax = Infinity,
): SpectrumPeak[] {
  const axis = mzAxisRef.value
  const intensity = meanSpectrumRef.value
  if (!axis || !intensity) return []
  return computeSpectrumTopPeaks(axis, intensity, topN, mzMin, mzMax)
}

/**
 * 平均谱峰的任意 rank 窗口（决策 7）：先对完整平均谱按强度降序排名，再按
 * 零基 offset/limit 切连续窗口。绝不能先截前 N 再切片——rank 20–30 必须可达。
 */
export function buildMeanSpectrumPeakWindow(
  offset: number,
  limit: number,
  mzMin = -Infinity,
  mzMax = Infinity,
): { window: RankWindow; peaks: SpectrumPeak[] } {
  const axis = mzAxisRef.value
  const intensity = meanSpectrumRef.value
  if (!axis || !intensity) {
    return { window: rankWindowMeta(0, offset, limit, 0), peaks: [] }
  }
  // 完整降序排名（不受 top-20 内部 cap 限制——offset 需要到达任意 rank）
  const all = computeAllSpectrumPeaks(axis, intensity, mzMin, mzMax)
  const total = all.length
  const start = Math.min(offset, total)
  const end = Math.min(start + limit, total)
  const peaks = all.slice(start, end)
  return { window: rankWindowMeta(total, offset, limit, peaks.length), peaks }
}

// ---- KMeans 段 ----

/** KMeans 完整状态（get_kmeans）：簇带颜色，view 缺省时退化为概要。 */
export function buildKmeansState():
  | {
      k: number | null
      clusters: KmeansClusterView[]
      selectedIds: number[]
      labelsAvailable: boolean
      computing: boolean
      visible: boolean
    }
  | undefined {
  const p = providers.kmeans?.()
  if (!p) return undefined
  if (p.view) {
    return {
      k: p.k,
      clusters: p.view.clusters,
      selectedIds: p.selectedIds,
      labelsAvailable: p.view.labelsAvailable,
      computing: p.view.computing,
      visible: p.view.visible,
    }
  }
  return {
    k: p.k,
    clusters: p.clusterSizes.map((count, id) => ({ id, color: [0, 0, 0] as [number, number, number], count })),
    selectedIds: p.selectedIds,
    labelsAvailable: p.clusterSizes.length > 0,
    computing: false,
    visible: false,
  }
}

/** KMeans raster inputs for the optional transparent overlay attachment. */
export function getKmeansOverlayData() {
  const p = providers.kmeans?.()
  const view = p?.view
  if (!view) return undefined
  const rgb = view.rgb()
  const labels = view.labels()
  const dims = view.dims()
  if (!rgb || !labels || !dims) return undefined
  return { rgb, labels, dims, visibleIds: new Set(p!.selectedIds) }
}

/** UMAP raster inputs for the optional transparent overlay attachment. */
export function getUmapOverlayData() {
  const p = providers.umap?.()
  if (!p?.rgb || !p.occupancyMask) return undefined
  const rgb = p.rgb()
  const occupancy = p.occupancyMask()
  if (!rgb || !occupancy) return undefined
  return { rgb, occupancy, dims: p.grid }
}

// ---- UMAP 段 ----

/** UMAP 完整状态（get_umap）：含栅格访问器（附图用）。 */
export function buildUmapState(): UmapSummary | undefined {
  return providers.umap?.() ?? undefined
}

// ---- 单像素谱段（任意 rank 窗口） ----

/** 当前已加载的单像素谱 top 峰摘要（NaN 过滤，强度降序取 topN）。
 *  谱的**加载**是页面交互（点像素）驱动的，agent 只读当前已有的谱。 */
export function buildPixelSpectrumPeaks(
  topN = 10,
  ps: PixelSpectrum | null = pixelSpectrum.value,
): { pixel: { index: number; x: number; y: number }; peaks: SpectrumPeak[] } | undefined {
  if (!ps || ps.intensity.length === 0) return undefined

  const peaks = computeSpectrumTopPeaks(ps.mz, ps.intensity, topN)
  if (!peaks.length) return undefined
  return { pixel: { index: ps.pixelIndex, x: ps.x, y: ps.y }, peaks }
}

/** 只读访问当前已加载的单像素全谱（get_pixel_spectrum 附图用；不动窗口 builder）。 */
export function getLoadedPixelSpectrum(): PixelSpectrum | null {
  return pixelSpectrum.value
}

/** 单像素全谱峰（降序，无 cap）：显式像素与末次点击两条附图路径共用。 */
export function buildPixelSpectrumAllPeaks(ps: PixelSpectrum | null): SpectrumPeak[] {
  if (!ps || ps.intensity.length === 0) return []
  return computeAllSpectrumPeaks(ps.mz, ps.intensity)
}

/** 单像素谱峰的任意 rank 窗口（决策 7）：完整降序排名后按 offset/limit 切片。 */
export function buildPixelSpectrumPeakWindow(
  offset: number,
  limit: number,
  ps: PixelSpectrum | null = pixelSpectrum.value,
): { pixel: { index: number; x: number; y: number }; window: RankWindow; peaks: SpectrumPeak[] } | undefined {
  if (!ps || ps.intensity.length === 0) return undefined
  // 完整降序排名（不受 top-20 内部 cap 限制——offset 需要到达任意 rank）
  const all = computeAllSpectrumPeaks(ps.mz, ps.intensity)
  if (!all.length) return undefined
  const start = Math.min(offset, all.length)
  const peaks = all.slice(start, Math.min(start + limit, all.length))
  return {
    pixel: { index: ps.pixelIndex, x: ps.x, y: ps.y },
    window: rankWindowMeta(all.length, offset, limit, peaks.length),
    peaks,
  }
}

function computeSpectrumTopPeaks(
  mz: Float64Array,
  intensity: Float32Array,
  topN: number,
  mzMin = -Infinity,
  mzMax = Infinity,
): SpectrumPeak[] {
  const k = Math.max(1, Math.min(topN, 20))
  const top: number[] = []
  const n = Math.min(mz.length, intensity.length)
  for (let i = 0; i < n; i++) {
    const value = intensity[i]!
    if (
      !Number.isFinite(value) ||
      value <= 0 ||
      !Number.isFinite(mz[i]) ||
      mz[i]! < mzMin ||
      mz[i]! > mzMax
    )
      continue
    if (top.length === k && value <= intensity[top[k - 1]!]!) continue
    let pos = top.length
    while (pos > 0 && intensity[top[pos - 1]!]! < value) pos--
    top.splice(pos, 0, i)
    if (top.length > k) top.pop()
  }
  return top.map((i) => ({ mz: mz[i]!, intensity: intensity[i]! }))
}

/** 完整降序排名（无 cap）：谱峰窗口的排序阶段。一次性索引排序，O(n log n)。 */
function computeAllSpectrumPeaks(
  mz: Float64Array,
  intensity: Float32Array,
  mzMin = -Infinity,
  mzMax = Infinity,
): SpectrumPeak[] {
  const n = Math.min(mz.length, intensity.length)
  const indices: number[] = []
  for (let i = 0; i < n; i++) {
    const value = intensity[i]!
    if (
      !Number.isFinite(value) ||
      value <= 0 ||
      !Number.isFinite(mz[i]) ||
      mz[i]! < mzMin ||
      mz[i]! > mzMax
    )
      continue
    indices.push(i)
  }
  // 稳定：强度降序，同强度按 m/z 升序（与 computeSpectrumTopPeaks 的序一致）
  indices.sort((a, b) => intensity[b]! - intensity[a]! || mz[a]! - mz[b]!)
  return indices.map((i) => ({ mz: mz[i]!, intensity: intensity[i]! }))
}

// ---- 注释段 ----

/**
 * 注释行的任意 rank 窗口（决策 2/7）：全量 ions 按 rank 升序稳定排序后按零基
 * offset/limit 切片，与表格当前筛选/排序解耦。offset 可达任意 rank；limit 只有
 * 单页安全 cap，绝不能先截前 N 再分页。
 */
export function getAnnotationWindow(
  offset: number,
  limit: number,
): { window: RankWindow; rows: AnnotationRow[] } | undefined {
  const annotation = providers.annotations?.()
  if (!annotation) return undefined
  const rows = annotation.panelRows?.() ?? annotation.rows()
  const sorted = [...rows].sort((a, b) => a.rank - b.rank)
  const total = sorted.length
  const start = Math.min(offset, total)
  const page = sorted.slice(start, Math.min(start + limit, total))
  return { window: rankWindowMeta(total, offset, limit, page.length), rows: page }
}

/** 注释面板状态头（get_annotation / get_page.annotation 用）；归一化权重并入面板头。 */
export function getAnnotationPanelState(): Omit<AnnotationPanelState, 'rows'> | null {
  const annotation = providers.annotations?.()
  if (!annotation) return null
  const panel = annotation.panel?.()
  return panel ? { ...panel, weights: annotation.weights ?? null } : null
}

export function hasAnnotationContext(): boolean {
  return providers.annotations?.() != null
}

// ---- 数据集信息 / 离子视图 / 页面头 ----

/**
 * sourceFile → 工具输出的投影（方案「sourceFile 字段透传」约束）：
 * 以 raw（后端原始 snake_case 对象）为底层字段源展开，再以规范化 File 的 camelCase
 * 字段补齐/覆盖同名语义，最后套双命名排除表（camelCase + snake_case）。
 * raw 缺失时退化为规范字段集合（此时未知后端键不可透传）。值做 JSON 净化。
 */
const SOURCE_FILE_EXCLUDED_KEYS = new Set([
  'raw',
  'publicId', 'public_id',
  'imagePath', 'image_path',
  'hashMd5', 'file_verify_code',
  'sizeBytes', 'size',
  'storageType', 'storage_type',
  'isPublic', 'is_public',
  'submitTime', 'uploaded_at',
  'submitter', 'first_uploaded_by',
  'institution',
  'defaultRunId', 'default_run_id',
  'runStatus', 'run_status',
  'status', // 上传状态：面板不显示
])

/** 递归 JSON 净化：非 JSON 安全值（undefined/函数/Symbol/BigInt）剔除或转 null。 */
function jsonSafe(value: unknown): unknown {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value ?? null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return null
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = jsonSafe(v)
    }
    return out
  }
  return null // function / symbol
}

/** get_dataset 的 sourceFile 投影（深度防御：生产 provider 已投影，测试桩可传原始对象）。 */
export function projectSourceFile(
  f: (Record<string, unknown> & { raw?: Record<string, unknown> }) | null,
): Record<string, unknown> | null {
  if (!f) return null
  const base: Record<string, unknown> = { ...f.raw }
  for (const [k, v] of Object.entries(f)) {
    if (k === 'raw') continue
    base[k] = v
  }
  for (const key of Object.keys(base)) {
    if (SOURCE_FILE_EXCLUDED_KEYS.has(key)) delete base[key]
  }
  return jsonSafe(base) as Record<string, unknown>
}

/** 右侧数据集信息面板整体（get_dataset）。 */
export function buildDatasetState(): DatasetInfo | undefined {
  const info = providers.datasetInfo?.()
  if (!info) return undefined
  return { ...info, sourceFile: projectSourceFile(info.sourceFile as never) }
}

/** 页面头（get_page.header）：数据集名 + 处理状态徽章。 */
export function buildPageHeader(): { datasetName: string; status: string } | undefined {
  return providers.pageHeader?.() ?? undefined
}

/** get_ion 的完整离子视图：优先 provider 的 view（含显示参数/通道/ROI），缺省退化为选中 + 统计。 */
export function buildIonState(): { view: IonView; matrix: Float32Array; width: number; height: number } | undefined {
  const ion = providers.selectedIon?.()
  if (!ion) return undefined
  const stats = buildIonImageStats(ion)
  if (ion.view) {
    return {
      view: { ...ion.view, stats },
      matrix: ion.matrix,
      width: ion.width,
      height: ion.height,
    }
  }
  // provider 未给 view（旧接线/测试桩）：退化为最小视图
  return {
    view: {
      mz: ion.mz,
      tolerance: ion.tolerance,
      dataMode: (getSharedZarrContext().dataMode as 'continuous' | 'processed') ?? 'continuous',
      display: {
        colormap: '',
        intensityScale: '',
        gamma: 1,
        displayMin: 0,
        displayMax: 0,
        globalMin: 0,
        globalMax: 0,
      },
      spectrum: { view: 'mean', selectedPixel: null },
      roi: { confirmed: 0, selected: 0 },
      masks: { imported: 0 },
      stats,
    },
    matrix: ion.matrix,
    width: ion.width,
    height: ion.height,
  }
}

// ---- 汇总 ----

/**
 * 页面实时状态汇总（turn-start binding 捕获的数据源）。
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
    const clusters = kmeans.view?.clusters.length ?? kmeans.clusterSizes.length
    state.kmeans = {
      k: kmeans.k,
      clusterCount: clusters,
      selectedCount: kmeans.selectedIds.length,
    }
  }

  const umap = providers.umap?.()
  if (umap) {
    state.umap = { ready: umap.ready, computing: umap.computing, error: umap.error != null }
  }

  const annotations = providers.annotations?.()
  if (annotations) state.annotationCount = annotations.count

  const shared = getSharedZarrContext()
  state.meanSpectrumAvailable = !!(shared.meanChartData && shared.meanChartData.length > 0)

  return state
}

/** 极性同义词归一：'+'/'pos'/大小写等写法 → 'positive'/'negative'；无法识别返回 undefined */
function normalizePolarityValue(v: string | undefined | null): 'positive' | 'negative' | undefined {
  const s = v?.trim().toLowerCase()
  if (s === 'positive' || s === '+' || s === 'pos') return 'positive'
  if (s === 'negative' || s === '-' || s === 'neg') return 'negative'
  return undefined
}

export function resolveMassPolarity(explicit?: string): 'positive' | 'negative' {
  const resolved =
    normalizePolarityValue(explicit ?? polarityRef.value) ??
    // 显式给了值（含未识别）就不回退 metadata，保持报错引导
    (!explicit ? normalizePolarityValue(metadataAttrsRef.value?.polarity) : undefined)
  if (resolved) return resolved
  throw new Error('Unknown ion polarity. Specify polarity as positive or negative for m/z search.')
}

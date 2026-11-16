/** 分析页面交给助手的数据形状（前端运行时数据的统计摘要，不含原始数组） */

import type { RunSummary } from '@/features/vizworkbench/types/annotation'

export type { RunSummary }

/** 数据集段：来自 getSharedZarrContext() 与 metadataAttrsRef */
export interface DatasetOverview {
  filename?: string
  /** 样本名（zarr metadata attrs 的 name） */
  name?: string
  /** 像素（谱）总数（zarr metadata 的 spectrum_count_num） */
  pixelCount?: number
  dataMode: 'continuous' | 'processed'
  width: number
  height: number
  /** 轴方向：'pixel' = 图模式（逐离子强度），'ion' = 谱堆叠视图 */
  rowAxis?: 'pixel' | 'ion'
  pixelSizeHorizontal?: number
  pixelSizeVertical?: number
  /** m/z 轴范围与峰数（continuous 模式） */
  mzMin?: number
  mzMax?: number
  mzCount?: number
  analyzer?: string
  ionisationSource?: string
  polarity?: string
}

/** 离子图段：当前选中 m/z 的统计摘要 */
export interface IonImageStats {
  mz: number
  tolerance: number
  max: number
  mean: number
  min: number
  /** 非零像素占比 0-1 */
  nonzeroRatio: number
  p50: number
  p90: number
  p99: number
  /** 强度最高的若干热点（最多 3 个） */
  hotspots: { x: number; y: number; intensity: number }[]
}

/** 平均谱 top 峰 */
export interface SpectrumPeak {
  mz: number
  intensity: number
}

/** UMAP 任务/栅格概要（不含逐点 embedding） */
export interface UmapSummary {
  /** 聚类 zarr 已成功加载 */
  ready: boolean
  /** UMAP overlay 当前是否显示在离子图上 */
  visible: boolean
  /** 后端 UMAP 降维任务仍在计算（KMeans 聚类是浏览器本地计算，不在此列） */
  computing: boolean
  /** 加载/任务错误信息（无则 null） */
  error: string | null
  /** 栅格网格尺寸（与离子图对齐） */
  grid: { width: number; height: number }
}

// ---- 排名窗口元数据（决策 7：offset/limit 任意窗口的统一形状） ----

/**
 * 排名列表的分页窗口。所有「按排序取列表」的工具（get_annotation、谱峰工具）
 * 都用同一形状：零基 offset（可为任意 rank）、单页 limit 有安全 cap、
 * 返回 total 与 nextOffset 供继续翻页。默认窗口 rank 1–10。
 */
export interface RankWindow {
  /** 完整排序结果的总条数 */
  total: number
  /** 本次窗口的零基起点 */
  offset: number
  /** 请求的单页条数（裁剪到 cap 后的值） */
  limit: number
  /** 实际返回条数 */
  returned: number
  /** 还有剩余时为下一窗口的零基 offset，否则 null */
  nextOffset: number | null
}

/** 解析 offset/limit 参数为受 cap 约束的窗口（供各排名工具共用）。 */
export function resolveRankWindow(
  offset: number | undefined,
  limit: number | undefined,
  defaultLimit = 10,
  maxLimit = 25,
): { offset: number; limit: number } {
  const off = Number.isFinite(offset) && offset! > 0 ? Math.floor(offset!) : 0
  const lim =
    Number.isFinite(limit) && limit! > 0 ? Math.min(Math.floor(limit!), maxLimit) : defaultLimit
  return { offset: off, limit: lim }
}

/** 由窗口与总数构造 RankWindow 元数据。 */
export function rankWindowMeta(
  total: number,
  offset: number,
  limit: number,
  returned: number,
): RankWindow {
  const next = offset + returned
  return { total, offset, limit, returned, nextOffset: next < total ? next : null }
}

/** 注释行（一行 = 一个加合离子）：注释面板注册给助手的扁平视图，字段与面板的 IonAnnotation 对应 */
/**
 * 化合物来源等级（注释库的 Origin 列）：内源 / 预期内源 / 未定 / 外源。来自库的来源信息，
 * 只决定候选先后，不是谱图证据，不计入总分
 */
export type AnnotationOrigin = 'endogenous' | 'expected' | 'unknown' | 'exogenous'

export interface AnnotationRow {
  /** 行 id（get_annotation 精确查询用） */
  id: number
  /** 按总分的排名，1 起 */
  rank: number
  /** 第一个候选名（没有候选名时为分子式） */
  name: string
  /** 第一个候选的来源等级（候选按等级排过：exogenous 说明全部候选都是外源）；库里没有标签时为 null */
  origin: AnnotationOrigin | null
  /** 同分子式的候选化合物（id 为库内编号，如 HMDB0240254；没有为空串），内源在前 */
  candidates: { id: string; name: string; origin: AnnotationOrigin | null }[]
  /** 中性分子式 */
  formula: string
  /** 加合物（ASCII 写法，如 '[M+H]+'） */
  adduct: string
  theoMz: number
  obsMz: number
  /** 带符号的质量误差（ppm） */
  errPpm: number
  intensity: number | null
  /** 质量误差分 0..1 */
  massScore: number
  /** 加合物与采集条件的适配度 0..1 */
  adductFit: number
  /** 空间混乱度（level-set chaos，越高越成块）；null = 未参加空间评分 */
  chaos: number | null
  /** 与同分子其他加合离子图像的最大 Pearson（截到 0..1） */
  coloc: number | null
  /** 空间分 = 0.2 × chaos + 0.8 × coloc；缺失共定位按 0 计 */
  spatialScore: number | null
  totalScore: number
  /** target-decoy q 值 */
  q: number | null
  /** 同一分子的其他加合离子（各自也是独立的行） */
  siblings: { adduct: string; obsMz: number; r: number | null; rank: number }[]
  /** 落在同一个峰上的其他注释，先按来源等级、再按排名 */
  samePeak: { name: string; adduct: string; origin: AnnotationOrigin | null }[]
  /** 已启用但没检出的加合物 */
  missingAdducts: string[]
}

/** 注释总分的权重（归一化，三者之和为 1）：totalScore = mass·massScore + adduct·adductFit + spatial·spatialScore */
export interface AnnotationScoreWeights {
  mass: number
  adduct: number
  spatial: number
}

// ---- get_dataset / get_ion / get_annotation 的整体结构（决策 1–6） ----

/**
 * 多离子通道列表（决策 3）：只保留通道的显示状态，不含 matrix。
 * overlayActive=true 时页面的 colormap/displayRange 输入框置灰。
 */
export interface IonChannelView {
  id: number
  mz: number
  color: [number, number, number]
  visible: boolean
  opacity: number
  loading: boolean
  error: string | null
}

/** get_ion 的完整离子视图（决策 3/4 + 统计）。 */
export interface IonView {
  mz: number
  tolerance: number
  dataMode: 'continuous' | 'processed'
  /** 显示参数（colormap/intensityScale/gamma/displayMin/Max/globalMin/Max） */
  display: {
    colormap: string
    intensityScale: string
    gamma: number
    displayMin: number
    displayMax: number
    globalMin: number
    globalMax: number
  }
  /** 谱图区 */
  spectrum: {
    view: 'mean' | 'pixel'
    selectedPixel: { x: number; y: number } | null
  }
  /** 多离子通道叠加；enabled=false 或没有通道时缺省 */
  channels?: {
    enabled: boolean
    overlayActive: boolean
    list: IonChannelView[]
  }
  /** ROI / 导入掩膜（决策 4） */
  roi: { confirmed: number; selected: number }
  masks: { imported: number }
  stats?: IonImageStats
}

/** KMeans 完整视图（get_kmeans）：簇带颜色，供叠加图与文本共用。 */
export interface KmeansClusterView {
  id: number
  color: [number, number, number]
  count: number
}

/**
 * get_dataset 的 DatasetInfo（与 VizInfoPanel 各段对齐；决策 5/6）。
 * attrs 与 sourceFile 全量透传（sourceFile 由 raw 展开 + 规范字段覆盖 + 双命名排除表，
 * raw 缺失时退化为规范字段），status 归 get_page.header，不在此列。
 */
export interface DatasetInfo {
  /** zarr metadata attrs 全量（含未知键） */
  attrs: Record<string, unknown>
  /** 采集元数据（useResultMeta.acquisition） */
  acquisition: Record<string, unknown>
  /** 源数据集记录投影（排除表见方案） */
  sourceFile: Record<string, unknown> | null
  /** 处理方法列表 */
  methods: string[]
  /** 显示范围（面板 Display Range 段） */
  displayRange: {
    globalMin: number
    globalMax: number
    displayMin: number
    displayMax: number
  } | null
  /** 图像统计（'--' 占位转 null）+ 像素尺寸 */
  imageInfo: {
    pixels: string | null
    nonZero: string | null
    totalIon: string | null
    pixelSize: string | null
  }
}

/** 注释面板条件（get_annotation 面板头）。 */
export interface AnnotationConditions {
  tolValue: number | null
  tolUnit: 'ppm' | 'Da'
  cutPct: number
  spatialPct: number
  polarityOverride: 'positive' | 'negative' | null
  adductOverrides: Record<string, unknown>
  /** 面板输入的权重比例 */
  scoreRatio: AnnotationScoreWeights
}

/** 注释面板筛选（get_annotation 面板头；分页口径与筛选解耦，仅展示）。 */
export interface AnnotationFilters {
  qLevel: 'all' | number
  adductFilter: string[]
  siblingsOnly: boolean
  moleculeFilter: number | null
  searchQuery: string
  sortKey: string
  sortReverse: boolean
}

/** get_annotation 的面板状态头。 */
export interface AnnotationPanelState {
  summary: RunSummary | null
  conditions: AnnotationConditions | null
  filters: AnnotationFilters | null
  /** 本次运行的归一化总分权重（与 conditions.scoreRatio 的面板输入比例对应） */
  weights?: AnnotationScoreWeights | null
  /** 当前表格可见行数（筛选/排序后）；全量分页口径不受它影响 */
  visibleRows: number
  /** 运行状态：idle/running/done/error */
  runState: string
  /** 注释库信息 */
  dbInfo: { label: string; count: number } | null
  /** 峰统计 */
  peakStats: { axis: number; nonZero: number; kept: number } | null
  rows: AnnotationRow[]
}

/** Immutable analysis context snapshot for turn-start binding capture. */
export interface PageState {
  /** 数据集概览（zarr 未加载时缺省） */
  dataset?: DatasetOverview
  /** 当前选中离子（直接字段，不做矩阵统计；离子详情工具负责重统计） */
  selectedIon?: { mz: number; tolerance: number }
  /** KMeans binding 概要 */
  kmeans?: { k: number | null; clusterCount: number; selectedCount: number }
  /** UMAP 状态概要（ready/computing；error=true 表示加载失败，区别于未加载；明细走 get_umap） */
  umap?: { ready: boolean; computing: boolean; error: boolean }
  /** 注释匹配条数（明细走 get_annotation） */
  annotationCount?: number
  /** 平均谱是否已加载（峰值明细走 get_mean_spectrum_top_peaks） */
  meanSpectrumAvailable?: boolean
}

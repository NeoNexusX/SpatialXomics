/** 分析页面交给助手的数据形状（前端运行时数据的统计摘要，不含原始数组） */

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

/** KMeans 聚类段 */
export interface KmeansSummary {
  k: number
  /** 每簇像素数（按簇 id 顺序） */
  clusterSizes: number[]
  /** 当前选中的簇 id 列表 */
  selectedIds: number[]
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

/** 注释行（一行 = 一个加合离子）：注释面板注册给助手的扁平视图，字段与面板的 IonAnnotation 对应 */
/**
 * 化合物来源等级（注释库的 Origin 列）：内源 / 预期内源 / 未定 / 外源。来自库的来源信息，
 * 只决定候选先后，不是谱图证据，不计入总分
 */
export type AnnotationOrigin = 'endogenous' | 'expected' | 'unknown' | 'exogenous'

export interface AnnotationRow {
  /** 行 id（get_annotation_detail 用） */
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

/** buildPageState() 的输出：get_page_state 工具的轻量实时状态汇总（不含重统计） */
export interface PageState {
  /** 数据集概览（zarr 未加载时缺省） */
  dataset?: DatasetOverview
  /** 当前选中离子（直接字段，不做矩阵统计——重统计走 get_ion_image_stats） */
  selectedIon?: { mz: number; tolerance: number }
  /** 聚类概要：k 与簇数（簇大小明细走 get_kmeans_summary） */
  kmeans?: { k: number; clusterCount: number; selectedCount: number }
  /** UMAP 状态概要（ready/computing；明细走 get_umap_summary） */
  umap?: { ready: boolean; computing: boolean }
  /** 注释匹配条数（明细走 get_annotation_top） */
  annotationCount?: number
  /** 平均谱是否已加载（峰值明细走 get_mean_spectrum_top_peaks） */
  meanSpectrumAvailable?: boolean
}

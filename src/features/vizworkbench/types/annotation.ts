/**
 * 注释模块的数据结构。
 *
 * 数据流：平均谱上的峰（去掉强度为 0 和强度最低的 n%）+ 采集条件 + 注释库 → worker
 * 匹配、关联、打分、FDR → 表格（一行 = 一个加合离子）。同一分子的不同加合离子各占一行，
 * 通过 Molecule 关联。
 */

import type { AdductDef, AdductId } from '@/shared/chem/adducts'

export type { AdductId }

// ---- 采集条件 -------------------------------------------------------------

export type SourceFamily = 'maldi' | 'ldi' | 'esi' | 'sims' | 'other'
export type AnalyzerFamily = 'orbitrap' | 'fticr' | 'qtof' | 'tof' | 'other'
export type MatrixKey =
  | 'dhb'
  | 'chca'
  | '9aa'
  | 'dan'
  | 'nedc'
  | 'norharmane'
  | 'dhap'
  | 'sa'
  | 'ionic'
  | 'aunp'
  | 'agnp'
  | 'other'
export type AdditiveKey =
  | 'formate'
  | 'acetate'
  | 'ammonium'
  | 'chloride'
  | 'lithium'
  | 'sodium'
  | 'silver'

/** 规则引擎的输入：采集元数据（types/acquisition.ts）归一化后的离散条件 */
export interface AcquisitionContext {
  polarity: 'positive' | 'negative' | null
  source: SourceFamily
  analyzer: AnalyzerFamily
  matrix: MatrixKey | null
  additives: AdditiveKey[]
}

export interface Tolerance {
  value: number
  unit: 'ppm' | 'Da'
  /** user = 用户填写；analyzer = 按分析器默认；fallback = 分析器未知时的兜底 */
  origin: 'user' | 'analyzer' | 'fallback'
}

// ---- 输入数据 -------------------------------------------------------------

/** 参与匹配的峰：平均轴上选出的点（列式存储，m/z 升序） */
export interface PeakTable {
  mz: Float64Array
  /** 平均谱强度（> 0） */
  intensity: Float32Array
  /** 在平均轴上的下标（取离子图、跳转用） */
  axisIndex: Int32Array
}

/** 化合物来源等级（库模板的可选 Origin 列），按排序先后：内源 → 预期内源 → 未定 → 外源 */
export type CandidateOrigin = 'endogenous' | 'expected' | 'unknown' | 'exogenous'

/** 注释库里的一个化合物（库模板的一行） */
export interface Candidate {
  /** 库内编号，如 HMDB0240254；没有为空串 */
  id: string
  name: string
  /** 没有为空串 */
  inchi: string
  /** 来源等级；库里没有 Origin 列或值认不出时缺省 */
  origin?: CandidateOrigin
}

/**
 * 注释库：按分子式归组（同分子式的异构体质量相同，单靠质量分不开，作为同一分子的多个候选），
 * 按单同位素中性质量升序
 */
export interface AnnotationDb {
  id: string
  label: string
  version: string
  mass: Float64Array
  formula: string[]
  /** 每个分子式的候选化合物 */
  candidates: Candidate[][]
}

/** 当前注释库的摘要：库在 worker 里解析和持有，界面只需要库名与分子式数 */
export interface AnnotationDbInfo {
  label: string
  /** 分子式数 */
  count: number
}

// ---- 加合物 ---------------------------------------------------------------

/** 规则的说明（界面文案见 utils/annotation/adductRuleText） */
export type RuleReason =
  | 'protonation'
  | 'sodiumEndogenous'
  | 'sodiumLaser'
  | 'sodiumSolvent'
  | 'potassiumEndogenous'
  | 'potassiumLaser'
  | 'ammoniumSolvent'
  | 'lithiumSolvent'
  | 'silverMatrix'
  | 'silverSolvent'
  | 'deprotonation'
  | 'chlorideEndogenous'
  | 'chlorideEsi'
  | 'chlorideSolvent'
  | 'chlorideNedc'
  | 'formateSolvent'
  | 'acetateSolvent'

/** 适配规则：条件全部满足时给出 fit；同一加合物命中多条时取最大值 */
export interface AdductRule {
  adduct: AdductId
  fit: number
  /** 不写 = 不限 */
  sources?: SourceFamily[]
  matrices?: MatrixKey[]
  /** 命中任一即可 */
  additives?: AdditiveKey[]
  reason: RuleReason
}

export interface ResolvedAdduct {
  def: AdductDef
  fit: number
  /** 命中的规则 */
  reasons: RuleReason[]
  /** 未启用时，启用它需要满足的条件（该加合物各条规则的说明） */
  requires: RuleReason[]
  enabled: boolean
  /** rule = 由规则启用；user = 规则没选、用户手动开启 */
  origin: 'rule' | 'user'
}

export type AdductOverride = 'on' | 'off'

// ---- 输出 -----------------------------------------------------------------

/** 分子：库里的一个分子式。不进表格，只用来关联它的各个加合离子 */
export interface Molecule {
  /** 库内下标 */
  id: number
  formula: string
  neutralMass: number
  /** 同分子式的候选化合物 */
  candidates: Candidate[]
  /** 本次检出的该分子的所有加合离子（行 id） */
  ionIds: number[]
  /** 已启用但没检出的加合物 */
  missing: MissingAdduct[]
}

export interface MissingAdduct {
  adduct: AdductId
  theoMz: number
  /** 理论 m/z 超出参与匹配的峰的 m/z 范围 */
  outOfRange: boolean
}

export type SpatialState = 'queued' | 'done' | 'na' | 'error'

export interface IonScores {
  /** 质量误差分 0..1 */
  mass: number
  /** 加合适配度（= fit） */
  adduct: number
  /** 空间混乱度（level-set chaos，越高越成块），按峰计算 */
  chaos: number | null
  /** 同分子离子间最大的有效 Pearson（r > 0.1），截到 [0,1]；均未达阈值为 0，没有可计算的相关为 null */
  coloc: number | null
  /** 空间分 = 0.2 · chaos + 0.8 · coloc；未计算为 null，计入总分时按 0 计 */
  spatial: number | null
  spatialState: SpatialState
  total: number
}

/** 表格的一行：一个加合离子 = 分子 + 加合物 + 峰 */
export interface IonAnnotation {
  id: number
  /** 同分子的其他加合离子 = molecules[moleculeId].ionIds 去掉自己 */
  moleculeId: number
  adduct: AdductId
  fit: number
  /** 在 PeakTable 里的下标 */
  peak: number
  axisIndex: number
  theoMz: number
  obsMz: number
  /** (obs − theo) / theo · 1e6 */
  errPpm: number
  intensity: number
  /** 同一个峰上的其他行（同量异位等多种解释） */
  samePeak: number[]
  scores: IonScores
  q: number | null
  /** 1 起；按总分降序。只在运行结束和空间评分全部完成时更新 */
  rank: number
}

/** 运行摘要 */
export interface RunSummary {
  /** 参与匹配的峰数 */
  peaks: number
  ions: number
  molecules: number
  qCounts: { q05: number; q10: number; q20: number }
  decoy: { replicates: number; ions: number }
  spatial: { total: number; done: number }
  timingMs: number
}

/** 总分三部分的权重（或面板上输入的比例数，按和归一化后才是权重） */
export interface ScoreWeights {
  mass: number
  adduct: number
  spatial: number
}

export interface EngineConfig {
  /** 总分权重：质量 / 加合适配度 / 空间，三者之和为 1 */
  weights: ScoreWeights
  /** 空间分内部权重；没有可用共定位证据时 coloc 按 0 计 */
  spatialWeights: { chaos: number; coloc: number }
  /** σ = 容差 × massSigma */
  massSigma: number
  /** 空间评分覆盖的初始匹配行比例（0–100%）；按初始总分取前段 */
  spatialPct: number
  decoyReplicates: number
  /** 非零像素少于它的图不算混乱度 / 相关性 */
  minPixels: number
  seed: number
}

/** 一个空间任务：一个分子组（目标或 decoy）各加合离子的峰 */
export interface SpatialJob {
  job: string
  axisIndices: number[]
  /** 越小越先算 */
  priority: number
}

/** 缺省的字段保持不变 */
export interface IonPatch {
  id: number
  scores?: IonScores
  q?: number | null
  rank?: number
}

export interface AnnotationResult {
  ions: IonAnnotation[]
  molecules: Molecule[]
  summary: RunSummary
  jobs: SpatialJob[]
}

export interface SpatialPatch {
  ions: IonPatch[]
  /** 新算出的峰对相关：[pairKey, r]（pearson.pairKey） */
  pairR: [string, number | null][]
  summary: RunSummary
  /** 所有空间任务已完成：本次 patch 带全量 q 与 rank */
  final: boolean
}

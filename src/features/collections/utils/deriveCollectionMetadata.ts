import type { CollectionMetadata } from '../types/collection'
import { normalizeMetadataList } from './metadataPatch'

/**
 * 从成员条目聚合出集合级元数据（纯函数，便于单测）。
 *
 * 集合的 list 字段语义是「该集合涵盖的取值集合」，所以这里取**去重并集**并按
 * 成员顺序保留首次出现的位置；成员取值不一致时数组会有多项，这是对的——不是取交集。
 *
 * 条目有两种：创建页选中的数据集（File）和集合详情里的成员（CollectionMember），
 * 它们在下面 8 个字段上同名。后端不会按成员自动汇总这些字段，所以创建时要由前端
 * 推导后随 POST 提交；之后增删成员，也由前端比对并提出更新（mergeDerivedMetadata）。
 *
 * 只有这 8 个字段能从成员推导；citation 组的 doi 虽然也是 list，
 * 但属于人工著录，不在这里。数值型仪器字段（pixel_size_* / resolving_power /
 * mz）已随集合级模型下线，不再推导。
 */
export const DERIVED_METADATA_KEYS = [
  'organism',
  'organism_part',
  'sample_stabilization',
  'sample_growth_conditions',
  'tissue_modification',
  'polarity',
  'ionisation_source',
  'analyzer',
] as const

export type DerivedMetadataKey = (typeof DERIVED_METADATA_KEYS)[number]

export type DerivedMetadata = Record<DerivedMetadataKey, string[]>

/**
 * 可供推导的条目：8 个取值字段都可选，未填写（null / undefined / 空串）时跳过。
 * File 与 CollectionMember 在这些字段上同名，都满足这个结构。
 */
export interface MetadataSource {
  organism?: unknown
  organismPart?: unknown
  sampleStabilization?: unknown
  sampleGrowthConditions?: unknown
  tissueModification?: unknown
  polarity?: unknown
  ionSource?: unknown
  analyzer?: unknown
}

/** 集合字段 ← 条目字段（camelCase，由各自的 mapper 映射好） */
const SOURCES: Record<DerivedMetadataKey, (source: MetadataSource) => unknown> = {
  organism: (source) => source.organism,
  organism_part: (source) => source.organismPart,
  sample_stabilization: (source) => source.sampleStabilization,
  sample_growth_conditions: (source) => source.sampleGrowthConditions,
  tissue_modification: (source) => source.tissueModification,
  polarity: (source) => source.polarity,
  ionisation_source: (source) => source.ionSource,
  analyzer: (source) => source.analyzer,
}

function normalize(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

export function deriveCollectionMetadata(sources: readonly MetadataSource[]): DerivedMetadata {
  const result = {} as DerivedMetadata
  for (const key of DERIVED_METADATA_KEYS) {
    const seen = new Set<string>()
    const values: string[] = []
    for (const source of sources) {
      const value = normalize(SOURCES[key](source))
      if (!value || seen.has(value)) continue
      seen.add(value)
      values.push(value)
    }
    result[key] = values
  }
  return result
}

/** 一项待确认的汇总字段变更：集合当前的取值 → 建议更新成的取值 */
export interface DerivedMetadataChange {
  key: DerivedMetadataKey
  /** 集合当前的取值 */
  before: string[]
  /** 建议更新成的取值 */
  after: string[]
}

/** 取值集合是否相同：忽略顺序，区分大小写（与后端的去重规则一致） */
function sameValues(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const sorted = (list: readonly string[]) => [...list].sort()
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b))
}

/**
 * 把一次成员变化套用到集合当前的汇总字段上，返回因此需要变更的字段。
 *
 * 只动「这次变化带来或带走的取值」：新成员带来的取值追加到末尾，离开的成员带走的
 * 取值移除，其余一律保留——用户手改的、手工补充的取值不会被换掉。与这次变化无关的
 * 差异（比如创建时改过物种）不会被翻出来，也就不会在每次增删成员后反复打扰用户。
 *
 * before / after 是变化前后按成员推导的值。这次变化没碰到的字段不产生变更；
 * 套用后与当前值相同的字段（比如新成员的取值用户早已手填过）也不产生变更。
 */
export function mergeDerivedMetadata(
  current: CollectionMetadata,
  before: DerivedMetadata,
  after: DerivedMetadata,
): DerivedMetadataChange[] {
  const changes: DerivedMetadataChange[] = []
  for (const key of DERIVED_METADATA_KEYS) {
    const gone = before[key].filter((value) => !after[key].includes(value))
    const added = after[key].filter((value) => !before[key].includes(value))
    if (!gone.length && !added.length) continue

    const stored = normalizeMetadataList(current?.[key])
    const kept = stored.filter((value) => !gone.includes(value))
    const next = [...kept, ...added.filter((value) => !kept.includes(value))]
    if (!sameValues(stored, next)) changes.push({ key, before: stored, after: next })
  }
  return changes
}

import type { CollectionMetadata } from '../types/collection'
import { t } from '@/i18n'
import {
  ANALYZERS,
  ION_SOURCES,
  ORGANISM_PARTS,
  ORGANISMS,
  POLARITIES,
  SAMPLE_GROWTH_CONDITIONS,
  SAMPLE_STABILIZATIONS,
  TISSUE_MODIFICATIONS,
} from '@/features/datasets/constants/datasetMetadata'
import { COLLECTION_TYPES, MEMBER_TYPES } from './collectionVocab'

/**
 * Collection 学术元数据的字段定义表——单一事实来源：
 * 本期驱动 CollectionMetadataPanel 的只读展示（分组渲染，空值显示「—」占位），
 * 二期编辑表单直接复用为控件定义（key 已是后端 PATCH 字段名，snake_case）。
 */

export type MetadataGroupId = 'general' | 'citation' | 'sample' | 'acquisition'

type MetadataFieldType = 'text' | 'long' | 'list' | 'date'

export interface MetadataFieldDef {
  key: keyof CollectionMetadata
  /** 显示名 getter：表是模块顶层常量，文案必须在渲染时按当前语言取（在模板 / computed 里调用） */
  label: () => string
  type: MetadataFieldType
  group: MetadataGroupId
  /** list 字段的词表（与数据集上传表单同源）：编辑时作为下拉建议，自由输入仍可用 */
  options?: readonly string[]
  /** 输入提示（getter，理由同 label）；缺省时文本框无提示、list 字段用 TagInput 的默认提示 */
  placeholder?: () => string
  /**
   * 前端必填字段（创建集合时校验，仅影响前端提交门槛与星号，后端 API 不变）。
   * Growth Conditions / Tissue Modification 保持可选。
   */
  required?: boolean
  /** list 字段的自由输入校验；词表选项不受约束 */
  pattern?: RegExp
  /** pattern 不匹配时的提示（getter，理由同 label）；应说明期望的格式 */
  patternMessage?: () => string
}

/**
 * DOI 的标准前缀 + 非空后缀；不限制后缀字符，兼容不同注册机构的写法。
 * 也接受直接粘贴的 doi.org 链接与 "doi:" 写法，按用户输入原样保存。
 */
const DOI_PATTERN = /^(?:(?:https?:\/\/)?(?:dx\.|www\.)?doi\.org\/|doi:\s*)?10\.\d{4,9}\/\S+$/i

export const METADATA_GROUPS: { id: MetadataGroupId; label: () => string }[] = [
  { id: 'general', label: () => t('collections.group.general') },
  { id: 'citation', label: () => t('collections.group.citation') },
  { id: 'sample', label: () => t('collections.group.sample') },
  { id: 'acquisition', label: () => t('collections.group.acquisition') },
]

export const METADATA_FIELDS: MetadataFieldDef[] = [
  // General
  { key: 'name', label: () => t('common.field.name'), type: 'text', group: 'general' },
  {
    key: 'description',
    label: () => t('collections.meta.description'),
    type: 'long',
    group: 'general',
  },
  {
    key: 'member_type',
    label: () => t('collections.meta.memberType'),
    type: 'list',
    group: 'general',
    options: MEMBER_TYPES,
    placeholder: () => t('collections.metaForm.placeholder.memberType'),
    required: true,
  },
  {
    key: 'collection_type',
    label: () => t('collections.meta.collectionType'),
    type: 'list',
    group: 'general',
    options: COLLECTION_TYPES,
    placeholder: () => t('collections.metaForm.placeholder.collectionType'),
    required: true,
  },
  // Citation
  {
    key: 'title',
    label: () => t('collections.meta.title'),
    type: 'text',
    group: 'citation',
    placeholder: () => t('collections.metaForm.placeholder.title'),
  },
  {
    key: 'doi',
    label: () => t('collections.meta.doi'),
    type: 'list',
    group: 'citation',
    placeholder: () => t('collections.metaForm.placeholder.doi'),
    pattern: DOI_PATTERN,
    patternMessage: () => t('collections.metaForm.doiInvalid'),
  },
  {
    key: 'access',
    label: () => t('collections.meta.access'),
    type: 'list',
    group: 'citation',
    placeholder: () => t('collections.metaForm.placeholder.access'),
  },
  {
    key: 'journal_name',
    label: () => t('collections.meta.journal'),
    type: 'text',
    group: 'citation',
    placeholder: () => t('collections.metaForm.placeholder.journal'),
  },
  // 发表时间：date 档位走原生日期选择器（草稿/载荷统一 YYYY-MM-DD；响应可能是
  // 完整 ISO，由 metadataPatch 的 toDateStringInput 归一）；不参与自动推导
  { key: 'publish_time', label: () => t('collections.meta.publishTime'), type: 'date', group: 'citation' },
  {
    key: 'cite_information',
    label: () => t('collections.meta.citation'),
    type: 'long',
    group: 'citation',
    placeholder: () => t('collections.metaForm.placeholder.citation'),
  },
  {
    key: 'abstract',
    label: () => t('collections.meta.abstract'),
    type: 'long',
    group: 'citation',
    placeholder: () => t('collections.metaForm.placeholder.abstract'),
  },
  // Sample
  {
    key: 'organism',
    label: () => t('common.meta.organism'),
    type: 'list',
    group: 'sample',
    options: ORGANISMS,
    required: true,
  },
  {
    key: 'organism_part',
    label: () => t('common.meta.organismPart'),
    type: 'list',
    group: 'sample',
    options: ORGANISM_PARTS,
    required: true,
  },
  {
    key: 'sample_stabilization',
    label: () => t('common.meta.sampleStabilization'),
    type: 'list',
    group: 'sample',
    options: SAMPLE_STABILIZATIONS,
    required: true,
  },
  {
    key: 'sample_growth_conditions',
    label: () => t('common.meta.growthConditions'),
    type: 'list',
    group: 'sample',
    options: SAMPLE_GROWTH_CONDITIONS,
  },
  {
    key: 'tissue_modification',
    label: () => t('common.meta.tissueModification'),
    type: 'list',
    group: 'sample',
    options: TISSUE_MODIFICATIONS,
  },
  // Acquisition
  // （resolving_power / mz / pixel_size_* 已随集合级数值字段下线；文件级同名字段不受影响）
  {
    key: 'polarity',
    label: () => t('common.meta.polarity'),
    type: 'list',
    group: 'acquisition',
    options: POLARITIES,
    required: true,
  },
  {
    key: 'ionisation_source',
    label: () => t('common.meta.ionisationSource'),
    type: 'list',
    group: 'acquisition',
    options: ION_SOURCES,
    required: true,
  },
  {
    key: 'analyzer',
    label: () => t('common.meta.analyzer'),
    type: 'list',
    group: 'acquisition',
    options: ANALYZERS,
    required: true,
  },
]

/** 创建集合时前端必填的字段键（由字段表的 required 标记派生，单一事实来源） */
export const REQUIRED_METADATA_KEYS: readonly (keyof CollectionMetadata)[] =
  METADATA_FIELDS.filter((f) => f.required).map((f) => f.key)

/** 该字段是否有可展示的值（空串/null/undefined/空数组都视为未填写） */
export function hasMetadataValue(metadata: CollectionMetadata, field: MetadataFieldDef): boolean {
  const v = metadata?.[field.key]
  if (v == null) return false
  if (Array.isArray(v)) return v.length > 0
  return String(v).trim() !== ''
}

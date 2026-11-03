import type { FilePublicResponse } from '@/features/datasets/types/dataset'
import { toFilePublicId } from '@/features/datasets/utils/publicId'
import { METADATA_FIELDS } from '../constants/metadataFields'
import { normalizeMetadataList } from '../utils/metadataPatch'
import type {
  CollectionDetail,
  CollectionMember,
  CollectionMetadata,
  CollectionSummary,
} from '../types/collection'

/**
 * Collection 响应映射：顶层 snake→camel；元数据字段原样透传（snake_case），
 * 与 types/collection.ts 的混合策略一致。
 */

function mapFilePublicToMember(raw: FilePublicResponse): CollectionMember {
  return {
    publicId: toFilePublicId(raw.public_id),
    imagePath: raw.image_path ?? null,
    filename: raw.filename || '',
    size: raw.size ?? 0,
    status: raw.status || '',
    isPublic: !!raw.is_public,
    experimentType: raw.experiment_type ?? null,
  }
}

/**
 * 提取学术元数据块。后端把元数据字段**平铺在响应顶层**（实测 POST /collections/list：
 * name/doi/organism/analyzer… 与 id/member_count 同级，没有嵌套的 metadata 对象），
 * 因此以 metadataFields 表为字段清单从顶层挑选；若将来改为嵌套 metadata 对象也兼容。
 */
function toMetadata(raw: any): CollectionMetadata {
  const nested = raw?.metadata
  const source = {
    ...(raw && typeof raw === 'object' ? raw : {}),
    ...(nested && typeof nested === 'object' ? nested : {}),
  }
  const out: Record<string, unknown> = {}
  for (const field of METADATA_FIELDS) {
    if (source?.[field.key] !== undefined) {
      out[field.key] =
        field.type === 'list' ? normalizeMetadataList(source[field.key]) : source[field.key]
    }
  }
  if (!out.name) out.name = raw?.name || ''
  return out as unknown as CollectionMetadata
}

/** 顶层优先、其次元数据块；统一成 string[] 便于卡片直接渲染 */
function toStringList(raw: any, metadata: CollectionMetadata, key: string): string[] {
  const top = normalizeMetadataList(raw?.[key])
  if (top.length) return top
  return normalizeMetadataList((metadata as unknown as Record<string, unknown>)[key])
}

function toSummary(raw: any): CollectionSummary {
  const metadata = toMetadata(raw)
  return {
    name: raw.name || '',
    title: raw.title || null,
    description: raw?.description ?? metadata.description ?? null,
    memberCount: raw.member_count ?? 0,
    totalSize: raw.total_size ?? 0,
    ownerUsername: raw.owner_username || '',
    organism: toStringList(raw, metadata, 'organism'),
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
    publicId: raw.public_id ?? '',
    doi: toStringList(raw, metadata, 'doi'),
    journalName: raw.journal_name ?? metadata.journal_name ?? null,
    publishTime: raw.publish_time ?? null,
    // access 后端契约是 list[str]（Create/Patch/响应一致），与其他列表字段同走归一
    access: toStringList(raw, metadata, 'access'),
    organismPart: toStringList(raw, metadata, 'organism_part'),
    ionisationSource: toStringList(raw, metadata, 'ionisation_source'),
    members: Array.isArray(raw?.members) ? raw.members.map(mapFilePublicToMember) : undefined,
  }
}

/** GET /collections/{public_id}（及创建/加成员/调序返回的完整详情） */
export function mapCollectionDetail(raw: any): CollectionDetail {
  const members = Array.isArray(raw?.members) ? raw.members : []
  return {
    ...toSummary(raw),
    metadata: toMetadata(raw),
    members: members.map(mapFilePublicToMember),
  }
}

/** POST /collections/list 列表行：详情 mapper 的子集（列表响应可能不带 members） */
export function mapCollectionSummary(raw: any): CollectionSummary {
  return toSummary(raw)
}

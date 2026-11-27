import { METADATA_FIELDS } from '../constants/metadataFields'
import type {
  CollectionCreatePayload,
  CollectionMetadata,
  CollectionMetadataDraft,
  CollectionPatchPayload,
} from '../types/collection'

/** 把后端可能返回的标量/空值统一成草稿使用的 string[]。 */
export function normalizeMetadataList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value]
  return values.map((item) => String(item).trim()).filter(Boolean)
}

/**
 * 集合元数据的编辑草稿 ⇄ PATCH 载荷转换（纯函数，便于单测）。
 *
 * 草稿形态：18 个字段统一为 string（text/long）或 string[]（list），
 * 空值归一为 '' / []，让表单控件绑定简单且类型安全。
 * 载荷形态：只包含与当前值不同的字段（exclude_unset 语义），
 * 键为后端 snake_case（与 CollectionMetadata 同键）。
 */

/**
 * ISO 时间串 → <input type="date"> 绑定所需的 YYYY-MM-DD。
 * 响应可能带完整时间（2024-05-01T08:00:00Z），控件只认日期部分；
 * 不匹配日期前缀的值（脏数据）按空处理。
 */
export function toDateStringInput(value: unknown): string {
  if (typeof value !== 'string') return ''
  const m = value.match(/^(\d{4}-\d{2}-\d{2})/)
  return m?.[1] ?? ''
}

/** 当前元数据 → 表单草稿（list 字段缺省 []，text 字段缺省 ''，date 字段取日期部分） */
export function toMetadataDraft(metadata: CollectionMetadata): CollectionMetadataDraft {
  // 联合键索引写入在 TS 下不可赋值，先按松化 record 组装再整体断言
  const draft: Record<string, string | string[]> = {}
  for (const field of METADATA_FIELDS) {
    const v = metadata?.[field.key]
    draft[field.key] =
      field.type === 'list'
        ? normalizeMetadataList(v)
        : field.type === 'date'
          ? toDateStringInput(v)
          : (v ?? '')
  }
  return draft as CollectionMetadataDraft
}

/**
 * 草稿 → 差量 PATCH 载荷：逐字段与当前值比较（比较前同样归一化），
 * 只保留发生变化的键。清空字段发送显式空值：列表 []、字符串 ''、日期 null。
 * 草稿里日期同样用 '' 表示空，但后端只认 null——空串会被当成非法日期返回 422；
 * publish_time 也是 PATCH 里唯一允许 null 的字段，其余字段发 null 同样 422。
 */
export function buildMetadataPatch(
  current: CollectionMetadata,
  draft: CollectionMetadataDraft,
): CollectionPatchPayload {
  const patch: CollectionPatchPayload = {}
  for (const field of METADATA_FIELDS) {
    const raw = current?.[field.key]
    const normalized =
      field.type === 'list'
        ? normalizeMetadataList(raw)
        : field.type === 'date'
          ? toDateStringInput(raw)
          : raw ?? ''
    const next = field.type === 'list' ? normalizeMetadataList(draft[field.key]) : draft[field.key]
    if (JSON.stringify(normalized) !== JSON.stringify(next)) {
      ;(patch as Record<string, unknown>)[field.key] = field.type === 'date' ? next || null : next
    }
  }
  return patch
}

/**
 * 创建草稿 → POST /collections 请求体。与 PATCH 的差量语义不同：
 * 这里没有「当前值」可比较，**只带非空字段**，空串 / 空数组直接省略，
 * 让后端用自己的默认值（避免用空值覆盖）。文本字段顺手 trim，
 * 与创建页原来对 name 的处理一致。
 */
export function buildCollectionCreatePayload(
  draft: CollectionMetadataDraft,
  filePublicIds: string[],
): CollectionCreatePayload {
  const payload: Record<string, unknown> = { file_public_ids: filePublicIds }
  for (const field of METADATA_FIELDS) {
    const value = draft[field.key]
    if (field.type === 'list') {
      const list = normalizeMetadataList(value)
      if (list.length) payload[field.key] = list
      continue
    }
    const text = String(value ?? '').trim()
    if (text) payload[field.key] = text
  }
  return payload as CollectionCreatePayload
}

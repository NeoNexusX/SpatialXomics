/**
 * Collection（文件集合）：把公开 imzML 文件组织成带学术元数据的策展容器。
 * 集合不复制文件，只是"文件指针 + 顺序"；member_count / total_size 实时聚合。
 *
 * 类型策略（混合）：
 * - 顶层业务字段 camelCase，由 collectionMapper 从 snake_case 响应转换；
 * - 学术元数据块 CollectionMetadata 保持 snake_case 透传（本期只读展示，
 *   避免与二期编辑表单做双向映射）；与分页 meta 的 snake 先例一致。
 */

/** POST /collections/list（我的集合）/ POST /collections/list_all（全库）列表行；按 updated_at 倒序 */
export interface CollectionSummary {
  name: string
  title: string | null
  /** 列表行是否携带 description 未确认；缺省 null，卡片隐藏简介 */
  description: string | null
  memberCount: number
  /** 字节，展示层格式化 */
  totalSize: number
  ownerUsername: string
  /** 卡片物种 chips；列表响应未确认携带，缺省为空数组 */
  organism: string[]
  createdAt: string | null
  updatedAt: string | null
  /** 免登录分享 id（16 位 base62）。集合对外标识只有 public_id，数字 id 不再返回 */
  publicId: string
  // ---- 卡片直接展示的元数据（后端列表响应平铺在顶层，已有实测）----
  doi: string[]
  journalName: string | null
  /** 文章发表时间（ISO 串）；卡片 Journal 行下展示，null 显示「—」 */
  publishTime: string | null
  /** 卡片右侧的 Access 链接列表；后端原样透传，每项可能是 URL 或标签文本 */
  access: string[]
  organismPart: string[]
  ionisationSource: string[]
  /**
   * 列表响应目前**不返回** members（拿封面预览需要成员的 imagePath）。
   * 若后端将来带上，cards 可直接用；否则由 useCollectionCovers 逐卡调详情补齐。
   */
  members?: CollectionMember[]
}

/** 集合详情：元数据 + 有序成员。members 已按 position 排序，前端不重排 */
export interface CollectionDetail extends CollectionSummary {
  metadata: CollectionMetadata
  members: CollectionMember[]
}

/** 公开页详情（GET /collections/public/{public_id}）：响应结构与 CollectionDetail 一致（对外只用 public_id） */
export type PublicCollectionDetail = CollectionDetail

/** 集合成员（由 FilePublic 映射；文件对外标识为 16 位字符串 publicId，不再使用数字 file_id） */
export interface CollectionMember {
  publicId: string
  /** OSS 预览图目录（后端 image_path）；null = 未生成，封面走占位图 */
  imagePath: string | null
  filename: string
  size: number
  status: string
  isPublic: boolean
  experimentType: string | null
}

/**
 * 学术元数据块：snake_case = 后端原样透传，不做 camel 转换。
 * 二期编辑表单以 constants/metadataFields.ts 的字段定义表为单一事实来源。
 */
export interface CollectionMetadata {
  name: string
  description?: string | null
  member_type?: string[]
  collection_type?: string[]
  title?: string | null
  doi?: string[]
  access?: string[]
  journal_name?: string | null
  /** 文章发表时间（ISO 8601）；纯展示字段，不参与筛选/聚合，未设置为 null */
  publish_time?: string | null
  abstract?: string | null
  cite_information?: string | null
  organism?: string[]
  organism_part?: string[]
  sample_stabilization?: string[]
  sample_growth_conditions?: string[]
  tissue_modification?: string[]
  polarity?: string[]
  ionisation_source?: string[]
  analyzer?: string[]
  // 集合级数值型仪器字段（pixel_size_horizontal / pixel_size_vertical /
  // resolving_power / mz）已下线，响应中不再返回；文件级同名字段不受影响
}

/**
 * POST /collections 请求体；file_public_ids 数组顺序 = position 1..n。
 * 元数据字段与 PATCH 一一对应（后端 CollectionCreate 同样接收全部 18 个），
 * 所以创建时就能带上元数据，不必建完再 PATCH 一次；空值不发送。
 */
export type CollectionCreatePayload = Partial<CollectionMetadata> & {
  name: string
  file_public_ids: string[]
}

/**
 * PATCH /collections/{public_id} 请求体：全部元数据字段均可部分更新。
 * exclude_unset 语义：只放要改的字段（buildMetadataPatch 负责差量构建）。
 * 键即 CollectionMetadata 的 snake_case 键，与后端 CollectionPatch 一一对应。
 */
export type CollectionPatchPayload = Partial<CollectionMetadata>

/** 编辑表单草稿：list 字段为 string[]，其余为 string，空值归一 '' / []
 *  （toMetadataDraft 生成，buildMetadataPatch 消费）。-? 去掉可选性，草稿字段必填。 */
export type CollectionMetadataDraft = {
  -readonly [K in keyof CollectionMetadata]-?: CollectionMetadata[K] extends string[] | undefined
    ? string[]
    : string
}

/** DELETE /collections/{public_id}/members 响应：removed/skipped 为 public_id 列表，供对账 */
export interface MemberRemovalResult {
  publicId: string
  removed: string[]
  skipped: string[]
}

/**
 * collections 模块的领域错误通道：携带 HTTP 状态码与后端 detail 原文，
 * 供 composable 判定 409（三种成员冲突）/403/404 的细分文案。
 * 不改全局 httpClient。
 */
export interface CollectionApiError extends Error {
  status?: number
  backendMessage: string
}

export function isCollectionApiError(e: unknown): e is CollectionApiError {
  return e instanceof Error && 'backendMessage' in e
}

/** 与 PaginationFooter / buildPageList 对齐的分页元信息（POST /collections/list(_all) 的 meta 原样） */
export interface CollectionListMeta {
  current_page: number
  current_records: number
  total_pages: number
  total_records: number
}


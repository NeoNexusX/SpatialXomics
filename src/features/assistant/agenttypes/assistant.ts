/**
 * assistant 模块的核心类型词汇。
 *
 * 这里是协议中立层：AgentLoop、工具和界面都只认这些类型，
 * 具体协议的请求与响应格式由各适配器插件（plugins/*Adapter.ts）转换。
 */

// ---- 连接 ----

/** 端点协议，决定请求由哪个适配器发出。支持新协议时在这里加一项并注册对应的适配器插件。 */
export type EndpointType = 'anthropic'

/** 解析完成的端点：地址和密钥已确定，还没选模型 */
export interface ResolvedEndpoint {
  endpoint: EndpointType
  /** 规范化后的基地址，末尾带版本段，如 https://api.anthropic.com/v1 */
  baseUrl: string
  apiKey: string
  /** 凭据来自用户设置还是部署默认 */
  source: 'user' | 'deployment'
}

/** 可以直接发请求的连接 */
export interface ResolvedConnection extends ResolvedEndpoint {
  model: string
}

/**
 * 多模态探测结果。
 * - unavailable：端点有回应但测不出结论（配额、下线等），不等于不支持图片
 * - no-response：没拿到完整响应（断网，或页面离开时请求被浏览器取消），不算测过
 */
export type VisionProbeResult = 'vision' | 'no-vision' | 'unavailable' | 'no-response'

// ---- LLM 消息与流式协议 ----

/** assistant 消息的内容块，顺序与模型返回的一致，回传时不能打乱 */
export type AssistantPart =
  | { type: 'text'; text: string }
  | {
      type: 'reasoning'
      text: string
      /** 适配器私有的回放数据（如思考块签名），上层只负责原样保存 */
      replay?: Record<string, unknown>
    }
  | { type: 'tool-call'; id: string; name: string; input: unknown }

export interface UserMessage {
  role: 'user'
  content: string
  /** 附带的图片（多模态）：base64 dataURL（`data:image/png;base64,…`） */
  images?: string[]
}

export interface AssistantMessage {
  role: 'assistant'
  parts: AssistantPart[]
}

export interface ToolMessage {
  role: 'tool'
  toolCallId: string
  name: string
  content: string
  isError?: boolean
}

export type ChatMessage = UserMessage | AssistantMessage | ToolMessage

/** 供 LLM function calling 的 JSON Schema 参数描述 */
export interface JsonSchemaObject {
  type: 'object'
  properties: Record<string, Record<string, unknown>>
  required?: string[]
}

/** 注册进 LLM tools 字段的工具描述 */
export interface ToolSchema {
  name: string
  description: string
  parameters: JsonSchemaObject
}

/**
 * 一次模型调用的结束原因。
 * length = 达到输出上限；refusal = 模型或安全策略拒绝回答。
 */
export type FinishReason = 'stop' | 'tool-calls' | 'length' | 'refusal' | 'error' | 'aborted'

/** LLM 流式输出的统一分块（适配器产出，AgentLoop 消费） */
export type StreamChunk =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | {
      type: 'finish'
      reason: FinishReason
      /** 本次调用完整的内容块（error / aborted 时为空），AgentLoop 据此写入历史 */
      parts: AssistantPart[]
      error?: string
    }

export interface GenerateOptions {
  system?: string
  messages: ChatMessage[]
  tools?: ToolSchema[]
  maxTokens?: number
}

/** LLM 适配器：一种端点协议一个实现，由适配器插件经 ctx.llm.registerAdapter 注册 */
export interface LlmAdapter {
  readonly endpoint: EndpointType
  stream(
    options: GenerateOptions,
    connection: ResolvedConnection,
    signal: AbortSignal,
  ): AsyncIterable<StreamChunk>
  /** 询问端点公布的模型列表，顺序与端点返回的一致；失败时抛错，错误消息可以直接展示 */
  listModels(endpoint: ResolvedEndpoint, signal?: AbortSignal): Promise<string[]>
  /** 发一张小图验证模型能看懂图片 */
  probeVision(connection: ResolvedConnection, signal?: AbortSignal): Promise<VisionProbeResult>
}

// ---- 分析上下文（前端运行时数据的统计摘要，不含原始数组） ----

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

// ---- 技能 ----

/** 技能目录条目（system prompt 只注入目录，正文经 skill 工具按需加载） */
export interface SkillSummary {
  name: string
  description: string
  whenToUse?: string
}

// ---- Agent 状态（composables/UI 层） ----

/** 界面上一条助手消息的内容块，顺序就是实际发生的顺序 */
export type UiPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string; active: boolean }
  | {
      type: 'tool'
      id: string
      name: string
      input: unknown
      state: 'running' | 'done' | 'error' | 'stopped'
      preview: string
    }

/** UI 层对话条目 */
export interface UiChatItem {
  id: string
  role: 'user' | 'assistant'
  /** user 的文字；assistant 所有文字块拼接的结果（复制、持久化、恢复历史都用它） */
  content: string
  /** user 消息附带的图片（base64 dataURL） */
  images?: string[]
  /** assistant 的内容块 */
  parts?: UiPart[]
  /** 流式进行中 */
  pending?: boolean
  /** 被用户中断 */
  interrupted?: boolean
  /** 系统 compact 提示条：渲染为居中分隔行，恢复历史时不回灌模型 */
  compacted?: boolean
  /** 错误态（可重试） */
  error?: string
}

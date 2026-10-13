/**
 * assistant 模块的核心类型词汇。
 *
 * 消息/工具调用类型与 OpenAI chat/completions 对齐（适配器可直接透传），
 * 同时作为 provider 中立层：后续新增其他 LLM 适配器时复用同一套类型。
 */

// ---- LLM 消息与流式协议 ----

/** 一次工具调用（assistant 消息携带；arguments 为未解析的 JSON 文本）。
 *  项目内部统一用扁平形态；OpenAI wire 的嵌套形态
 *  （{id, type:"function", function:{name, arguments}}）由 openaiAdapter
 *  的 toWireMessages 序列化——端点流式响应与本类型互转均在适配器收口。 */
export interface ToolCall {
  id: string
  name: string
  /** JSON 文本（未解析）；解析与校验由 tools 注册表负责 */
  arguments: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  /** assistant 消息：本轮要调用的工具 */
  tool_calls?: ToolCall[]
  /** tool 消息：对应的调用 id */
  tool_call_id?: string
  /** tool 消息：工具名（便于调试与渲染） */
  name?: string
  /** assistant 消息：推理模型的思考过程（reasoning_content）。不回传给 API（OpenAI 兼容端点普遍不收），仅 UI 展示 */
  reasoning?: string
}

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

/** LLM 流式输出的统一分块（适配器产出，agent loop 消费） */
export type StreamChunk =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | {
      type: 'tool-call-delta'
      /** 同一轮内多个工具调用的分片序号 */
      index: number
      id?: string
      name?: string
      argumentsDelta?: string
    }
  | {
      type: 'finish'
      reason: 'stop' | 'tool-calls' | 'error' | 'aborted'
      error?: string
      truncated?: boolean
      /**
       * 本轮是否收到过任何实质增量（text / reasoning / tool-call）。
       * 用于区分「收到一半正文被掐断」（true，按截断处理）与
       * 「只收到空 data 行就被掐断」（false，按端点吐空流处理）。
       */
      receivedContent?: boolean
      /**
       * 适配器已对同一请求做过一次非流式重发（stream:false）且未恢复。
       * 上层（agent loop）据此停止空流重试，避免「流式重试 × 非流式降级」
       * 叠加放大计费调用次数。
       */
      fallbackAttempted?: boolean
    }

export interface GenerateOptions {
  model: string
  messages: ChatMessage[]
  tools?: ToolSchema[]
  temperature?: number
  maxTokens?: number
  /** 预留：Phase 2 迁移后端转发时的扩展字段（sessionId 等） */
  extra?: Record<string, unknown>
}

/** LLM 适配器接口：一种 provider 一个实现，经 ctx.llm.registerAdapter 注册 */
export interface LlmAdapter {
  readonly provider: string
  stream(options: GenerateOptions, signal: AbortSignal): AsyncIterable<StreamChunk>
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
export interface AnnotationRow {
  /** 行 id（get_annotation_detail 用） */
  id: number
  /** 按总分的排名，1 起 */
  rank: number
  /** 第一个候选名（没有候选名时为分子式） */
  name: string
  /** 同分子式的候选化合物（id 为库内编号，如 HMDB0240254；没有为空串） */
  candidates: { id: string; name: string }[]
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
  /** 落在同一个峰上的其他注释 */
  samePeak: { name: string; adduct: string }[]
  /** 已启用但没检出的加合物 */
  missingAdducts: string[]
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

/** UI 层对话条目（比 ChatMessage 多展示态字段） */
export interface UiChatItem {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 推理模型（如 mimo/deepseek-r1）的思考过程；思考中或思考完均可有值 */
  reasoning?: string
  /** 思考进行中（reasoning 仍在增长，content 未开始） */
  reasoningActive?: boolean
  /** 流式进行中 */
  pending?: boolean
  /** 被用户中断 */
  interrupted?: boolean
  /** 连接中途断开：内容已保留但可能不完整 */
  truncated?: boolean
  /** 错误态（可重试） */
  error?: string
  /** 本条目产生期间发生的工具调用记录（折叠卡展示） */
  toolCalls?: { name: string; isError: boolean; preview: string }[]
}

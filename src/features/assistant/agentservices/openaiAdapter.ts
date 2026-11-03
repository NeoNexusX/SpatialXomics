/**
 * OpenAI 兼容的 LLM 适配器（fetch + SSE 流式）。
 *
 * 实现 {@link LlmAdapter} 接口，手写 SSE 解析（不引依赖），
 * 流式 tool_calls delta 按 index 合并为完整 ToolCall 后产出。
 *
 * 凭据解析单点收口在 resolve* 三函数，优先级：**用户自配（BYOK，localStorage）
 * → 部署 env 默认（VITE_LLM_*）**；均未配置时 send 前置检查会拦下并引导用户去设置。
 */

import { parseSseStream } from './sseParser'
import type {
  ChatMessage,
  GenerateOptions,
  LlmAdapter,
  StreamChunk,
  ToolCall,
} from '../agenttypes/assistant'
import { ENV } from '@/shared/config/env'
import { getConfig } from '@/shared/config/runtimeConfig'
import { loadUserLlmConfig } from '../agentconfig/userLlmConfig'

/** dev 同源转发目标（stream 与 testLlmConnection 共用的单一实现） */
export interface DevRelayTarget {
  /** 转发路径（/llm-relay… 或 /llm-proxy…） */
  url: string
  /** 真实目标 origin（仅 BYOK relay 需要；/llm-proxy 目标固定，无需 header） */
  targetOrigin?: string
}

/**
 * dev 环境的浏览器→dev server 同源转发。
 * 直连外部端点会被本机系统代理拦截（Clash 等对部分地址转发 502，SSE 长流被掐断），
 * 请求根本出不去；dev 下改经 vite 的 node 端转发：
 * - env 默认端点 → /llm-proxy（固定目标）
 * - BYOK 端点 → /llm-relay/<原路径>，真实 origin 放 x-llm-target header
 * 返回 null = 无需转发（生产 / 同源 / 未配置），直接用原 URL。
 * userBaseUrl 供设置面板用「未保存的表单值」测试连通性；缺省读已保存配置。
 */
export function devRelayTarget(
  target: string,
  userBaseUrl?: string,
): DevRelayTarget | null {
  if (!import.meta.env.DEV) return null
  try {
    const u = new URL(target)
    if (u.origin === window.location.origin) return null
    // 用户自配（BYOK）走通用 relay；未自配时 env 端点走固定 /llm-proxy
    const byok = userBaseUrl ?? loadUserLlmConfig().baseUrl
    if (byok) return { url: `/llm-relay${u.pathname}${u.search}`, targetOrigin: u.origin }
    if (ENV.llmProxyUrl) return { url: `/llm-proxy${u.pathname}${u.search}` }
    return null
  } catch {
    return null
  }
}

/** 直连端点（不含 dev 转发）：用户自配 baseUrl → env llmProxyUrl，末尾斜杠归一化后拼 /chat/completions */
function directEndpoint(): string {
  return `${(loadUserLlmConfig().baseUrl || ENV.llmProxyUrl).replace(/\/+$/, '')}/chat/completions`
}

/** resolveEndpoint() 的产物：一次解析同时给出请求 URL、转发头与错误提示地址 */
export interface ResolvedEndpoint {
  /** fetch 实际请求的 URL（dev 下为同源转发路径） */
  url: string
  /** dev 转发的目标 origin（随请求头 x-llm-target 带上；直连时缺省） */
  relayTargetOrigin?: string
  /** 直连绝对地址（供错误提示；dev 下也是真实目标而非转发路径） */
  absolute: string
}

/** 单点端点解析：直连地址 + dev 同源转发（见 devRelayTarget）。stream 与测试共用。 */
export function resolveEndpoint(): ResolvedEndpoint {
  const absolute = directEndpoint()
  const relay = devRelayTarget(absolute)
  return { url: relay?.url ?? absolute, relayTargetOrigin: relay?.targetOrigin, absolute }
}

/** 单点 API Key 解析：用户自配 → env */
export function resolveApiKey(): string {
  return loadUserLlmConfig().apiKey || ENV.llmApiKey
}

/** 单点模型名解析：用户自配 → 运行时 config.json llm 块 → env 默认 */
export function resolveModel(defaultModel?: string): string {
  const user = loadUserLlmConfig().model
  if (user) return user
  return getConfig().llm?.model || defaultModel || ENV.llmModel || 'deepseek-chat'
}

/**
 * 用户未自配 model 时的部署级默认链：config.json llm 块 → env → 内置兜底。
 * 供 testLlmConnection 等旁路探测复用，保持与真实请求（resolveModel）同一优先级，
 * 避免「测试连接」探测的模型与实际发送的模型不一致（config.json 配了 model、
 * 用户留空时，测试会误打 deepseek-chat 并报 404/400）。
 */
export function resolveDefaultModel(): string {
  return getConfig().llm?.model || ENV.llmModel || 'deepseek-chat'
}

/**
 * 是否有可用配置（地址与密钥均非空，无论来自用户还是 env）。agentLoop send 前置检查用。
 */
export function isLlmConfigured(): boolean {
  const user = loadUserLlmConfig()
  const base = user.baseUrl || ENV.llmProxyUrl
  const key = user.apiKey || ENV.llmApiKey
  return base !== '' && key !== ''
}

/**
 * 把底层 HTTP/网络错误翻译成用户可读的提示（BYOK 下用户自填的地址/密钥出错很常见）。
 * 原始状态码保留在消息里，方便排查。
 */
export function humanizeHttpError(status: number, body: string): string {
  // 从错误体里尽量抠出上游 message（OpenAI 兼容格式 {"error":{"message":...}}）
  let upstream = ''
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } }
    upstream = parsed.error?.message || ''
  } catch {
    /* 非 JSON 错误体，忽略 */
  }
  const tail = upstream ? `: ${upstream}` : ''
  if (status === 401 || status === 403) return `API key rejected (HTTP ${status})${tail}`
  if (status === 404) return `Endpoint not found (HTTP 404) — check the API Base URL${tail}`
  if (status === 429) return `Rate limited (HTTP 429)${tail}`
  if (status >= 500) return `LLM provider error (HTTP ${status})${tail}`
  return `HTTP ${status}${tail}`
}

/**
 * 把模型流式回传的工具名清洗成 OpenAI 兼容端点普遍接受的形态
 * （^[a-zA-Z0-9_-]{1,64}$）。模型偶发在 name 里带换行/空白/点号/中文，或
 * 干脆漏发——原样回喂历史会被严格校验的网关 400（GLM/MiMo 等还会把报错
 * 路径整体打码成 "Invalid request body: ***.***.***.name"，折叠兜底认不出），
 * 且历史持久化后本会话每轮都炸。清洗幂等：已合法的名字原样通过。
 */
export function sanitizeToolName(name: string | undefined | null): string {
  const cleaned = (name ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
  return cleaned || 'unknown_tool'
}

/**
 * 识别「端点不接受 role:"tool" 消息」的 400 错误体。这类严格端点支持 tools 参数
 * （第一轮能正常返回 tool_calls），但对消息角色的校验只认 system/user/assistant，
 * 工具结果用 role:"tool" 回喂时被枚举报错拒绝（pydantic 风格 "Input should be
 * 'system', 'user' or 'assistant'"，或 "supported roles"/"must be one of" 等措辞）。
 * 要求三个基础角色同时出现、且错误信息未把 tool 列为合法值，避免误伤其他 400。
 */
export function rejectsToolRole(body: string): boolean {
  const t = body.toLowerCase()
  if (!/input should be|must be one of|supported roles|should be one of/.test(t)) return false
  if (!t.includes('user') || !t.includes('assistant') || !t.includes('system')) return false
  return !t.includes(`'tool'`) && !t.includes(`"tool"`)
}

/**
 * 把 role:"tool" 的工具结果消息折叠成 user 消息：内容包进带 tool_call_id 与工具
 * 名的 <tool_response> 文本标签，模型凭前一条 assistant.tool_calls 对应回自己的
 * 调用。供只认 system/user/assistant 三角色的严格端点使用（stream 内 400 自动
 * 重试），其余消息原样保留。
 */
export function foldToolMessagesToUser(
  messages: GenerateOptions['messages'],
): GenerateOptions['messages'] {
  return messages.map((m) => {
    if (m.role !== 'tool') return m
    const attrs = [`tool_call_id="${m.tool_call_id ?? ''}"`]
    if (m.name) attrs.push(`name="${m.name}"`)
    return {
      role: 'user',
      content: `<tool_response ${attrs.join(' ')}>\n${m.content ?? ''}\n</tool_response>`,
    }
  })
}

/**
 * 识别「端点/模型不接受图片」的 400 错误体。非 vision 模型（deepseek-chat 等）
 * 收到 image_url content-parts 时报 400，常见措辞：
 * - "image_url is not supported" / "does not support image"
 * - "Invalid content type: image_url"（OpenAI 端点对非 vision 模型的报错形态）
 * - "multimodal" / "vision" 相关的不支持表述
 * 要求错误体同时提到 image（或 multimodal/vision），避免误伤普通校验 400。
 */
export function rejectsImages(body: string): boolean {
  const t = body.toLowerCase()
  if (!/image|multimodal|vision/.test(t)) return false
  if (/image_url|image content|content type.*image|input_image|image input/.test(t)) return true
  return /not support|unsupported|invalid|not accept/.test(t)
}

/**
 * 剥离消息里的图片：带图 user 消息的 content 改为「文字 + 图片已省略提示」。
 * 供 rejectsImages 命中后的无图重试——纯文字部分保留，模型仍能回答文字问题。
 */
export function stripImages(
  messages: GenerateOptions['messages'],
): GenerateOptions['messages'] {
  return messages.map((m) => {
    if (m.role !== 'user' || !m.images?.length) return m
    const note = m.images.length > 1 ? `[${m.images.length} images omitted]` : '[image omitted]'
    return {
      ...m,
      images: undefined,
      content: m.content ? `${m.content}\n${note}` : note,
    }
  })
}

/**
 * 识别「端点拒绝历史里的结构化 tool_calls」的 400 错误体。这类端点带一层
 * OpenAI → Claude/Gemini 风格的转换层：能正常**发出** tool_calls（出站函数
 * 调用没问题），但把历史里回喂的 assistant.tool_calls 翻译成 content 块时
 * 丢失 name——典型报错 "missing messages[i].content[j].name parameter" /
 * "content.1.name: Field required"。另有一类报错路径直接落在 tool_calls 上
 * （"messages.2.tool_calls.0.function.name: Field required" 等），同样只能靠
 * 内联文本兜底。历史调用必须改以内联文本发送。
 */
export function strictToolCallsError(body: string): boolean {
  const t = body.toLowerCase()
  if (/content.*\.name/.test(t)) return true
  // 第四种形态：错误路径落在 tool_calls 上（"messages.2.tool_calls.0.function.name:
  // Field required" / "tool_calls.0.name: Extra inputs are not permitted"）。
  // wire 已按规范嵌套后仍报此错的端点，说明其转换层对结构化 tool_calls 有硬伤，
  // 同样只能靠内联文本兜底。匹配点限定 tool_calls 路径，不误伤 tools 数组的
  // function.name 报错（那是工具定义问题，折叠解决不了）。
  if (/tool_calls.*\.name/.test(t)) return true
  // 第五种形态：网关把校验失败的字段路径整体打码（用户实测的
  // "Invalid request body: ***.***.***.name"）——打码后无法区分是 tools
  // 定义还是历史 tool_calls 的 name。历史里有结构化工具信息时（stream 内
  // 的 hasStructured 闸门）值得折叠重试一次；若真是 tools 数组自身的报错，
  // 折叠后重发同样 400，代价只是一次多余请求。
  if (/invalid request body/.test(t) && /\*[^ ]*\.name\b/.test(t)) return true
  return /missing|field required/.test(t) && t.includes('content') && t.includes('name')
}

/**
 * 把 assistant 消息里的结构化 tool_calls 折叠成内联文本：每次调用包进带 id 与
 * 工具名的 <tool_call> 标签追加到 content（原 content 保留在前），并去掉
 * tool_calls 字段本身。与 foldToolMessagesToUser 配套使用——历史里的调用与
 * 结果都变成纯文本后，转换层无结构可翻译，name 不会再丢。
 */
export function inlineToolCalls(
  messages: GenerateOptions['messages'],
): GenerateOptions['messages'] {
  return messages.map((m) => {
    if (m.role !== 'assistant' || !m.tool_calls?.length) return m
    const calls = m.tool_calls
      .map((tc) => `<tool_call id="${tc.id}" name="${tc.name}">${tc.arguments}</tool_call>`)
      .join('\n')
    return {
      role: 'assistant',
      content: m.content ? `${m.content}\n${calls}` : calls,
    }
  })
}

/** 严格端点全量折叠：tool 结果 → user 文本消息 + assistant.tool_calls → 内联文本 */
function foldForStrictEndpoint(
  messages: GenerateOptions['messages'],
): GenerateOptions['messages'] {
  return inlineToolCalls(foldToolMessagesToUser(messages))
}

/**
 * 会话级「严格端点兼容」开关：首次识别到严格端点（拒 role:"tool" 或拒结构化
 * tool_calls 的 400）后置位，本页面会话内后续请求直接以全量折叠形态首发，不再
 * 逐个 400 探测。刷新页面后归零（对新端点重新探测一次）。
 */
let strictCompatSession = false

/**
 * 会话级「端点拒 tools 数组」开关：折叠历史后仍被工具签名 400 拒、或首轮
 * 纯文本历史就打码 400（无处折叠）时置位——本页面会话直接以无 tools 形态
 * 首发，函数调用降级为纯对话（模型凭折叠后的内联文本历史继续）。
 */
let toolsBlockedSession = false

/**
 * 会话级「模型不吃图片」开关：首次识别到拒图 400（rejectsImages）后置位，
 * 本页面会话内后续请求直接剥离 images 首发，不再每轮 400 探测。置位事件
 * 同时通知 agentLoop 清理持久历史里的 images（见 imagesRejected 回调）。
 */
let imagesBlockedSession = false

/** 拒图 400 识别后的一次性回调（agentLoop 注册，用于清理持久历史） */
let onImagesRejected: (() => void) | null = null

/** 测试隔离用：重置会话级兼容开关 */
export function resetStrictCompatForTests(): void {
  strictCompatSession = false
  toolsBlockedSession = false
  imagesBlockedSession = false
  onImagesRejected = null
}

/**
 * agentLoop 注册拒图回调：openaiAdapter 识别出「模型不吃图片」的 400 时调用。
 * agentLoop 借此把持久 history 里 user 消息的 images 清掉——否则带图消息
 * 留在历史里，之后每条纯文字提问都重发同一张图，会话每轮 400 直到清空。
 */
export function setOnImagesRejected(cb: (() => void) | null): void {
  onImagesRejected = cb
}

/**
 * 只保留 OpenAI 兼容端点认识的消息字段（按 role 白名单）。
 * ChatMessage 上的 UI 专用字段（reasoning / tool.name 等）不能上 wire——
 * 严格端点（OpenAI 本家、Azure、部分网关）对 assistant 消息里的未知字段直接 400。
 */
function toWireMessages(messages: GenerateOptions['messages']): Array<Record<string, unknown>> {
  return messages.map((m) => {
    // content null → 空串：纯工具调用轮的 assistant 消息 content 为 null（OpenAI
    // 本家收 null），但个别严格端点要求 content 必须是字符串（pydantic
    // "Input should be a valid string"）。空串对全兼容端点同样合法。
    if (m.role === 'assistant') {
      const wire: Record<string, unknown> = { role: m.role, content: m.content ?? '' }
      // 历史里的 ToolCall 是扁平形态（id/name/arguments），wire 上必须是 OpenAI 的
      // 嵌套形态 {id, type:"function", function:{name, arguments}}——扁平直发会被
      // pydantic 严格端点 400（"Invalid request body: messages[i].tool_calls[j].name /
      // ….function.name: Extra inputs / Field required"）。
      // name 一律过 sanitizeToolName：agentLoop 已在入史前清洗，这里是兜底——
      // localStorage 里恢复的旧历史可能还带着脏 name，原样上 wire 会把整个会话炸掉。
      if (m.tool_calls) {
        wire.tool_calls = m.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: sanitizeToolName(tc.name), arguments: tc.arguments },
        }))
      }
      return wire
    }
    if (m.role === 'tool') {
      return { role: m.role, content: m.content ?? '', tool_call_id: m.tool_call_id }
    }
    // 多模态 user 消息：带图片时改用 OpenAI content-parts（text + image_url）。
    // 图片一律是 base64 dataURL（前端 FileReader 读取），直接放进 image_url.url。
    if (m.role === 'user' && m.images && m.images.length > 0) {
      const parts: Array<Record<string, unknown>> = []
      if (m.content) parts.push({ type: 'text', text: m.content })
      for (const url of m.images) {
        parts.push({ type: 'image_url', image_url: { url } })
      }
      return { role: m.role, content: parts }
    }
    return { role: m.role, content: m.content ?? '' }
  })
}

/** 组装 OpenAI 兼容的请求体 */
function buildOpenAiBody(
  options: GenerateOptions,
  stream = true,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: toWireMessages(options.messages),
    stream,
  }
  if (options.temperature != null) body.temperature = options.temperature
  if (options.maxTokens != null) body.max_tokens = options.maxTokens
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))
    // 个别 OpenAI 兼容端点要求显式 tool_choice 才启用函数调用（缺省 auto）
    body.tool_choice = 'auto'
  }
  return body
}

// ---- 非流式降级重试（见 stream 尾部的触发条件） ----

/** 非流式重发解析出的 assistant 回复 */
interface NonStreamReply {
  content: string
  reasoning: string
  toolCalls: ToolCall[]
}

/**
 * 非流式重发同一请求（stream:false）。
 *
 * 触发场景：中转的 SSE 转发实现只透传 content/reasoning_content，把 tool_calls
 * 增量弄丢（finish_reason 为 tool_calls 却没收到任何增量），或整条流为空。
 * 非流式响应是一次性完整 JSON，tool_calls 是整体字段，SSE 转发缺陷影响不到它。
 *
 * 任何失败（网络/非 2xx/非 JSON/结构异常）一律返回 null——保持原流式结果的
 * 语义不变，交由上层（agentLoop 的空流重试 / noData 报错）继续兜底。
 */
async function tryNonStreamFallback(
  url: string,
  apiKey: string,
  relayOrigin: string | undefined,
  options: GenerateOptions,
  signal: AbortSignal,
): Promise<NonStreamReply | null> {
  const body = buildOpenAiBody(options, false)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(relayOrigin ? { 'x-llm-target': relayOrigin } : {}),
      },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) return null
    // SPA fallback / 非 API 地址会 200 回 HTML——只接受 JSON
    if (!/application\/json/i.test(res.headers.get('content-type') || '')) return null
    const parsed = (await res.json()) as any
    const msg = parsed?.choices?.[0]?.message
    if (!msg) return null
    const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((tc: any, i: number) => ({
      id: tc.id || `call_fallback_${Date.now()}_${i}`,
      name: sanitizeToolName(tc.function?.name),
      arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : '{}',
    }))
    return {
      content: typeof msg.content === 'string' ? msg.content : '',
      reasoning: typeof msg.reasoning_content === 'string' ? msg.reasoning_content : '',
      toolCalls,
    }
  } catch {
    return null
  }
}

/**
 * 流式 tool_calls delta 合并器。
 * 每个 index 的 delta 分片到来时累积；id/name 只取首次非空值。
 */
class ToolCallMerger {
  private pending = new Map<number, { id?: string; name?: string; args: string }>()

  feed(index: number, delta: { id?: string; name?: string; arguments?: string }): StreamChunk {
    let entry = this.pending.get(index)
    if (!entry) {
      entry = { id: undefined, name: undefined, args: '' }
      this.pending.set(index, entry)
    }
    if (delta.id) entry.id = delta.id
    if (delta.name) entry.name = delta.name
    if (delta.arguments) entry.args += delta.arguments

    return {
      type: 'tool-call-delta',
      index,
      id: delta.id,
      name: delta.name,
      argumentsDelta: delta.arguments,
    }
  }

  /** 是否有未终结的工具调用 */
  get hasPending(): boolean {
    return this.pending.size > 0
  }
}

/**
 * OpenAI 兼容适配器。
 *
 * 用法：
 * ```ts
 * ctx.llm.registerAdapter('openai', new OpenAIAdapter())
 * ```
 */
export const openaiAdapter: LlmAdapter = {
  provider: 'openai-compatible',

  async *stream(options: GenerateOptions, signal: AbortSignal): AsyncIterable<StreamChunk> {
    const apiKey = resolveApiKey()
    const model = resolveModel(options.model)

    const merged: GenerateOptions = {
      ...options,
      model,
    }

    // dev 代理转发：/llm-relay 需要 x-llm-target（目标 origin，无路径）
    const { url: fetchUrl, relayTargetOrigin, absolute } = resolveEndpoint()

    /** 实际上行的消息与工具：400 梯子降级后更新（非流式降级共用同一份）；
     *  会话内已识别过严格端点 / tools 被拒 / 模型拒图则直接以对应形态首发，
     *  省探测往返 */
    let wireMessages = strictCompatSession
      ? foldForStrictEndpoint(merged.messages)
      : merged.messages
    let wireTools = toolsBlockedSession ? undefined : merged.tools
    if (imagesBlockedSession) wireMessages = stripImages(wireMessages)
    const send = () =>
      fetch(fetchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...(relayTargetOrigin ? { 'x-llm-target': relayTargetOrigin } : {}),
        },
        body: JSON.stringify(
          buildOpenAiBody({ ...merged, messages: wireMessages, tools: wireTools }),
        ),
        signal,
      })

    /**
     * 400 终态：按原状态码/头重建响应（body 已读），并把上游错误与被拒的请求体
     * 打进 console——网关把校验路径整体打码成 "Invalid request body: ***.***.***.name"
     * 后无从定位真凶字段，日志里有完整上行体才查得下去。
     */
    const surface400 = async (res: Response): Promise<Response> => {
      const text = await res.text()
      console.error(
        '[assistant] LLM 400 not recovered — upstream error:',
        text,
        'request body:',
        JSON.stringify(
          buildOpenAiBody({ ...merged, messages: wireMessages, tools: wireTools }),
        ).slice(0, 4000),
      )
      return new Response(text, { status: res.status, headers: res.headers })
    }

    let response: Response
    try {
      response = await send()
      // 400 恢复梯子：先查图片降级（非 vision 模型对 image_url 一律 400，
      // 且不剥离重试的话带图消息留在历史里会让整个会话每轮 400），再走工具
      // 流量的两级降级，每级只重试一次并置位会话开关（本页面会话后续请求
      // 直接以终态首发）：
      // 图片级（剥图）：rejectsImages 命中且上行带图 → stripImages 重发。
      //   纯文字部分保留，模型仍能回答文字问题；同时置位 imagesBlockedSession
      //   并回调 agentLoop 清理持久历史里的 images。
      // 工具一级（折叠）：个别 OpenAI 兼容端点支持 tools 参数（第一轮能正常返回
      //   tool_calls），但历史里的结构化工具消息回喂时 400——拒 role:"tool"（角色
      //   枚举只认 system/user/assistant）、拒 content:null（已在 toWireMessages
      //   兜成空串）、拒 assistant.tool_calls（转换层翻成 content 块时丢 name，
      //   含路径被打码的 "Invalid request body: ***.***.***.name" 形态）。
      //   全量折叠成纯文本重发。
      // 工具二级（弃 tools）：折叠后仍 400、或首轮纯文本历史无处折叠就 400——
      //   说明拒的多半是 tools 数组本身，唯一出路是不带 tools/tool_choice 重发，
      //   函数调用降级为纯对话（模型凭内联文本历史继续）。
      // 错误体签名（rejectsImages / rejectsToolRole / strictToolCallsError）都不
      // 匹配的 400 不属于已知兼容问题，原样透传；降级用尽仍 400 也透传
      // （surface400 附诊断日志）。
      for (let level = 0; level < 3; level++) {
        if (response.status !== 400) break
        const errText = await response.text()
        // 图片降级：上行带图且错误签名命中（或会话开关已置位但历史里又混入了
        // 新图——防御性再剥一次）
        const hasImages = wireMessages.some((m) => (m as ChatMessage).images?.length)
        if (hasImages && (rejectsImages(errText) || imagesBlockedSession)) {
          if (!imagesBlockedSession) {
            imagesBlockedSession = true
            console.warn(
              '[assistant] LLM model rejected images — retrying without image parts ' +
                '(multimodal disabled for this page session)',
            )
            try {
              onImagesRejected?.()
            } catch {
              /* 回调失败不影响降级重试 */
            }
          }
          wireMessages = stripImages(wireMessages)
          response = await send()
          continue
        }
        if (!rejectsToolRole(errText) && !strictToolCallsError(errText)) {
          response = new Response(errText, { status: response.status, headers: response.headers })
          break
        }
        const hasStructured = wireMessages.some(
          (m) => m.role === 'tool' || (m.tool_calls?.length ?? 0) > 0,
        )
        if (hasStructured && !strictCompatSession) {
          strictCompatSession = true
          wireMessages = foldForStrictEndpoint(wireMessages)
        } else if (wireTools && (merged.tools?.length ?? 0) > 0) {
          toolsBlockedSession = true
          wireTools = undefined
          console.warn(
            '[assistant] LLM endpoint keeps rejecting tool traffic — retrying without the ' +
              'tools array (function calling disabled for this page session)',
          )
        } else {
          response = new Response(errText, { status: response.status, headers: response.headers })
          break
        }
        response = await send()
      }
      if (response.status === 400) response = await surface400(response)
    } catch (err) {
      if (signal.aborted) {
        yield { type: 'finish', reason: 'aborted' }
        return
      }
      // fetch 抛异常 = 请求根本没到对端（地址错 / DNS 失败 / 浏览器 CORS 拦截）
      yield {
        type: 'finish',
        reason: 'error',
        error: `Cannot reach ${absolute} — check the API Base URL, and that the endpoint allows browser (CORS) access. (${(err as Error)?.message || 'network error'})`,
      }
      return
    }

    const merger = new ToolCallMerger()
    let finishReason: 'stop' | 'tool-calls' = 'stop'
    /** SSE 层检测到连接中途断开（已收部分数据） */
    let streamTruncated = false
    /** 是否收到过任何实质增量（text / reasoning / tool-call），区别于仅有空 data 行 */
    let receivedContent = false

    // 流式响应本应是 text/event-stream；若拿到 HTML（SPA fallback 把 API 路径
    // 回退成 index.html，BYOK 地址指错时常见），直接报可读错误而非空白。
    // 只对 HTML 硬报错——个别兼容端点/代理会以 text/plain 甚至不带 content-type
    // 回 SSE 流，照常交给解析器，不要拦。
    const contentType = response.headers.get('content-type') || ''
    if (response.ok && /text\/html/i.test(contentType)) {
      yield {
        type: 'finish',
        reason: 'error',
        error:
          `Endpoint returned ${contentType || 'non-SSE content'} instead of an LLM stream. ` +
          `The Base URL likely points at a website, not an API — try appending /v1 (e.g. https://host/v1).`,
      }
      return
    }

    for await (const event of parseSseStream(response, signal)) {
      if (event.kind === 'error') {
        if (signal.aborted) {
          yield { type: 'finish', reason: 'aborted' }
          return
        }
        const message =
          event.status != null
            ? humanizeHttpError(event.status, event.body || '')
            : event.message
        yield { type: 'finish', reason: 'error', error: message }
        return
      }
      if (event.kind === 'done') {
        if (event.truncated) streamTruncated = true
        break
      }
      if (event.kind !== 'data') continue

      try {
        const parsed = JSON.parse(event.data)
        const choice = parsed.choices?.[0]
        if (!choice) continue

        // finish_reason 必须先于 delta 判空读取：部分中转的收尾 chunk 不带
        // delta 字段（{"choices":[{"finish_reason":"tool_calls"}]}），若先
        // continue 会把 tool_calls 收尾信号整个丢掉，finishReason 停在 stop。
        if (choice.finish_reason) {
          finishReason = choice.finish_reason === 'tool_calls' ? 'tool-calls' : 'stop'
        }

        // 部分中转不在 delta 里给增量，而是把完整 message 放进 chunk
        // （非标准但常见）；delta 优先，message 兜底。
        const delta = choice.delta ?? choice.message
        if (!delta) continue

        // 文本增量
        if (delta.content) {
          receivedContent = true
          yield { type: 'text-delta', text: delta.content }
        }

        // 思考增量（DeepSeek-R1 / mimo 等 reasoning 模型）。
        // 这些模型会先流出大段 reasoning_content 再出正文；不转发的话
        // UI 在思考期间（可达几十秒）完全没有反馈。
        if ((delta as { reasoning_content?: string }).reasoning_content) {
          receivedContent = true
          yield {
            type: 'reasoning-delta',
            text: (delta as { reasoning_content?: string }).reasoning_content!,
          }
        }

        // 工具调用增量（按 index 合并）
        if (delta.tool_calls) {
          receivedContent = true
          for (const [i, tc] of delta.tool_calls.entries()) {
            // 完整 message 形态没有 index 字段，按数组序号归位——一律落 0 会把
            // 同一消息里的多个调用拼成一个（参数串成非法 JSON）
            const idx = typeof tc.index === 'number' ? tc.index : i
            yield merger.feed(idx, {
              id: tc.id,
              name: tc.function?.name,
              arguments: tc.function?.arguments,
            })
          }
        }

        // usage 字段忽略：当前没有消费方（计入 token 统计时再放开）
      } catch {
        // 跳过无法解析的 data 行
      }
    }

    // 如果流被 abort 提前终止
    if (signal.aborted) {
      yield { type: 'finish', reason: 'aborted' }
      return
    }

    // ---- 非流式降级重试 ----
    // 两种触发条件，均指向「中转的 SSE 转发有缺陷」而非模型没打算调工具：
    // 1. finish_reason 是 tool_calls，却没收到任何 tool-call 增量（增量被丢）
    // 2. 请求带 tools 但整条流没收到任何实质内容（流式静默失败）
    // 重发 stream:false——非流式 JSON 里 tool_calls 是完整字段，绕开转发缺陷。
    const toolCallsLost =
      finishReason === 'tool-calls' && !merger.hasPending && !streamTruncated
    const emptyStreamWithTools = !receivedContent && !streamTruncated && !!options.tools?.length
    const fallbackEligible = (toolCallsLost || emptyStreamWithTools) && !signal.aborted

    if (fallbackEligible) {
      const reply = await tryNonStreamFallback(
        fetchUrl,
        apiKey,
        relayTargetOrigin,
        // 与流式路径同一份上行消息与工具：400 梯子降级过的话，降级也走同一形态
        { ...merged, messages: wireMessages, tools: wireTools },
        signal,
      )
      if (reply) {
        // 与流式路径一致地补发增量：先 reasoning，再 content，再 tool-call 增量。
        // toolCallsLost 场景正文/思考可能已流式送达——重发会把同一份内容吐两遍，
        // 只补发缺失的工具调用；空流场景（receivedContent=false）才补发全文。
        const contentAlreadyStreamed = receivedContent
        if (!contentAlreadyStreamed && reply.reasoning) {
          yield { type: 'reasoning-delta', text: reply.reasoning }
        }
        if (!contentAlreadyStreamed && reply.content) {
          yield { type: 'text-delta', text: reply.content }
        }
        if (reply.toolCalls.length > 0) {
          finishReason = 'tool-calls'
          for (let i = 0; i < reply.toolCalls.length; i++) {
            yield {
              type: 'tool-call-delta',
              index: i,
              id: reply.toolCalls[i]!.id,
              name: reply.toolCalls[i]!.name,
              argumentsDelta: reply.toolCalls[i]!.arguments,
            }
          }
        } else {
          finishReason = 'stop'
        }
        yield { type: 'finish', reason: finishReason, truncated: false, receivedContent: true }
        return
      }
      // 降级也失败 → 如实上报 fallbackAttempted：同一请求已完整重发过一次仍
      // 拿不到内容，上层据此收敛空流重试，避免「流式重试 × 非流式降级」叠加
    }

    // 中断流：已有内容有效，但标记 truncated 让 agent loop 丢弃残缺工具调用。
    // receivedContent 让上层区分「收到一半被掐断」与「只收到空 data 行就被掐断」。
    yield {
      type: 'finish',
      reason: finishReason,
      truncated: streamTruncated,
      receivedContent,
      fallbackAttempted: fallbackEligible,
    }
  },
}
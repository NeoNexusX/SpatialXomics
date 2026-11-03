/**
 * Agent loop 插件：turn / step 循环、abort、事件发射、system prompt 组装。
 *
 * 注入 ctx.agent 服务。每个 turn 包括多个 step（一次 LLM + 可能工具调用），
 * 通过 cordis 事件（assistant/*）向 Vue 层广播状态变化。
 *
 * 历史的约定（各家端点对思考块的要求都依赖它）：
 * - assistant 消息按模型返回的顺序完整保存内容块，思考块从不丢弃，每次请求原样回传；
 *   端点的差异由适配器处理。
 * - 回合内只追加、system 与 tools 固定。裁剪和压缩都在回合边界做。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  AssistantMessage,
  AssistantPart,
  ChatMessage,
  GenerateOptions,
  StreamChunk,
  ToolMessage,
} from '../agenttypes/assistant'
import type { ToolCategory } from '../tools/defineTool'
import { MAX_AGENT_STEPS, TOOL_RESULT_CHARS, TOOL_STUB_KEEP, TOOL_PREVIEW_CHARS, HISTORY_CHAR_BUDGET, COMPACT_TRIGGER_CHARS, COMPACT_SUMMARY_MAX_TOKENS, IMAGE_HISTORY_COST } from '../agentconfig/defaults'
import { writeArchive } from '../utils/opfsStore'
import { buildDatasetOverview } from '../providers/analysisContext'
import { renderDataset } from '../tools/frontendContextTools'
import { t } from '@/i18n'

// ---- 声明服务键 ----

declare module '@deepseek-ai/cordis' {
  interface Context {
    agent: AgentLoop
  }
  /** 本项目自定义事件（assistant/*）逐个显式合并进官方 Events 接口，
   *  emit/on/parallel 的 keyof Events 泛型即可获得完整类型检查。
   *  注意：不要改成 [key: string] 宽索引签名——那会让全项目所有事件名
   *  （含 cordis internal/*）失去拼写检查，事件名 typo 会静默通过编译。 */
  interface Events extends AgentEvents {}
}

// ---- 事件类型（合并进 cordis Events，供 emit/on/parallel 强类型校验） ----

export interface AgentEvents {
  /** turn 开始 */
  'assistant/turn-start': () => void
  /** 新 step 开始 */
  'assistant/step': (step: number) => void
  /** 流式文本增量 */
  'assistant/message-delta': (text: string) => void
  /** 思考流增量 */
  'assistant/reasoning-delta': (text: string) => void
  /** 工具调用开始 */
  'assistant/tool-call': (id: string, name: string, input: unknown) => void
  /** 工具调用结果 */
  'assistant/tool-result': (id: string, isError: boolean, preview: string) => void
  /** 助手消息完成 */
  'assistant/message-done': (message: AssistantMessage) => void
  /** turn 结束 */
  'assistant/turn-end': (aborted: boolean) => void
  /** 历史 compact 完成（摘要替换了旧历史）。参数：压缩前字符总量、摘要长度 */
  'assistant/compacted': (beforeChars: number, afterChars: number) => void
  /** 错误 */
  'assistant/error': (message: string) => void
}

type StepFinish = Extract<StreamChunk, { type: 'finish' }>

/** assistant 消息的正文（不含思考和工具调用） */
export function assistantText(message: AssistantMessage): string {
  return message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
}

// ---- AgentLoop 服务 ----

export class AgentLoop extends Service {
  /** 当前 turn 的 AbortController */
  private abortController: AbortController | null = null
  /** 当前 turn 的对话历史（不含 system/context） */
  private history: ChatMessage[] = []

  constructor(ctx: Context) {
    super(ctx, 'agent')
  }

  /**
   * 发送 user 消息，启动一个 turn。
   * 不注入任何数据快照——页面状态一律由模型按需调用 get_page_state 等
   * 工具实时读取（避免历史中残留过时快照，且兼容纯工具调用模型）。
   * @param images 多模态：附带的图片 base64 dataURL
   */
  async send(userText: string, images?: string[]): Promise<void> {
    if (this.abortController) {
      // 已有进行中的 turn → 先 abort
      this.stop()
      // 等待一小段时间让上一个 turn 彻底结束
      await new Promise((r) => setTimeout(r, 50))
    }

    // 没有可用连接时不发起请求，走正常错误事件流（turn-start → error → turn-end），
    // 让 UI 出可重试的错误提示
    if (!this.ctx.connection.current()) {
      this.ctx.emit('assistant/turn-start')
      this.ctx.emit('assistant/error', t('common.assistant.noApiConfigured'))
      this.ctx.emit('assistant/turn-end', false)
      return
    }

    this.abortController = new AbortController()
    const signal = this.abortController.signal

    this.ctx.emit('assistant/turn-start')

    try {
      const userMsg: ChatMessage = { role: 'user', content: userText }
      if (images && images.length > 0) userMsg.images = images
      this.closeInterruptedToolCalls()
      // 自动 Compact（先于新 user 入列——此刻历史尾部必是完整消息边界；
      // compact 把整段旧历史换成「标记 user + 摘要 assistant」，
      // 失败静默降级走下方 trimHistory 兜底）
      await this.maybeCompact(signal)
      this.history.push(userMsg)
      // 裁剪历史（只在回合边界做）
      await this.trimHistory()

      await this.runSteps(signal)

      // 正常结束（aborted 时 runSteps 正常 return，此处统一收口）
      this.ctx.emit('assistant/turn-end', signal.aborted)
    } catch (err: any) {
      if (signal.aborted) {
        this.ctx.emit('assistant/turn-end', true)
      } else {
        this.ctx.emit('assistant/error', err?.message || 'Unknown error')
        this.ctx.emit('assistant/turn-end', false)
      }
    } finally {
      // 只清理自己这个 turn 的 controller：旧 turn 的收尾晚于新 turn 启动时，
      // 无条件置 null 会把新 turn 的 controller 报废（stop 失效、并发互串）。
      if (this.abortController?.signal === signal) this.abortController = null
    }
  }

  /** 停止当前 turn */
  stop(): void {
    this.abortController?.abort()
  }

  /** 清空对话历史 */
  clearHistory(): void {
    this.history = []
  }

  /** 获取当前历史（供 useAssistant 持久化） */
  getHistory(): ChatMessage[] {
    return this.history
  }

  /** 恢复历史（供 useAssistant 从 localStorage 加载） */
  setHistory(messages: ChatMessage[]): void {
    this.history = messages
  }

  /** 撤销最后一个 turn：历史回退到最后一条 user 消息之前（重试时用） */
  dropLastTurn(): void {
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i]!.role === 'user') {
        this.history = this.history.slice(0, i)
        return
      }
    }
  }

  // ---- 内部实现 ----

  /**
   * tool_use 后面必须紧跟对应的 tool_result。上一个 turn 中途停止或出错时可能有调用
   * 没拿到结果，新 turn 开始前给它们补一条报错结果，否则之后的请求都会 400。
   */
  private closeInterruptedToolCalls(): void {
    const answered = new Set(
      this.history.flatMap((m) => (m.role === 'tool' ? [m.toolCallId] : [])),
    )
    const next: ChatMessage[] = []
    for (const message of this.history) {
      next.push(message)
      if (message.role !== 'assistant') continue
      for (const part of message.parts) {
        if (part.type === 'tool-call' && !answered.has(part.id)) {
          next.push({
            role: 'tool',
            toolCallId: part.id,
            name: part.name,
            content: 'Interrupted before this tool finished; no result is available.',
            isError: true,
          })
        }
      }
    }
    this.history = next
  }

  private async runSteps(signal: AbortSignal): Promise<void> {
    // 回合内 system 与 tools 固定：思考块的签名绑定了它们，也让 prompt 缓存能命中
    const tools = this.ctx.tools.schemas()
    const system = this.assembleSystemPrompt()

    for (let step = 1; step <= MAX_AGENT_STEPS; step++) {
      if (signal.aborted) return

      this.ctx.emit('assistant/step', step)

      const finish = await this.streamStep(
        {
          system,
          messages: [...this.history],
          tools: tools.length > 0 ? tools : undefined,
        },
        signal,
      )
      if (signal.aborted || !finish) return

      if (finish.reason === 'error') {
        this.ctx.emit('assistant/error', finish.error || 'LLM error')
        return
      }
      if (finish.reason === 'refusal') {
        this.ctx.emit('assistant/error', t('common.assistant.errors.refused'))
        return
      }

      // 达到输出上限时工具入参可能不完整，只保留已生成的正文，不再继续工具循环
      const parts: AssistantPart[] =
        finish.reason === 'length'
          ? finish.parts.filter((part) => part.type === 'text')
          : finish.parts
      const assistantMsg: AssistantMessage = { role: 'assistant', parts }
      // 只有正文或工具调用时才入列：只有思考的空回复写进历史没有意义
      if (parts.some((part) => part.type !== 'reasoning')) this.history.push(assistantMsg)
      this.ctx.emit('assistant/message-done', assistantMsg)

      if (finish.reason === 'length') {
        this.ctx.emit('assistant/error', t('common.assistant.errors.outputLimit'))
        return
      }

      const toolCalls = parts.flatMap((part) => (part.type === 'tool-call' ? [part] : []))
      // 无工具调用 → turn 结束
      if (toolCalls.length === 0) return

      // 执行工具调用（串行，只读工具量小）
      for (const call of toolCalls) {
        if (signal.aborted) return

        this.ctx.emit('assistant/tool-call', call.id, call.name, call.input)

        const result = await this.ctx.tools.execute({
          callId: call.id,
          name: call.name,
          arguments: call.input,
          signal,
        })

        this.ctx.emit(
          'assistant/tool-result',
          call.id,
          result.isError,
          result.content.slice(0, TOOL_PREVIEW_CHARS),
        )

        // 超过截断线的结果全文存 OPFS 存档。content 在 ToolRuntime 里已被
        // 截到 ≤TOOL_RESULT_CHARS——判断是否截断必须看 fullContent（按
        // content.length 判断永远不成立，存档一次都写不进去）。存档成功后
        // 在截断 marker 后附取回指引；历史预算吃紧时本条会被替换为存根，
        // 模型仍可用 read_archived_result(id) 取回全文。
        let toolContent = result.content
        if (result.fullContent) {
          const archived = await writeArchive(call.id, result.fullContent)
          if (archived) {
            toolContent += `\n[full result archived — call read_archived_result("${call.id}")]`
          }
        }

        // 中止后不回填工具结果：send() 对旧 turn 只等 50ms，writeArchive 的
        // 串行 OPFS 链路可能远超之——迟到的 tool 消息会排到下一 turn 的
        // user 消息之后（其配对的 tool_use 在更早处），端点对此 400。
        // execute 内部已把中止转成正常返回，这里必须显式重查。
        if (signal.aborted) return

        // 工具结果消息回列
        this.history.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: toolContent,
          isError: result.isError,
        })
      }
    }

    // 超步数：提示强制收尾
    const notice =
      '(Maximum steps reached. Please summarize your findings based on the information gathered so far.)'
    const finalMsg: AssistantMessage = { role: 'assistant', parts: [{ type: 'text', text: notice }] }
    this.history.push(finalMsg)
    this.ctx.emit('assistant/message-delta', notice)
    this.ctx.emit('assistant/message-done', finalMsg)
  }

  /** 单步 LLM 流：转发增量，返回结束块（中止时可能没有） */
  private async streamStep(
    options: GenerateOptions,
    signal: AbortSignal,
  ): Promise<StepFinish | null> {
    let finish: StepFinish | null = null
    for await (const chunk of this.ctx.llm.stream(options, signal)) {
      if (signal.aborted) break
      switch (chunk.type) {
        case 'text-delta':
          this.ctx.emit('assistant/message-delta', chunk.text)
          break
        case 'reasoning-delta':
          this.ctx.emit('assistant/reasoning-delta', chunk.text)
          break
        case 'finish':
          finish = chunk
          break
      }
    }
    return finish
  }

  /** 组装 system prompt：基础 prompt + 静态数据集元数据 + skill catalog + tool list */
  private assembleSystemPrompt(): string {
    const sections: string[] = []

    // 基础 prompt
    sections.push(BASE_SYSTEM_PROMPT)

    // 静态数据集元数据（会话级不变的样本身份证：名称/维度/极性/仪器等）。
    // 只注入随用户操作不变的字段；动态状态（选中离子/kmeans 选择等）一律走
    // get_page_state 等工具实时读取。zarr 未加载时整段缺省。
    const dataset = buildDatasetOverview()
    if (dataset) {
      sections.push(
        '\n## Dataset Context (static session metadata)\n' +
          'The following sample metadata is fixed for this dataset — always relevant, no need to re-query:\n' +
          renderDataset(dataset),
      )
    }

    // 技能目录
    const catalog = this.ctx.skills.catalog()
    if (catalog.length > 0) {
      const lines = ['\n## Available Skills']
      for (const s of catalog) {
        lines.push(`- **${s.name}**: ${s.description}`)
        if (s.whenToUse) lines.push(`  When to use: ${s.whenToUse}`)
      }
      lines.push(
        '\nUse the `skill` tool to load detailed instructions for a skill before performing related analysis.',
      )
      sections.push(lines.join('\n'))
    }

    // 工具列表（按 category 分组：页面数据 → 文件/账户 → 化学信息 → 生物信息
    // → 文献 → 系统，帮助模型按问题域选工具）
    const defs = this.ctx.tools.list()
    if (defs.length > 0) {
      const lines = [
        '\n## Available Tools',
        'The following tools are ALREADY registered and callable by you right now — invoke any of them directly by name; do not assume only some exist. Grouped by domain:',
      ]
      const order: { key: ToolCategory | undefined; heading: string }[] = [
        { key: 'page', heading: 'Page & dataset (live state)' },
        { key: 'files', heading: 'Files & account (backend)' },
        { key: 'chemistry', heading: 'Chemical information (PubChem / offline library / ChEBI)' },
        { key: 'biology', heading: 'Biology (HMDB metabolites / KEGG pathways)' },
        { key: 'literature', heading: 'Literature (PubMed / Europe PMC / OpenAlex)' },
        { key: 'system', heading: 'Assistant internals' },
        { key: undefined, heading: 'Other' },
      ]
      for (const group of order) {
        const tools = defs.filter((d) => d.category === group.key)
        if (tools.length === 0) continue
        lines.push(`\n### ${group.heading}`)
        for (const t of tools) lines.push(`- **${t.name}**: ${t.description}`)
      }
      sections.push(lines.join('\n'))
    }

    return sections.join('\n')
  }

  /** content 是否已带存档指针（执行时附注 / 上一轮压缩存根）。两种存根都以
   *  `…archived…call read_archived_result("id")]` 收尾且位于 content 末尾——
   *  不能用无锚点的 includes('read_archived_result(')：assistant 正文里引用
   *  函数名（"我已用 read_archived_result(...) 取回全文"）会被误判成存根，
   *  该消息从此免于预算压缩，字符预算被架空。 */
  private hasArchivePointer(content: string): boolean {
    return /archived[^\]]*read_archived_result\("[^"]*"\)\]\s*$/.test(content)
  }

  /**
   * 自动 Compact：历史总量超过 COMPACT_TRIGGER_CHARS 时，用一次独立的
   * 无工具 LLM 请求把整段对话压成结构化摘要，替换全部旧历史。
   *
   * 只在 send() 内、新 user 消息入列前调用（turn 边界）：
   * - 此刻历史里不存在悬空 tool 消息，摘要请求不会携带配对问题；
   * - 压缩后的新历史以 user 开头（压缩标记），满足「首条必须 user」的约束。
   *
   * 任何失败（abort / 空流 / 异常）都静默返回 false：调用方（send）接着走
   * trimHistory 被动兜底，绝不能因为压缩失败阻断用户消息。
   */
  private async maybeCompact(signal: AbortSignal): Promise<boolean> {
    let total = 0
    for (const m of this.history) total += this.historyCost(m)
    if (total <= COMPACT_TRIGGER_CHARS) return false

    const summary = await this.summarizeForCompact(signal)
    if (!signal.aborted && summary) {
      const before = total
      this.history = [
        {
          role: 'user',
          content:
            '[system: the earlier conversation has been compacted to save context. ' +
            'The summary below replaces everything before the next user message. ' +
            'Tool results mentioned there are still retrievable via read_archived_result.]',
        },
        { role: 'assistant', parts: [{ type: 'text', text: summary }] },
      ]
      let after = 0
      for (const m of this.history) after += this.historyCost(m)
      this.ctx.emit('assistant/compacted', before, after)
      return true
    }
    return false
  }

  /** compact 摘要请求：一次无工具、限长的独立调用（走 ctx.llm 流式管道，
   *  但不 emit message-delta——这是内部压缩，不是面向用户的回复） */
  private async summarizeForCompact(signal: AbortSignal): Promise<string | null> {
    const system =
      'You compress conversation histories for an MSI data-analysis assistant. ' +
      'Summarize the conversation so the assistant can continue seamlessly with ' +
      'no loss of operational facts. Keep it under 2000 tokens. Structure:\n' +
      '## Confirmed findings\n(concrete conclusions with numbers/molecule names, and how confident)\n' +
      '## Tools & data touched\n(which tools were called with what key results; note "archived" ' +
      'pointers — those can be re-fetched with read_archived_result by id)\n' +
      '## User intent & open questions\n(what the user wants next, unresolved threads)\n' +
      'Write in the conversation language. Facts only — no pleasantries.'

    let summary = ''
    try {
      for await (const chunk of this.ctx.llm.stream(
        {
          system,
          messages: [{ role: 'user', content: this.renderHistoryForSummary() }],
          // 不带 tools：摘要请求绝不能触发工具调用
          maxTokens: COMPACT_SUMMARY_MAX_TOKENS,
        },
        signal,
      )) {
        if (signal.aborted) return null
        if (chunk.type === 'text-delta') summary += chunk.text
        if (chunk.type === 'finish' && chunk.reason === 'error') return null
      }
    } catch {
      return null
    }
    const trimmed = summary.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  /** 历史渲染给摘要模型：工具调用压成「调用名(参数摘要) → 结果首行」，
   *  长内容截断（摘要只需要事实线索，不需要全文） */
  private renderHistoryForSummary(): string {
    const lines: string[] = []
    for (const m of this.history) {
      switch (m.role) {
        case 'user': {
          const imgs = m.images?.length ? ` [${m.images.length} image(s) attached]` : ''
          lines.push(`USER: ${m.content}${imgs}`)
          break
        }
        case 'assistant': {
          const calls = m.parts
            .flatMap((part) =>
              part.type === 'tool-call'
                ? [`    ${part.name}(${JSON.stringify(part.input).slice(0, 120)})`]
                : [],
            )
            .join('\n')
          const text = assistantText(m)
          const body = text ? `ASSISTANT: ${text.slice(0, 1_500)}` : 'ASSISTANT: (tool calls)'
          lines.push(calls ? `${body}\n${calls}` : body)
          break
        }
        case 'tool':
          lines.push(`  -> ${m.name}: ${m.content.slice(0, 400)}`)
          break
      }
    }
    return lines.join('\n')
  }

  /**
   * 回合边界的被动兜底：图片只留最近一条 user 消息（旧图换占位，dataURL 几百 KB 一张，
   * 留在历史里每轮全量重传）+ 字符预算（HISTORY_CHAR_BUDGET，图片计入）。预算从最旧
   * 开始吃：超长 tool 结果替换为「截断 + OPFS 存档」存根（模型可用 read_archived_result
   * 取回），更早的长 assistant 回复压成前缀。最近 4 条始终完整保留。
   * 思考块不动：各家端点都要求原样回传。
   */
  private async trimHistory(): Promise<void> {
    // 图片先剥（无条件，不看预算）：base64 dataURL 单张几百 KB，即使整段历史
    // 文本远低于字符预算，旧图片也会让每轮请求全量重传（体积/延迟/网关 body
    // 上限三重坑）。只保留最近 keepRecent 条消息里最后一条带图 user 消息的
    // 图片——视觉追问通常紧跟着发图的那轮；更早的一律换占位文字。
    {
      const keepRecent = 4
      let lastImageIdx = -1
      for (let i = this.history.length - 1; i >= this.history.length - keepRecent && i >= 0; i--) {
        const m = this.history[i]!
        if (m.role === 'user' && m.images?.length) {
          lastImageIdx = i
          break
        }
      }
      for (let i = 0; i < this.history.length; i++) {
        const m = this.history[i]!
        if (i === lastImageIdx || m.role !== 'user' || !m.images?.length) continue
        const note =
          m.images.length > 1 ? `[${m.images.length} images omitted]` : '[image omitted]'
        m.images = undefined
        m.content = m.content ? `${m.content}\n${note}` : note
      }
    }

    // 字符预算（一批接近截断线的工具结果 + 长回复，压缩失败时可能超）
    let total = 0
    for (const m of this.history) total += this.historyCost(m)
    if (total <= HISTORY_CHAR_BUDGET) return

    const keepRecent = 4
    for (let i = 0; i < this.history.length - keepRecent && total > HISTORY_CHAR_BUDGET; i++) {
      const m = this.history[i]!
      if (m.role === 'tool') total -= await this.stubToolResult(m)
      else if (m.role === 'assistant') total -= this.shortenReply(m)
    }
  }

  /** 超过 TOOL_STUB_KEEP 的工具结果先存档再压成存根，返回省下的字符数。
   *  存档失败不压（压了正文就永久丢了）；已带存档指针的不再压，否则指针会被截坏。 */
  private async stubToolResult(m: ToolMessage): Promise<number> {
    if (m.content.length <= TOOL_STUB_KEEP || this.hasArchivePointer(m.content)) return 0
    const archived = await writeArchive(m.toolCallId, m.content)
    if (!archived) return 0
    const stub =
      `${m.content.slice(0, TOOL_STUB_KEEP)}\n` +
      `…[truncated for context budget — full result archived, call read_archived_result("${m.toolCallId}")]`
    const saved = m.content.length - stub.length
    m.content = stub
    return saved
  }

  /** 长 assistant 回复压成前缀，返回省下的字符数。工具调用和思考块保留 */
  private shortenReply(m: AssistantMessage): number {
    const text = assistantText(m)
    if (text.length <= TOOL_RESULT_CHARS || this.hasArchivePointer(text)) return 0
    const stub = `${text.slice(0, TOOL_RESULT_CHARS)}\n…[earlier reply truncated for context budget]`
    let replaced = false
    m.parts = m.parts.flatMap((part): AssistantPart[] => {
      if (part.type !== 'text') return [part]
      if (replaced) return []
      replaced = true
      return [{ type: 'text', text: stub }]
    })
    return text.length - stub.length
  }

  /** 消息占用预算的字符量。图片按固定值计：模型按尺寸计费，与 base64 长度无关 */
  private historyCost(m: ChatMessage): number {
    if (m.role === 'user') return m.content.length + (m.images?.length ?? 0) * IMAGE_HISTORY_COST
    if (m.role === 'tool') return m.content.length
    let cost = 0
    for (const part of m.parts) if (part.type !== 'tool-call') cost += part.text.length
    return cost
  }
}

// ---- 基础 system prompt ----

const BASE_SYSTEM_PROMPT = `You are SXO-Harness, a Mass Spectrometry Imaging (MSI) data analysis assistant for the SpatialXomics platform.

## Your Role
Help researchers analyze MSI datasets by:
1. Summarizing dataset characteristics (dimensions, instrument, m/z range)
2. Interpreting ion images and spatial patterns
3. Recommending preprocessing and analysis methods
4. Writing analysis reports
5. Retrieving file and process information from the backend

## Guidelines
- Use the available tools to get real data — never guess numbers.
- Your full tool set is listed under "## Available Tools" below; every tool there is already registered and directly callable. Do not assume only some exist.
- When interpreting ion images, connect spatial patterns to possible biological significance.
- For method recommendations, explain why a method is suitable for the specific dataset characteristics.
- Keep explanations clear and accessible to researchers with varying MSI expertise.
- Use the \`skill\` tool to load domain-specific instructions when needed.
- Be concise: aim for 2-4 paragraphs unless the user asks for a detailed report.

## Data Context
Static sample metadata (name, dimensions, polarity, analyzer, ion source, m/z range) is provided
below in the Dataset Context section — treat it as always-current session knowledge.
Dynamic page state (selected ion, clustering selection, annotation focus) is NOT pre-injected:
for any question involving the currently selected data, first call the \`get_page_state\` tool to
see the live page state, then use the specialized \`get_*\` tools (e.g. \`get_ion_image_stats\`,
\`get_annotation_top\`, \`get_kmeans_summary\`) for detailed statistics. Never
assume data from previous turns is still current — the user may have changed the selected ion;
when in doubt, call \`get_page_state\` again.`

// ---- 插件入口 ----

export const agentLoopProvider = (ctx: Context) => {
  // 依赖声明：AgentLoop 内部访问 ctx.connection / ctx.llm / ctx.tools / ctx.skills（兄弟服务）。
  // cordis 4 的属性解析要求在自身 fiber 里声明过 inject 才能拿到兄弟服务，
  // 否则抛 "cannot get property X without inject"（见 __tests__/agentLoop.test.ts）。
  // inject 回调会等依赖就绪才执行——bootstrap 的加载顺序（connection → llm → tools → skills
  // → … → agentLoop）下立即满足。
  ctx.inject(['connection', 'llm', 'tools', 'skills'], (ctx2) => {
    new AgentLoop(ctx2)
  })
}
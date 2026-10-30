/**
 * useAssistant：assistant 的 Vue 桥。
 *
 * - 懒建 cordis context（getAssistantContext 单例）
 * - 订阅 assistant/* 事件 → 响应式状态（messages / streaming / error）
 * - send / stop / clear / retry / quickPrompt
 * - localStorage 历史持久化（≤ MAX_HISTORY_MESSAGES 条，不含 system/context）
 */

import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { UiChatItem } from '../agenttypes/assistant'
import { getAssistantContext } from '../plugins'
import { buildPageState } from '../providers/analysisContext'
import { MAX_HISTORY_MESSAGES, MAX_UI_MESSAGES } from '../agentconfig/defaults'
import {
  appendHistoryLines,
  readHistoryLines,
  clearAssistantOpfs,
  rotateSessionId,
} from '../utils/opfsStore'
import { STORAGE_KEYS } from '@/shared/config/storageKeys'
import { t } from '@/i18n'

// ---- 模块级共享状态（多个组件实例共享同一对话） ----

const messages = ref<UiChatItem[]>([])
const streaming = ref(false)
const error = ref<string | null>(null)
/** 当前是否有数据集上下文（结果页已加载 zarr 数据时为 true） */
const hasContext = ref(false)
/** 技能按钮（排在快捷提问之前）：skills 服务就绪后填充 */
const skillButtons = ref<{ name: string; text: string }[]>([])
/** UI 之外还有更早的 OPFS 历史可加载 */
const earlierAvailable = ref(false)

/** 当前正在流式输出的 assistant 消息 id（增量路由目标：总是最新 turn 的占位） */
let currentAssistantId: string | null = null
/** 进行中 turn 的 assistant 占位消息 id，FIFO 配对。
 *  停止后立即发新消息时，旧 turn 的 turn-end 可能晚于新 turn 的 turn-start
 *  触发——按「谁创建谁回收」的队列配对，旧收尾只 finalize 自己的占位，
 *  不会把新占位提前定型/置 null（旧实现会丢掉新 turn 的全部增量）。 */
let pendingAssistantIds: string[] = []
/** 当前 turn 内收到的错误文本（turn-end 时写入配对气泡；error 事件本身
 *  不带 turn 身份，靠「error 后紧跟同 turn 的 turn-end」传递） */
let turnError: string | null = null
/** 是否已绑定事件监听（模块级一次） */
let bound = false

let _idCounter = 0
function nextId(): string {
  return `msg_${Date.now()}_${++_idCounter}`
}

// ---- 技能按钮（curated 顺序） ----

/** 按钮展示顺序与集合：只保留最核心的两个技能按钮（其余技能仍可经 `skill` 工具调用，
 *  只是不在欢迎区铺按钮） */
const SKILL_BUTTON_ORDER = [
  'annotation-review',
  'msi-analysis',
] as const

/** 技能按钮点击后发出的提示词（驱动模型加载 SKILL.md 并按其模板执行） */
function skillTriggerPrompt(name: string): string {
  return (
    `Load the "${name}" skill with the \`skill\` tool first, then follow its workflow and ` +
    `output template to analyze the current data, and summarize the key findings with ` +
    `explicit judgment criteria.`
  )
}

// ---- 事件绑定（懒，首次调用 useAssistant 时） ----

function bindEvents() {
  if (bound) return
  bound = true

  const ctx = getAssistantContext()

  // 技能目录 → 按钮（skills 服务由异步 fiber 注册，就绪后一次性填充）。
  // 只展示 curated 集合（SKILL_BUTTON_ORDER）：其余技能没有对应翻译标签，
  // 铺成按钮会露出英文原名（中文界面下一排英文按钮），模型仍可经
  // `skill` 工具按需加载。
  ctx.inject(['skills'], (ctx2) => {
    const catalog = ctx2.skills.catalog()
    const rank = (name: string) => {
      const i = (SKILL_BUTTON_ORDER as readonly string[]).indexOf(name)
      return i === -1 ? SKILL_BUTTON_ORDER.length : i
    }
    skillButtons.value = catalog
      .filter((s) => (SKILL_BUTTON_ORDER as readonly string[]).includes(s.name))
      .sort((a, b) => rank(a.name) - rank(b.name))
      .map((s) => ({ name: s.name, text: skillTriggerPrompt(s.name) }))
  })

  // 模型侧历史恢复：agent 服务由异步 fiber 创建，就绪后把 localStorage 恢复的
  // UI 消息转成干净的 user/assistant 对注入（此前 setHistory 无任何调用方，
  // 刷新页面后 UI 显示完整对话而模型上下文为空）。只取有内容的条目（正文或
  // 图片——纯图 user 消息 content 为空串，falsy 判断会把它丢掉，而其后的
  // assistant 回复留在头部会形成 assistant-first 历史，严格端点每轮 400）、
  // 跳过错误/截断条目——UI 专用字段无法构成合法的 tool 消息链，严格端点会 400。
  ctx.inject(['agent'], (ctx2) => {
    const restored = messages.value
      .filter(
        (m) =>
          ((m.content && m.content.length > 0) || (m.images?.length ?? 0) > 0) &&
          !m.error &&
          !m.truncated &&
          !m.compacted,
      )
      .map((m) => {
        const msg: { role: 'user' | 'assistant'; content: string; images?: string[] } = {
          role: m.role,
          content: m.content,
        }
        // user 消息的图片一并回灌模型上下文（视觉模型可继续引用）
        if (m.role === 'user' && m.images && m.images.length > 0) msg.images = m.images
        return msg
      })
    ctx2.agent.setHistory(restored)
  })

  ctx.on('assistant/turn-start', () => {
    streaming.value = true
    error.value = null
    turnError = null
    // 创建流式 assistant 消息占位（入 FIFO 队列，turn-end 按配对回收）
    currentAssistantId = nextId()
    pendingAssistantIds.push(currentAssistantId)
    messages.value.push({
      id: currentAssistantId,
      role: 'assistant',
      content: '',
      pending: true,
      toolCalls: [],
    })
  })

  ctx.on('assistant/message-delta', (text: string) => {
    if (!currentAssistantId) return
    const last = messages.value.find((m) => m.id === currentAssistantId)
    if (last) {
      last.content += text
      // 正文开始 → 思考结束（折叠态保留 reasoning 供查看）
      last.reasoningActive = false
    }
  })

  ctx.on('assistant/reasoning-delta', (text: string) => {
    if (!currentAssistantId) return
    const last = messages.value.find((m) => m.id === currentAssistantId)
    if (last) {
      last.reasoning = (last.reasoning ?? '') + text
      last.reasoningActive = true
    }
  })

  ctx.on('assistant/stream-truncated', () => {
    // 中转站断流：保留已有内容并打截断标记（不弹错误）。正文为空（思考阶段
    // 断流）时把提示语直接放进正文，避免空气泡。
    if (!currentAssistantId) return
    const last = messages.value.find((m) => m.id === currentAssistantId)
    if (last) {
      if (last.content) {
        last.truncated = true
      } else {
        last.content = t('common.assistant.truncated')
        // 同样打截断标：该文案是 UI 提示而非模型产出，否则历史恢复注入
        // 过滤（m.content && !m.error && !m.truncated）会把它当真实助手
        // 发言回灌模型（换语言后旧 locale 文案还会永久烙进历史）
        last.truncated = true
        last.reasoningActive = false
      }
    }
  })

  ctx.on('assistant/tool-call', (name: string) => {
    if (!currentAssistantId) return
    const last = messages.value.find((m) => m.id === currentAssistantId)
    if (last) {
      last.toolCalls!.push({ name, isError: false, preview: '…' })
    }
  })

  ctx.on('assistant/tool-result', (name: string, isError: boolean, preview: string) => {
    if (!currentAssistantId) return
    const last = messages.value.find((m) => m.id === currentAssistantId)
    if (last) {
      // 更新对应工具条目（最后一条同名记录）
      const entry = [...last.toolCalls!].reverse().find((t) => t.name === name)
      if (entry) {
        entry.isError = isError
        entry.preview = preview
      }
    }
  })

  ctx.on('assistant/turn-end', (aborted: boolean) => {
    // FIFO 配对回收本 turn 的占位（而非「当前的」占位——那是竞态下最新
    // turn 的，提前定型会把流式中的气泡冻结在半截内容上）
    const id = pendingAssistantIds.shift()
    if (id) {
      const last = messages.value.find((m) => m.id === id)
      if (last) {
        last.pending = false
        last.reasoningActive = false
        last.interrupted = aborted
        if (turnError && !last.error) last.error = turnError
        // 终极兜底：turn 正常结束（非中断、无错误）但气泡什么内容都没有，
        // 说明走了某条未覆盖的空路径——填一条可读提示，绝不留死空白。
        if (
          !aborted &&
          !last.error &&
          !last.content &&
          !last.reasoning &&
          (last.toolCalls?.length ?? 0) === 0
        ) {
          last.error = t('common.assistant.emptyResponse')
        }
      }
      turnError = null
      // 增量路由指向仍在流式的最新占位（若有）
      currentAssistantId = pendingAssistantIds[pendingAssistantIds.length - 1] ?? null
    }
    streaming.value = pendingAssistantIds.length > 0
    persistTurnToOpfs()
    capUiMessages()
    saveHistory()
  })

  ctx.on('assistant/error', (message: string) => {
    error.value = message
    // 错误文本延后到配对的 turn-end 写入气泡（error 事件不动占位消息，
    // 也不重置 streaming——同 turn 的 turn-end 马上会到）
    turnError = message
  })

  // 自动 Compact 提示条：agentLoop 在 send 内、turn-start 前压缩模型侧历史
  // 并发来本事件。UI 上插一条居中灰色提示（compacted 标记渲染为系统提示而
  // 非气泡，且不回灌模型——见 ChatTDesign 与历史恢复过滤）。
  ctx.on('assistant/compacted', (before: number, after: number) => {
    const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
    messages.value.push({
      id: nextId(),
      role: 'assistant',
      content: t('common.assistant.compacted', { before: fmt(before), after: fmt(after) }),
      compacted: true,
    })
    saveHistory()
  })
}

// ---- OPFS 持久化（完整历史）与 UI 上限 ----

/** 已写入 OPFS 的消息 id。以 id 幂等去重，与数组下标无关——loadEarlier
 *  前插 50 条、重试、中断竞态下旧 turn 收尾晚于新 turn 启动等场景都不会
 *  重复追加或漏写（下标基线在这些场景下全部失效）。 */
const persistedIds = new Set<string>()

/** 把尚未持久化的完整消息（含工具调用/思考/错误标记）整批追加进 OPFS
 *  会话文件。遇到仍在流式输出（pending）的占位即停——它尚未定型，留给
 *  它自己的 turn-end 补写（user 消息永远排在占位之前，因此一定会入档）。
 *  **成功追加后才标记已持久化**：OPFS 写失败（配额/隐私模式/目录被清）时
 *  这些消息保持未标记，下一个 turn 结束会把它们连同新消息整批重试——
 *  先标记后 fire-and-forget 的旧实现会让失败轮次永久静默丢失。 */
function persistTurnToOpfs(): void {
  const fresh: UiChatItem[] = []
  for (const m of messages.value) {
    if (persistedIds.has(m.id)) continue
    if (m.pending) break
    fresh.push(m)
  }
  if (fresh.length === 0) return
  void appendHistoryLines(fresh.map((m) => ({ ...m, pending: false }))).then((ok) => {
    if (ok) for (const m of fresh) persistedIds.add(m.id)
  })
}

/** UI 消息数上限：超出从最旧裁剪（完整内容仍在 OPFS，loadEarlier 可取回）。 */
function capUiMessages(): void {
  if (messages.value.length > MAX_UI_MESSAGES) {
    messages.value.splice(0, messages.value.length - MAX_UI_MESSAGES)
    earlierAvailable.value = true
  }
}

/** 从 OPFS 会话文件取回更早的消息，按 id 去重后前置到 UI（每次最多 50 条）。 */
async function loadEarlier(): Promise<void> {
  const lines = await readHistoryLines()
  const known = new Set(messages.value.map((m) => m.id))
  const older = lines.filter(
    (l): l is UiChatItem =>
      !!l && typeof l === 'object' && 'id' in l && 'role' in l && !known.has((l as UiChatItem).id),
  )
  if (older.length > 0) {
    const batch = older.slice(-50)
    // 回填的消息本来就来自 OPFS——标记已持久化，turn-end 不会重复追加
    for (const m of batch) persistedIds.add(m.id)
    messages.value = [...batch, ...messages.value]
  }
  earlierAvailable.value = older.length > 50
}

// ---- 历史持久化 ----

/** localStorage 持久化的图片总量上限（dataURL 字符数）。base64 单张几百 KB，
 *  不设限的话几张图就把 ~5MB 的 localStorage 配额打爆，且 QuotaExceededError
 *  会被下面的 catch 静默吞掉——持久化无声停止，用户重载后丢对话。超限时从
 *  最旧的图片开始丢弃（消息保留，images 置空）。 */
const HISTORY_IMAGE_BUDGET = 1_500_000

/** 裁掉历史里的超量图片：从最旧开始丢，直到总量 ≤ budget。
 *  返回裁剪后的浅拷贝数组（不动 messages.value 原对象——UI 里旧图仍可看） */
function capHistoryImages(items: UiChatItem[]): UiChatItem[] {
  let total = 0
  for (const m of items) {
    if (m.images) for (const d of m.images) total += d.length
  }
  if (total <= HISTORY_IMAGE_BUDGET) return items
  const out = items.map((m) => ({ ...m, images: m.images ? [...m.images] : undefined }))
  for (const m of out) {
    if (total <= HISTORY_IMAGE_BUDGET) break
    if (!m.images?.length) continue
    for (let i = 0; i < m.images.length && total > HISTORY_IMAGE_BUDGET; i++) {
      total -= m.images[i]!.length
      m.images.splice(i, 1)
      i--
    }
    if (m.images.length === 0) m.images = undefined
  }
  return out
}

function saveHistory(): void {
  try {
    const capped = capHistoryImages(messages.value)
    const trimmed = capped.slice(-MAX_HISTORY_MESSAGES).map((m) => ({
      ...m,
      pending: false,
    }))
    localStorage.setItem(STORAGE_KEYS.assistantHistory, JSON.stringify(trimmed))
  } catch {
    // 配额仍不够（极端：裁图后仍超——理论上不会发生，防御性兜底）：
    // 去图重存一次，宁可丢图不丢对话
    try {
      const stripped = messages.value
        .slice(-MAX_HISTORY_MESSAGES)
        .map((m) => ({ ...m, pending: false, images: undefined }))
      localStorage.setItem(STORAGE_KEYS.assistantHistory, JSON.stringify(stripped))
    } catch {
      // localStorage 不可用（隐私模式等）时静默跳过
    }
  }
}

function loadHistory(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.assistantHistory)
    if (!raw) return
    const parsed = JSON.parse(raw) as UiChatItem[]
    if (Array.isArray(parsed) && parsed.length > 0) {
      messages.value = parsed
    }
  } catch {
    // 损坏的历史静默丢弃
  }
}

/** 数据集切换后旧对话不再可信（历史 tool 结果属于旧样本，而系统提示的
 *  Dataset Context 按当前 turn 描述新样本）：丢弃 localStorage 历史并清空
 *  OPFS 档案。标志由 VizWorkbench 挂载时写入（该处不能静态 import 本模块，
 *  否则 agent 栈会被拉进 vizworkbench 路由 chunk，见 plugins/index.ts 的
 *  懒加载契约）。幂等：两个消费点（模块初始化 + useAssistant() 调用——后者
 *  覆盖会话内切换数据集而本模块早已加载的场景）谁先到谁消费。
 *  @returns 是否执行了清空（调用方据此同步清掉 agent 侧历史） */
function consumePendingDatasetClear(): boolean {
  let pending = false
  try {
    pending = localStorage.getItem(STORAGE_KEYS.assistantPendingClear) === '1'
    if (pending) {
      localStorage.removeItem(STORAGE_KEYS.assistantPendingClear)
      localStorage.removeItem(STORAGE_KEYS.assistantHistory)
    }
  } catch {
    // localStorage 不可用（隐私模式等）时静默跳过
  }
  if (!pending) return false
  messages.value = []
  persistedIds.clear()
  earlierAvailable.value = false
  void clearAssistantOpfs()
  rotateSessionId()
  return true
}

// 模块级加载一次（先消费数据集切换的待清空标志，再恢复历史——顺序不能反；
// 此刻 agent 尚未创建，bindEvents 的 setHistory 注入的是清空后的空列表，
// 故无需同步模型侧）
consumePendingDatasetClear()
loadHistory()
// localStorage 恢复的消息此前已入档——标记已持久化，避免下个 turn 结束时
// 整批重复追加（id 幂等基线的初始化）
for (const m of messages.value) persistedIds.add(m.id)
// localStorage 只恢复了精简的最近消息；OPFS 里可能有更早的完整历史
// （其中出现过的 id 一并标记，防止 loadEarlier 回填前发生持久化竞态）
void (async () => {
  const lines = await readHistoryLines()
  for (const l of lines) {
    if (l && typeof l === 'object' && typeof (l as UiChatItem).id === 'string') {
      persistedIds.add((l as UiChatItem).id)
    }
  }
  if (lines.length > messages.value.length) earlierAvailable.value = true
})()

// ---- composable 导出 ----

export function useAssistant() {
  // 会话内数据集切换（模块已加载、agent 可能已在跑）：同步清掉模型侧历史，
  // 避免 UI 空而 agent 上下文仍带旧样本的对话
  if (consumePendingDatasetClear()) getAssistantContext().agent?.clearHistory()
  bindEvents()
  const { t } = useI18n()

  /**
   * 技能按钮文案（技能名 → 已翻译标签；key 写成静态字面量，@intlify/no-dynamic-keys
   * 禁动态 key，且集中在此一份）。只保留最核心的两个技能按钮。
   */
  const skillLabels = computed<Record<string, string>>(() => ({
    'annotation-review': t('common.assistant.skillBtns.annotationReview'),
    'msi-analysis': t('common.assistant.skillBtns.msiAnalysis'),
  }))

  /** 刷新上下文可用性（在 send 前调用，或页面数据变化时调用） */
  function refreshContext(): void {
    // 轻量直读（buildPageState 不做矩阵统计）：此处只需要一个布尔徽标，
    // 且每次 send 都会调用，不该跑 buildAnalysisContext 的重统计管线。
    const s = buildPageState()
    hasContext.value = !!(
      s.dataset ||
      s.selectedIon ||
      s.meanSpectrumAvailable ||
      s.kmeans ||
      (s.annotationCount ?? 0) > 0
    )
  }

  async function send(text: string, images?: string[]): Promise<void> {
    // 面板常开时跨数据集导航不会重挂 ChatTDesign（consumePendingDatasetClear
    // 的另外两个消费点——模块初始化与 useAssistant()——都不会触发）：
    // 发起提问前再消费一次待清空标志，保证模型上下文与系统提示的
    // Dataset Context 同源，而不是拿旧样本的 tool 结果回答新样本的问题
    if (consumePendingDatasetClear()) getAssistantContext().agent?.clearHistory()
    refreshContext()
    const userItem: UiChatItem = { id: nextId(), role: 'user', content: text }
    if (images && images.length > 0) userItem.images = images
    messages.value.push(userItem)
    const ctx = getAssistantContext()
    const agent = ctx.agent
    if (!agent) {
      // bootstrap 窗口内 agent 服务尚未注册（异步 fiber）——出可重试的错误气泡，
      // 不能裸调 ctx.agent.send 抛 TypeError 留下无事件的死状态
      const msg = t('common.assistant.somethingWrong')
      messages.value.push({ id: nextId(), role: 'assistant', content: '', error: msg, toolCalls: [] })
      error.value = msg
      saveHistory()
      return
    }
    await agent.send(text, images)
  }

  function stop(): void {
    getAssistantContext().agent?.stop()
  }

  function clear(): void {
    getAssistantContext().agent?.clearHistory()
    messages.value = []
    error.value = null
    earlierAvailable.value = false
    persistedIds.clear()
    pendingAssistantIds = []
    currentAssistantId = null
    turnError = null
    void clearAssistantOpfs()
    // 轮换会话文件：清空后的新对话不再追加进旧 jsonl（否则单文件无限增长，
    // trimOldSessions 的按量保留也永远只有一个文件可管）
    rotateSessionId()
    saveHistory()
  }

  /** 重试：移除最后的错误回复，重发最后一条 user 消息 */
  async function retry(): Promise<void> {
    // 回合进行中不重试：错误气泡的按钮在流式中仍可点，此刻重发会走
    // agentLoop.send 的 stop+50ms 并发路径（旧 turn 迟到的收尾可能把
    // tool 消息排到新 user 消息之后——见 agentLoop 工具循环的注释）
    if (streaming.value) return
    // 移除末尾的 assistant 错误消息
    while (messages.value.length > 0 && messages.value[messages.value.length - 1]!.role === 'assistant') {
      messages.value.pop()
    }
    const lastUser = [...messages.value].reverse().find((m) => m.role === 'user')
    if (!lastUser) return
    await send(lastUser.content, lastUser.images)
  }

  return {
    messages,
    streaming,
    error,
    hasContext,
    skillButtons,
    skillLabels,
    earlierAvailable,
    loadEarlier,
    send,
    stop,
    clear,
    retry,
    refreshContext,
  }
}

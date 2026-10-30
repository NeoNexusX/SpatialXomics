import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import { llmProvider } from '../providers/llm'
import { toolsProvider } from '../providers/tools'
import { skillsProvider } from '../providers/skills'
import { agentLoopProvider } from '../plugins/agentLoop'
import { defineTool } from '../tools/defineTool'
import { readArchive } from '../utils/opfsStore'
import { STORAGE_KEYS } from '@/shared/config/storageKeys'
import { t } from '@/i18n'
import type { ChatMessage, StreamChunk, GenerateOptions, LlmAdapter } from '../agenttypes/assistant'

/** 构造一个可控 LLM 适配器 */
function mockAdapter(chunks: StreamChunk[][]): {
  adapter: LlmAdapter
  calls: GenerateOptions[]
} {
  const calls: GenerateOptions[] = []
  let idx = 0
  const adapter: LlmAdapter = {
    provider: 'mock',
    async *stream(options: GenerateOptions, _signal: AbortSignal) {
      calls.push({ ...options })
      const batch = chunks[idx++] || []
      for (const c of batch) {
        yield c
      }
    },
  }
  return { adapter, calls }
}

async function setupAgent(mockChunks: StreamChunk[][]) {
  const ctx = new Context()
  // 逐个 await 插件 fiber：服务的属性注入在插件启动后才可用，
  // 只 flush 微任务队列（await Promise.resolve()）不够，会报
  // "cannot get property \"tools\" without inject"
  await ctx.plugin(llmProvider)
  await ctx.plugin(toolsProvider)
  await ctx.plugin(skillsProvider)
  await ctx.plugin(agentLoopProvider)

  const { adapter, calls } = mockAdapter(mockChunks)
  ctx.llm.registerAdapter('mock', adapter)
  ;(ctx.llm as any).defaultProvider = 'mock'

  return { ctx, calls }
}

// ---- 内存 OPFS（存档链路测试用；与 opfsStore.test.ts 的 Fake 同构） ----

class FakeOpfsFile {
  lastModified = Date.now()
  text = ''
}
class FakeOpfsFileHandle {
  constructor(public file: FakeOpfsFile) {}
  getFile() {
    const f = this.file
    return Promise.resolve({ text: () => Promise.resolve(f.text), lastModified: f.lastModified } as File)
  }
  createWritable() {
    const file = this.file
    return Promise.resolve({
      write: (data: string) => {
        file.text = data
        return Promise.resolve()
      },
      close: () => Promise.resolve(),
    })
  }
}
class FakeOpfsDir {
  files = new Map<string, FakeOpfsFile>()
  dirs = new Map<string, FakeOpfsDir>()
  getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    let d = this.dirs.get(name)
    if (!d) {
      if (!opts?.create) return Promise.reject(new Error('NotFoundError'))
      d = new FakeOpfsDir()
      this.dirs.set(name, d)
    }
    return Promise.resolve(d)
  }
  getFileHandle(name: string, opts?: { create?: boolean }) {
    let f = this.files.get(name)
    if (!f) {
      if (!opts?.create) return Promise.reject(new Error('NotFoundError'))
      f = new FakeOpfsFile()
      this.files.set(name, f)
    }
    return Promise.resolve(new FakeOpfsFileHandle(f))
  }
}

/** setupAgent + navigator.storage stub → writeArchive/readArchive 走内存实现 */
async function setupAgentWithOpfs(mockChunks: StreamChunk[][]) {
  const root = new FakeOpfsDir()
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } })
  const r = await setupAgent(mockChunks)
  return { ...r, root }
}

describe('AgentLoop', () => {
  beforeEach(() => {
    // send() 的 BYOK 前置检查需要可用凭据（测试环境无 VITE_LLM_* env，种一份用户配置）
    localStorage.setItem(
      STORAGE_KEYS.assistantLlmConfig,
      JSON.stringify({ baseUrl: 'https://llm.test', apiKey: 'sk-test', model: '' }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('emits events for a simple text response', async () => {
    const { ctx, calls } = await setupAgent([
      [
        { type: 'text-delta', text: 'Hello' },
        { type: 'text-delta', text: ' world' },
        { type: 'finish', reason: 'stop' },
      ],
    ])

    const events: string[] = []
    const deltas: string[] = []
    ctx.on('assistant/turn-start', () => events.push('turn-start'))
    ctx.on('assistant/message-delta', (d) => deltas.push(d))
    ctx.on('assistant/message-done', () => events.push('message-done'))
    ctx.on('assistant/turn-end', (aborted: boolean) => events.push(`turn-end:${aborted}`))

    await ctx.agent.send('hi')

    expect(events).toContain('turn-start')
    expect(events).toContain('message-done')
    expect(events).toContain('turn-end:false')
    expect(deltas.join('')).toBe('Hello world')
    expect(calls.length).toBe(1)
  })

  it('handles tool calls and feeds results back', async () => {
    const { ctx, calls } = await setupAgent([
      // step 1: tool call
      [
        { type: 'tool-call-delta', index: 0, id: 'call_1', name: 'add' },
        { type: 'tool-call-delta', index: 0, argumentsDelta: '{"a":1,"b":2}' },
        { type: 'finish', reason: 'tool-calls' },
      ],
      // step 2: final text
      [
        { type: 'text-delta', text: 'Result: 3' },
        { type: 'finish', reason: 'stop' },
      ],
    ])

    // 注册测试工具
    ctx.tools.register(
      defineTool({
        name: 'add',
        description: 'Add two numbers',
        parameters: {
          a: { type: 'number', required: true },
          b: { type: 'number', required: true },
        },
        output: { render: (args, v) => `${args.a!} + ${args.b!} = ${v}` },
        async execute(args) {
          return args.a! + args.b!
        },
      }),
    )

    const toolCalls: string[] = []
    const toolResults: string[] = []
    ctx.on('assistant/tool-call', (name: string) => toolCalls.push(name))
    ctx.on('assistant/tool-result', (name: string, isError: boolean) =>
      toolResults.push(`${name}:err=${isError}`),
    )

    await ctx.agent.send('add 1 and 2')

    expect(toolCalls).toEqual(['add'])
    expect(toolResults).toEqual(['add:err=false'])
    expect(calls.length).toBe(2)
  })

  it('stops on abort', async () => {
    const { ctx } = await setupAgent([
      // 一个永远不结束的流
      [
        { type: 'text-delta', text: 'thinking...' },
        // 没有 finish — 流持续等待
      ],
    ])

    // 覆盖 mockAdapter 为永不结束的流
    const adapter: LlmAdapter = {
      provider: 'mock2',
      async *stream(_options: GenerateOptions, signal: AbortSignal) {
        yield { type: 'text-delta', text: 'thinking...' }
        // 等待，直到 abort
        await new Promise<void>((resolve) => {
          const onAbort = () => {
            signal.removeEventListener('abort', onAbort)
            resolve()
          }
          signal.addEventListener('abort', onAbort)
        })
      },
    }
    ctx.llm.registerAdapter('mock2', adapter)
    ;(ctx.llm as any).defaultProvider = 'mock2'

    const events: string[] = []
    ctx.on('assistant/turn-end', (aborted: boolean) => events.push(`end:${aborted}`))

    const sendPromise = ctx.agent.send('long query')
    // 延迟 50ms 后 abort
    await new Promise((r) => setTimeout(r, 50))
    ctx.agent.stop()
    await sendPromise

    expect(events).toContain('end:true')
  })

  it('does not push a tool message after abort lands during archiving', async () => {
    // 中止落在 writeArchive 窗口内（OPFS 写入挂起期间 stop）：工具结果不得
    // 回列——迟到的 tool 消息会排到下一 turn 的 user 消息之后，而其配对的
    // tool_calls 在更早处，OpenAI/Anthropic 两种协议都对此 400 且无修复路径。
    // 回归：旧实现只在工具循环顶部检查 aborted，await writeArchive 之后直推。
    let releaseTool!: () => void
    let releaseWrite!: () => void
    // 慢速 OPFS：任何文件的 createWritable().write 挂起直到手动放行
    // （递归包裹子目录——存档写在 assistant-archive/ 子目录里）
    const slowify = (dir: FakeOpfsDir): FakeOpfsDir => {
      const origDir = dir.getDirectoryHandle.bind(dir)
      dir.getDirectoryHandle = ((name: string, opts?: { create?: boolean }) =>
        origDir(name, opts).then((d) => slowify(d))) as FakeOpfsDir['getDirectoryHandle']
      const origFile = dir.getFileHandle.bind(dir)
      dir.getFileHandle = ((name: string, opts?: { create?: boolean }) =>
        origFile(name, opts).then((h) => {
          const origWritable = h.createWritable.bind(h)
          h.createWritable = () =>
            origWritable().then(
              (w) =>
                ({
                  ...w,
                  write: (data: string) =>
                    new Promise<void>((r) => {
                      releaseWrite = r
                      void w.write(data)
                    }),
                }) as Awaited<ReturnType<typeof h.createWritable>>,
            )
          return h
        })) as FakeOpfsDir['getFileHandle']
      return dir
    }
    const slowRoot = slowify(new FakeOpfsDir())
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => slowRoot } })

    const { ctx, calls } = await setupAgent([
      [
        { type: 'tool-call-delta', index: 0, id: 'call_1', name: 'slow' },
        { type: 'tool-call-delta', index: 0, argumentsDelta: '{}' },
        { type: 'finish', reason: 'tool-calls' },
      ],
      [
        { type: 'text-delta', text: 'ok' },
        { type: 'finish', reason: 'stop' },
      ],
      [
        { type: 'text-delta', text: 'ok2' },
        { type: 'finish', reason: 'stop' },
      ],
      [
        { type: 'text-delta', text: 'ok3' },
        { type: 'finish', reason: 'stop' },
      ],
    ])
    ctx.tools.register(
      defineTool({
        name: 'slow',
        description: 'returns a big result (forces the archive path)',
        parameters: {},
        // execute 直接返回长字符串：走默认渲染管线被截到 TOOL_RESULT_CHARS、
        // fullContent 带全文 → writeArchive（自定义 render 已豁免截断，
        // 不再产生 fullContent，触发不了存档窗口）
        async execute() {
          await new Promise<void>((r) => {
            releaseTool = r
          })
          return 'x'.repeat(3000)
        },
      }),
    )

    const first = ctx.agent.send('run slow')
    await new Promise((r) => setTimeout(r, 20)) // 等 step1 流结束、execute 挂起
    releaseTool() // 工具结果带着 fullContent 流向存档 → writeArchive 挂起
    await new Promise((r) => setTimeout(r, 10))
    ctx.agent.stop() // abort 落在 writeArchive 等待窗口内
    // 并发发起第二 turn（send 只等 50ms 就推入新 user 消息——正是竞态路径）
    const second = ctx.agent.send('next question')
    await new Promise((r) => setTimeout(r, 80)) // user2 已入列、turn2 已请求
    releaseWrite() // 存档写完成：旧实现此刻把 tool(call_1) 排到 user2 之后
    await first
    await second
    // 迟到 push 之后的请求快照才能看到乱序（每步 messages 是新数组快照）
    await ctx.agent.send('third question')

    const userIdx = calls[1]!.messages.findIndex(
      (m) => m.role === 'user' && m.content === 'next question',
    )
    expect(userIdx).toBeGreaterThanOrEqual(0)
    for (const c of calls.slice(2)) {
      const idx = c.messages.findIndex(
        (m) => m.role === 'user' && m.content === 'next question',
      )
      expect(idx).toBeGreaterThanOrEqual(0)
      // user('next question') 之后不得出现任何 role:'tool'（其配对的
      // tool_calls 在 user 之前——两种协议都对此 400）
      expect(c.messages.slice(idx + 1).filter((m) => m.role === 'tool')).toHaveLength(0)
    }
  })

  it('stops at MAX_AGENT_STEPS', async () => {
    // 构造永远返回 tool_calls 的适配器（死循环模拟）
    const steps: StreamChunk[][] = Array.from({ length: 10 }, (_, i) => [
      { type: 'tool-call-delta', index: 0, id: `call_${i}`, name: 'add' },
      { type: 'tool-call-delta', index: 0, argumentsDelta: '{"a":1,"b":1}' },
      { type: 'finish', reason: 'tool-calls' },
    ])

    const { ctx } = await setupAgent(steps)

    ctx.tools.register(
      defineTool({
        name: 'add',
        description: 'add',
        parameters: {
          a: { type: 'number', required: true },
          b: { type: 'number', required: true },
        },
        output: { render: () => '' },
        async execute() {
          return 0
        },
      }),
    )

    const doneMessages: string[] = []
    ctx.on('assistant/message-done', (msg: { content: string | null }) => {
      doneMessages.push(msg.content || '')
    })

    await ctx.agent.send('loop')

    const lastMsg = doneMessages[doneMessages.length - 1]!
    expect(lastMsg).toContain('Maximum steps')
  })

  it('blocks send and emits guidance error when no LLM is configured', async () => {
    localStorage.removeItem(STORAGE_KEYS.assistantLlmConfig)
    const { ctx } = await setupAgent([])

    const events: string[] = []
    let errorMessage = ''
    ctx.on('assistant/turn-start', () => events.push('turn-start'))
    ctx.on('assistant/error', (m: string) => {
      events.push('error')
      errorMessage = m
    })
    ctx.on('assistant/turn-end', () => events.push('turn-end'))

    await ctx.agent.send('hello')

    // 不发起 LLM 请求，走 turn-start → error → turn-end 事件流供 UI 出错误气泡
    expect(events).toEqual(['turn-start', 'error', 'turn-end'])
    // 文案走 i18n（测试环境语言包可能未 merge，t() 会原样返回 key，故与 t() 对齐断言）
    expect(errorMessage).toBe(t('common.assistant.noApiConfigured'))
    expect(ctx.agent.getHistory()).toEqual([])
  })

  // ---- trimHistory：窗口必须 user 开头且非空（Anthropic 硬约束） ----

  /** user + N×(assistant(tool_calls) + tool) + 收尾 assistant 的历史 */
  function toolHeavyHistory(steps: number, toolPerStep = 1): ChatMessage[] {
    const hist: ChatMessage[] = [{ role: 'user', content: 'q' }]
    for (let i = 0; i < steps; i++) {
      hist.push({
        role: 'assistant',
        content: null,
        tool_calls: Array.from({ length: toolPerStep }, (_, j) => ({
          id: `c${i}_${j}`,
          name: 'x',
          arguments: '{}',
        })),
      })
      for (let j = 0; j < toolPerStep; j++) {
        hist.push({ role: 'tool', content: 'r', tool_call_id: `c${i}_${j}`, name: 'x' })
      }
    }
    hist.push({ role: 'assistant', content: 'final' })
    return hist
  }

  it('trimHistory keeps the window opening with a user message', async () => {
    const { ctx } = await setupAgent([])
    const agent = ctx.agent as unknown as {
      setHistory(m: ChatMessage[]): void
      trimHistory(): Promise<void>
    }
    // 22 条：跳过 tool 后窗口以 assistant(tool_calls) 开头——旧实现原样保留，
    // Anthropic 端点对 assistant-first 一律 400 且此后每轮都炸
    agent.setHistory(toolHeavyHistory(10))
    await agent.trimHistory()
    const h = ctx.agent.getHistory()
    expect(h.length).toBeGreaterThan(1)
    expect(h[0]!.role).toBe('user')
  })

  it('trimHistory never produces an empty window (>=20 parallel tool results)', async () => {
    const { ctx } = await setupAgent([])
    const agent = ctx.agent as unknown as {
      setHistory(m: ChatMessage[]): void
      trimHistory(): Promise<void>
    }
    // 22 条且尾部 20 条全是 tool：旧实现的 tool 跳过循环会推进到末尾，
    // slice 出空数组（两家端点都 400）；新实现回退到 user 起点
    agent.setHistory(toolHeavyHistory(1, 20))
    await agent.trimHistory()
    const h = ctx.agent.getHistory()
    expect(h.length).toBeGreaterThan(0)
    expect(h[0]!.role).toBe('user')
  })

  it('trimHistory archives and stubs oversized tool results under the char budget', async () => {
    const { ctx, root } = await setupAgentWithOpfs([])
    const agent = ctx.agent as unknown as {
      setHistory(m: ChatMessage[]): void
      trimHistory(): Promise<void>
    }
    // user + 34×tool(1900) ≈ 64.6k > 60k 预算：条数裁剪回退到 user 后窗口
    // 含全部 35 条，预算从最旧开始把超 TOOL_STUB_KEEP 的 tool 结果压成
    // 「前缀 + 存档指针」存根，全文可 readArchive 取回。
    // 注意 setHistory 存的是同一数组引用，trimHistory 原地改写 content——
    // 先快照原文再断言。
    const hist: ChatMessage[] = [{ role: 'user', content: 'q' }]
    for (let i = 0; i < 34; i++) {
      hist.push({ role: 'tool', content: `${i}:` + 'x'.repeat(1890), tool_call_id: `bk_${i}`, name: 'x' })
    }
    const originalContents = hist.map((m) => m.content)
    agent.setHistory(hist)
    await agent.trimHistory()

    const h = ctx.agent.getHistory()
    expect(h.length).toBeGreaterThan(0)
    expect(h[0]!.role).toBe('user')
    const stubbed = h.filter((m) => m.role === 'tool' && m.content!.includes('read_archived_result('))
    expect(stubbed.length).toBeGreaterThan(0)
    for (const m of stubbed) {
      expect(m.content!.length).toBeLessThan(700)
      expect(m.content).toContain('full result archived')
    }
    // 存根前的全文已在 OPFS 存档（首条验内容逐字一致）
    expect(await readArchive('bk_0')).toBe(originalContents[1])
    const lastStub = stubbed[stubbed.length - 1]!
    expect(await readArchive(lastStub.tool_call_id!)).toMatch(/^(\d+):x+$/)
    // 预算达标后停止压缩：较新的 tool 结果保持完整
    expect(h.some((m) => m.role === 'tool' && !m.content!.includes('read_archived_result('))).toBe(true)
    expect(root).toBeDefined()
  })

  it('trimHistory compresses replies that merely MENTION read_archived_result (anchored stub check)', async () => {
    const { ctx } = await setupAgent([])
    const agent = ctx.agent as unknown as {
      setHistory(m: ChatMessage[]): void
      trimHistory(): Promise<void>
    }
    // 旧实现用无锚点 includes('read_archived_result(')：assistant 正文里
    // 引用过函数名的消息被误判成存根、永远免于压缩，字符预算被架空
    const mention =
      'I retrieved the full listing via read_archived_result("call_x") and here is my summary. ' +
      'y'.repeat(65000)
    const hist: ChatMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: mention },
      { role: 'user', content: 'thanks' },
      { role: 'assistant', content: 'done' },
      { role: 'user', content: 'bye' },
      { role: 'assistant', content: 'bye' },
    ]
    agent.setHistory(hist)
    await agent.trimHistory()
    const m = ctx.agent.getHistory().find((x) => x.content?.includes('retrieved the full listing'))
    // 正文中引用函数名 ≠ 存根：该回复仍要被预算压缩
    expect(m).toBeDefined()
    expect(m!.content!.length).toBeLessThanOrEqual(2000 + 100)
    expect(m!.content).toContain('[earlier reply truncated for context budget]')
  })

  // ---- 自动 Compact（maybeCompact：阈值触发 → 摘要替换旧历史） ----

  /** 构造超过 COMPACT_TRIGGER_CHARS 的历史：user + 长 assistant + 收尾 */
  function oversizedHistory(): ChatMessage[] {
    return [
      { role: 'user', content: '分析一下这些数据' },
      { role: 'assistant', content: 'A'.repeat(30_000) },
      { role: 'user', content: '继续' },
      { role: 'assistant', content: 'B'.repeat(20_000) },
    ] // ≈50k > 40k 触发线
  }

  it('auto-compacts oversized history at turn boundary and emits assistant/compacted', async () => {
    // chunk 批次顺序：第 1 批给 compact 摘要请求，第 2 批给正常 turn
    const { ctx, calls } = await setupAgent([
      [
        { type: 'text-delta', text: '## Confirmed findings\n- PC 34:1 high confidence' },
        { type: 'finish', reason: 'stop' },
      ],
      [
        { type: 'text-delta', text: 'OK, continuing.' },
        { type: 'finish', reason: 'stop' },
      ],
    ])
    ctx.agent.setHistory(oversizedHistory())

    let compacted: [number, number] | null = null
    ctx.on('assistant/compacted', (before: number, after: number) => (compacted = [before, after]))

    await ctx.agent.send('下一步')

    // 摘要请求确实发出：2 次调用（compact + turn），compact 请求不带 tools
    expect(calls.length).toBe(2)
    expect(calls[0]!.tools).toBeUndefined()
    expect(calls[0]!.maxTokens).toBe(2_000)

    // 旧历史被替换为 [压缩标记 user, 摘要 assistant, 新 user, 本 turn 回复]
    const h = ctx.agent.getHistory()
    expect(h.length).toBe(4)
    expect(h[0]!.role).toBe('user')
    expect(h[0]!.content).toContain('compacted')
    expect(h[1]!.role).toBe('assistant')
    expect(h[1]!.content).toContain('PC 34:1')
    expect(h[2]!.content).toBe('下一步')
    expect(h[3]!.content).toBe('OK, continuing.')
    expect(compacted).not.toBeNull()
    expect(compacted![0]).toBeGreaterThan(40_000)
    expect(compacted![1]).toBeLessThan(1_000)
  })

  it('does not compact below the trigger threshold', async () => {
    const { ctx, calls } = await setupAgent([
      [
        { type: 'text-delta', text: 'short answer' },
        { type: 'finish', reason: 'stop' },
      ],
    ])
    ctx.agent.setHistory([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a'.repeat(1_000) },
    ])
    await ctx.agent.send('next')
    // 只有正常 turn 一次调用；历史原样 + 新 user + 回复
    expect(calls.length).toBe(1)
    const h = ctx.agent.getHistory()
    expect(h.length).toBe(4)
    expect(h[2]!.content).toBe('next')
  })

  it('compact failure (empty summary) silently falls back — user message still goes through', async () => {
    // 第 1 批 = compact 请求只吐 finish（空流）→ 摘要为空 → 放弃压缩；
    // 第 2 批 = 正常 turn 照常进行
    const { ctx, calls } = await setupAgent([
      [{ type: 'finish', reason: 'stop' }],
      [
        { type: 'text-delta', text: 'recovered' },
        { type: 'finish', reason: 'stop' },
      ],
    ])
    ctx.agent.setHistory(oversizedHistory())
    let compacted = false
    ctx.on('assistant/compacted', () => (compacted = true))

    await ctx.agent.send('下一步')

    expect(compacted).toBe(false)
    // 历史未替换（旧 4 条 + 新 user + 本 turn 回复 = 6 条），
    // 但用户消息正常入列、turn 正常完成
    const h = ctx.agent.getHistory()
    expect(h.length).toBe(6)
    expect(h[4]!.content).toBe('下一步')
    expect(calls.length).toBe(2)
  })

  it('compact history after a tool-heavy turn has no dangling tool messages', async () => {
    const { ctx } = await setupAgent([
      [
        { type: 'text-delta', text: 'summary of tool work' },
        { type: 'finish', reason: 'stop' },
      ],
      [
        { type: 'text-delta', text: 'done' },
        { type: 'finish', reason: 'stop' },
      ],
    ])
    // 完整工具轮历史（assistant(tool_calls)+tool 配对完整），总量超线
    const hist = toolHeavyHistory(10)
    for (let i = 0; i < 10; i++) {
      const t = hist.find((m) => m.role === 'tool' && m.tool_call_id === `c${i}_0`)
      if (t) t.content = 'r'.repeat(4_500) // ≈45k > 40k
    }
    ctx.agent.setHistory(hist)
    await ctx.agent.send('continue')

    const h = ctx.agent.getHistory()
    // 压缩后只剩 [标记 user, 摘要 assistant, 新 user, 本 turn 回复]，无任何 tool 消息残留
    expect(h.length).toBe(4)
    expect(h.filter((m) => m.role === 'tool')).toHaveLength(0)
  })

  // ---- 工具结果存档链路（fullContent 在截断前捕获） ----

  it('archives the full tool result and appends a recovery pointer when truncated', async () => {
    const longText = 'FULL-RESULT-'.repeat(300) // 3600 字符 > TOOL_RESULT_CHARS
    const { ctx } = await setupAgentWithOpfs([
      // step 1: tool call
      [
        { type: 'tool-call-delta', index: 0, id: 'call_big', name: 'big' },
        { type: 'tool-call-delta', index: 0, argumentsDelta: '{}' },
        { type: 'finish', reason: 'tool-calls' },
      ],
      // step 2: final text
      [{ type: 'text-delta', text: 'done' }, { type: 'finish', reason: 'stop' }],
    ])

    ctx.tools.register(
      defineTool({
        name: 'big',
        description: 'returns a long string',
        parameters: {},
        async execute() {
          return longText
        },
      }),
    )

    await ctx.agent.send('run big')

    // ToolRuntime 截断到 ≤2000，但完整全文进了 OPFS 存档
    const toolMsg = ctx.agent
      .getHistory()
      .find((m) => m.role === 'tool') as (ChatMessage & { tool_call_id?: string }) | undefined
    expect(toolMsg).toBeDefined()
    expect(toolMsg!.content!.length).toBeLessThan(2100)
    expect(toolMsg!.content).toContain('read_archived_result("call_big")')
    expect(await readArchive('call_big')).toBe(longText)
  })

  it('ToolRuntime exposes fullContent only when truncation happened', async () => {
    const { ctx } = await setupAgent([])
    ctx.tools.register(
      defineTool({
        name: 'small',
        description: 'short result',
        parameters: {},
        async execute() {
          return 'tiny'
        },
      }),
    )
    ctx.tools.register(
      defineTool({
        name: 'large',
        description: 'long result',
        parameters: {},
        async execute() {
          return 'y'.repeat(2500)
        },
      }),
    )
    const small = await ctx.tools.execute({
      callId: 'c1',
      name: 'small',
      arguments: {},
      signal: new AbortController().signal,
    })
    expect(small.content).toBe('tiny')
    expect(small.fullContent).toBeUndefined()
    const large = await ctx.tools.execute({
      callId: 'c2',
      name: 'large',
      arguments: {},
      signal: new AbortController().signal,
    })
    expect(large.content.length).toBeLessThanOrEqual(2000)
    expect(large.fullContent).toHaveLength(2500)
  })

  // ---- 多模态图片：拒图 400 的历史善后 ----

  it('strips images from persistent history when the adapter reports the model rejected images', async () => {
    // openaiAdapter 拒图降级（rejectsImages → stripImages 重发）时会回调
    // setOnImagesRejected：持久 history 里 user 消息的 images 必须被清掉，
    // 否则带图消息留在历史里，之后每条纯文字提问都重发同一张图 → 会话
    // 每轮 400 直到手动清空
    const { ctx } = await setupAgent([[{ type: 'finish', reason: 'stop' }]])
    const IMG = 'data:image/png;base64,AAAA'
    await ctx.agent.send('look at this', [IMG])
    // 模拟适配器拒图回调
    ctx.agent['stripHistoryImages']()
    const hist = ctx.agent.getHistory()
    const userMsg = hist.find((m) => m.role === 'user')!
    expect(userMsg.images).toBeUndefined()
    // 轮次结构保留：文字 + 占位提示仍在
    expect(userMsg.content).toContain('look at this')
    expect(userMsg.content).toContain('[image omitted]')
  })

  it('keeps images in history when no rejection is reported', async () => {
    const { ctx } = await setupAgent([[{ type: 'finish', reason: 'stop' }]])
    const IMG = 'data:image/png;base64,BBBB'
    await ctx.agent.send('check this', [IMG])
    const userMsg = ctx.agent.getHistory().find((m) => m.role === 'user')!
    expect(userMsg.images).toEqual([IMG])
  })

  it('trimHistory keeps only the latest user message\'s images and stubs older ones', async () => {
    // 旧图留在历史里会让每轮请求全量重传几百 KB 的 dataURL；只保留最近
    // keepRecent 窗口内最后一条带图 user 消息的图片，更早的换占位文字
    const { ctx } = await setupAgent([])
    const agent = ctx.agent as unknown as {
      setHistory(m: ChatMessage[]): void
      trimHistory(): Promise<void>
    }
    const IMG = 'data:image/png;base64,' + 'x'.repeat(100)
    const hist: ChatMessage[] = [
      { role: 'user', content: 'first pic', images: [IMG] },
      { role: 'assistant', content: 'seen it' },
      { role: 'user', content: 'second pic', images: [IMG] },
      { role: 'assistant', content: 'ok' },
    ]
    agent.setHistory(hist)
    await agent.trimHistory()
    const h = ctx.agent.getHistory()
    // 更早的带图消息：图片被剥、正文追加占位
    const first = h.find((m) => m.content === 'first pic\n[image omitted]')!
    expect(first).toBeDefined()
    expect(first.images).toBeUndefined()
    // 最后一条带图消息保留原样
    const second = h.find((m) => m.content === 'second pic')!
    expect(second).toBeDefined()
    expect(second.images).toEqual([IMG])
  })

  it('trimHistory counts image dataURLs toward the char budget', async () => {
    // 图片不计入预算 → 预算判断永远低估、旧图永不触发压缩；计费=dataURL 长度
    const { ctx } = await setupAgent([])
    const agent = ctx.agent as unknown as {
      setHistory(m: ChatMessage[]): void
      trimHistory(): Promise<void>
    }
    const bigImg = 'data:image/png;base64,' + 'y'.repeat(70_000) // 单张即超 60k 预算
    const hist: ChatMessage[] = [
      { role: 'user', content: 'q', images: [bigImg] },
      { role: 'assistant', content: 'a' },
      { role: 'user', content: 'follow-up' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'latest' }, // 把带图消息推出 keepRecent 窗口
      { role: 'assistant', content: 'c' },
    ]
    agent.setHistory(hist)
    await agent.trimHistory()
    const h = ctx.agent.getHistory()
    // 窗口外的带图消息被剥离，正文追加占位
    const stripped = h.find((m) => m.role === 'user' && m.content?.includes('[image omitted]'))
    expect(stripped).toBeDefined()
    expect(h.every((m) => !m.images?.length)).toBe(true)
  })
})
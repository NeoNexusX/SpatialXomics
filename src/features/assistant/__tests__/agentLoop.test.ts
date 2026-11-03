import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { connectionProvider } from '../providers/connection'
import { llmProvider } from '../providers/llm'
import { toolsProvider } from '../providers/tools'
import { skillsProvider } from '../providers/skills'
import { agentLoopProvider, assistantText } from '../plugins/agentLoop'
import { defineTool } from '../tools/defineTool'
import { COMPACT_SUMMARY_MAX_TOKENS } from '../agentconfig/defaults'
import { readArchive } from '../utils/opfsStore'
import { STORAGE_KEYS } from '@/shared/config/storageKeys'
import { t } from '@/i18n'
import type {
  AssistantMessage,
  AssistantPart,
  ChatMessage,
  GenerateOptions,
  LlmAdapter,
  StreamChunk,
  ToolMessage,
  UserMessage,
} from '../agenttypes/assistant'

/** 一次只有正文的模型回复 */
function textReply(text: string): StreamChunk[] {
  return [
    { type: 'text-delta', text },
    { type: 'finish', reason: 'stop', parts: [{ type: 'text', text }] },
  ]
}

/** 一次调用工具的模型回复 */
function toolReply(id: string, name: string, input: unknown = {}): StreamChunk[] {
  return [{ type: 'finish', reason: 'tool-calls', parts: [{ type: 'tool-call', id, name, input }] }]
}

const assistant = (text: string): AssistantMessage => ({
  role: 'assistant',
  parts: [{ type: 'text', text }],
})

const toolCalling = (...ids: string[]): AssistantMessage => ({
  role: 'assistant',
  parts: ids.map((id) => ({ type: 'tool-call', id, name: 'x', input: {} })),
})

/** 构造一个可控 LLM 适配器 */
function mockAdapter(chunks: StreamChunk[][]): {
  adapter: LlmAdapter
  calls: GenerateOptions[]
} {
  const calls: GenerateOptions[] = []
  let idx = 0
  const adapter: LlmAdapter = {
    endpoint: 'anthropic',
    async *stream(options) {
      calls.push({ ...options })
      for (const c of chunks[idx++] || []) yield c
    },
    listModels: async () => [],
    probeVision: async () => 'vision',
  }
  return { adapter, calls }
}

async function setupAgent(mockChunks: StreamChunk[][], customAdapter?: LlmAdapter) {
  const ctx = new Context()
  // 逐个 await 插件 fiber：服务的属性注入在插件启动后才可用，
  // 只 flush 微任务队列（await Promise.resolve()）不够，会报
  // "cannot get property \"tools\" without inject"
  await ctx.plugin(connectionProvider)
  await ctx.plugin(llmProvider)
  await ctx.plugin(toolsProvider)
  await ctx.plugin(skillsProvider)
  await ctx.plugin(agentLoopProvider)

  const { adapter, calls } = mockAdapter(mockChunks)
  ctx.llm.registerAdapter(customAdapter ?? adapter)

  return { ctx, calls }
}

function userMessage(messages: ChatMessage[], content: string): number {
  return messages.findIndex((m) => m.role === 'user' && m.content === content)
}

const agentInternals = (ctx: Context) =>
  ctx.agent as unknown as {
    setHistory(m: ChatMessage[]): void
    trimHistory(): Promise<void>
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
    // send() 的前置检查需要可用连接（测试环境无 VITE_LLM_* env，种一份用户设置）
    localStorage.setItem(
      STORAGE_KEYS.assistantConnection,
      JSON.stringify({ endpoint: 'anthropic', baseUrl: 'https://llm.test', apiKey: 'sk-test', model: 'm' }),
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
        { type: 'finish', reason: 'stop', parts: [{ type: 'text', text: 'Hello world' }] },
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
      toolReply('call_1', 'add', { a: 1, b: 2 }),
      textReply('Result: 3'),
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
    ctx.on('assistant/tool-call', (id: string, name: string) => toolCalls.push(`${id}:${name}`))
    ctx.on('assistant/tool-result', (id: string, isError: boolean) =>
      toolResults.push(`${id}:err=${isError}`),
    )

    await ctx.agent.send('add 1 and 2')

    expect(toolCalls).toEqual(['call_1:add'])
    expect(toolResults).toEqual(['call_1:err=false'])
    expect(calls.length).toBe(2)
    const toolMessage = calls[1]!.messages.find((m) => m.role === 'tool') as ToolMessage
    expect(toolMessage.content).toBe('1 + 2 = 3')
    expect(toolMessage.toolCallId).toBe('call_1')
  })

  it('stops on abort', async () => {
    const adapter: LlmAdapter = {
      endpoint: 'anthropic',
      async *stream(_options, _connection, signal) {
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
      listModels: async () => [],
      probeVision: async () => 'vision',
    }
    const { ctx } = await setupAgent([], adapter)

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
    // tool_use 在更早处，端点对此 400 且无修复路径。
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
      toolReply('call_1', 'slow'),
      textReply('ok'),
      textReply('ok2'),
      textReply('ok3'),
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

    expect(userMessage(calls[1]!.messages, 'next question')).toBeGreaterThanOrEqual(0)
    for (const c of calls.slice(2)) {
      const idx = userMessage(c.messages, 'next question')
      expect(idx).toBeGreaterThanOrEqual(0)
      // user('next question') 之后不得出现任何 tool 消息（其配对的 tool_use 在 user 之前）
      expect(c.messages.slice(idx + 1).filter((m) => m.role === 'tool')).toHaveLength(0)
    }
  })

  it('stops at MAX_AGENT_STEPS', async () => {
    // 构造永远返回工具调用的适配器（死循环模拟）
    const steps = Array.from({ length: 10 }, (_, i) => toolReply(`call_${i}`, 'add', { a: 1, b: 1 }))

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
    const deltas: string[] = []
    ctx.on('assistant/message-done', (msg) => doneMessages.push(assistantText(msg)))
    ctx.on('assistant/message-delta', (d) => deltas.push(d))

    await ctx.agent.send('loop')

    expect(doneMessages[doneMessages.length - 1]).toContain('Maximum steps')
    // 提示要让用户看到，不能只进历史
    expect(deltas.join('')).toContain('Maximum steps')
  })

  it('blocks send and emits guidance error when no connection is configured', async () => {
    localStorage.removeItem(STORAGE_KEYS.assistantConnection)
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

    // 不发起 LLM 请求，走 turn-start → error → turn-end 事件流供 UI 出错误提示
    expect(events).toEqual(['turn-start', 'error', 'turn-end'])
    // 文案走 i18n（测试环境语言包可能未 merge，t() 会原样返回 key，故与 t() 对齐断言）
    expect(errorMessage).toBe(t('common.assistant.noApiConfigured'))
    expect(ctx.agent.getHistory()).toEqual([])
  })

  // ---- 思考块回放 ----

  const THINKING: AssistantPart = {
    type: 'reasoning',
    text: 'I should call the tool',
    replay: { signature: 'sig-1' },
  }

  it('keeps thinking blocks in order and replays them in later steps and later turns', async () => {
    const ordered: AssistantPart[] = [
      THINKING,
      { type: 'text', text: 'Let me check.' },
      { type: 'tool-call', id: 'call_1', name: 'noop', input: {} },
    ]
    const { ctx, calls } = await setupAgent([
      [{ type: 'finish', reason: 'tool-calls', parts: ordered }],
      textReply('done'),
      textReply('next answer'),
    ])
    ctx.tools.register(
      defineTool({ name: 'noop', description: 'noop', parameters: {}, execute: async () => 'ok' }),
    )

    await ctx.agent.send('first')
    await ctx.agent.send('second')

    const replayed = (messages: ChatMessage[]) =>
      (messages.find((m) => m.role === 'assistant') as AssistantMessage).parts
    // 同一回合的下一步
    expect(replayed(calls[1]!.messages)).toEqual(ordered)
    // 下一回合：带 tools 的请求要求所有历史回合的思考块都回传
    expect(replayed(calls[2]!.messages)).toEqual(ordered)
  })

  it('freezes the system prompt within a turn', async () => {
    const { ctx, calls } = await setupAgent([toolReply('call_1', 'noop'), textReply('done')])
    ctx.tools.register(
      defineTool({ name: 'noop', description: 'noop', parameters: {}, execute: async () => 'ok' }),
    )
    const assemble = vi.spyOn(ctx.agent as never, 'assembleSystemPrompt' as never)

    await ctx.agent.send('go')

    expect(assemble).toHaveBeenCalledTimes(1)
    expect(calls[0]!.system).toBe(calls[1]!.system)
  })

  it('does not edit history in the middle of a turn', async () => {
    const IMG = 'data:image/png;base64,AAAA'
    const { ctx, calls } = await setupAgent([
      toolReply('call_1', 'noop'),
      toolReply('call_2', 'noop'),
      toolReply('call_3', 'noop'),
      textReply('done'),
    ])
    ctx.tools.register(
      defineTool({ name: 'noop', description: 'noop', parameters: {}, execute: async () => 'ok' }),
    )

    await ctx.agent.send('look', [IMG])

    // 工具轮次把带图消息推出了「最近 4 条」窗口，回合内也不能替换它
    const user = calls[3]!.messages[0] as UserMessage
    expect(user.images).toEqual([IMG])
    expect(user.content).toBe('look')
  })

  // ---- 中断后的历史 ----

  it('answers interrupted tool calls before the next turn', async () => {
    let releaseTool!: () => void
    const { ctx, calls } = await setupAgent([
      [
        {
          type: 'finish',
          reason: 'tool-calls',
          parts: [
            { type: 'tool-call', id: 'call_a', name: 'slow', input: {} },
            { type: 'tool-call', id: 'call_b', name: 'slow', input: {} },
          ],
        },
      ],
      textReply('recovered'),
    ])
    ctx.tools.register(
      defineTool({
        name: 'slow',
        description: 'slow',
        parameters: {},
        execute: () => new Promise<string>((r) => (releaseTool = () => r('late'))),
      }),
    )

    const first = ctx.agent.send('run')
    await new Promise((r) => setTimeout(r, 20))
    ctx.agent.stop()
    releaseTool()
    await first
    await ctx.agent.send('continue')

    const messages = calls[1]!.messages
    const idx = userMessage(messages, 'continue')
    const results = messages.slice(0, idx).filter((m): m is ToolMessage => m.role === 'tool')
    expect(results.map((m) => m.toolCallId).sort()).toEqual(['call_a', 'call_b'])
    expect(results.every((m) => m.isError)).toBe(true)
  })

  it('dropLastTurn rewinds to before the last user message', async () => {
    const { ctx } = await setupAgent([])
    ctx.agent.setHistory([
      { role: 'user', content: 'one' },
      assistant('reply one'),
      { role: 'user', content: 'two' },
      toolCalling('c1'),
      { role: 'tool', toolCallId: 'c1', name: 'x', content: 'r' },
    ])
    ctx.agent.dropLastTurn()
    expect(ctx.agent.getHistory()).toEqual([{ role: 'user', content: 'one' }, assistant('reply one')])
  })

  // ---- 结束原因 ----

  it('reports errors without writing the partial reply to history', async () => {
    const { ctx } = await setupAgent([
      [
        { type: 'text-delta', text: 'partial' },
        { type: 'finish', reason: 'error', parts: [], error: 'HTTP 500' },
      ],
    ])
    const errors: string[] = []
    ctx.on('assistant/error', (m: string) => errors.push(m))

    await ctx.agent.send('q')

    expect(errors).toEqual(['HTTP 500'])
    expect(ctx.agent.getHistory()).toEqual([{ role: 'user', content: 'q' }])
  })

  it('reports refusals with a dedicated message', async () => {
    const { ctx } = await setupAgent([[{ type: 'finish', reason: 'refusal', parts: [] }]])
    const errors: string[] = []
    ctx.on('assistant/error', (m: string) => errors.push(m))

    await ctx.agent.send('q')

    expect(errors).toEqual([t('common.assistant.errors.refused')])
  })

  it('keeps the text but runs no tools when the output limit is hit', async () => {
    const { ctx, calls } = await setupAgent([
      [
        {
          type: 'finish',
          reason: 'length',
          parts: [
            { type: 'text', text: 'long answer' },
            { type: 'tool-call', id: 'c1', name: 'noop', input: {} },
          ],
        },
      ],
    ])
    const errors: string[] = []
    ctx.on('assistant/error', (m: string) => errors.push(m))

    await ctx.agent.send('q')

    expect(calls.length).toBe(1)
    expect(errors).toEqual([t('common.assistant.errors.outputLimit')])
    expect(ctx.agent.getHistory()[1]).toEqual(assistant('long answer'))
  })

  it('does not write a thinking-only reply to history', async () => {
    const { ctx } = await setupAgent([[{ type: 'finish', reason: 'stop', parts: [THINKING] }]])
    await ctx.agent.send('q')
    expect(ctx.agent.getHistory()).toEqual([{ role: 'user', content: 'q' }])
  })

  // ---- trimHistory ----

  it('trimHistory archives and stubs oversized tool results under the char budget', async () => {
    const { ctx, root } = await setupAgentWithOpfs([])
    // user + 34×tool(1900) ≈ 64.6k > 60k 预算：预算从最旧开始把超 TOOL_STUB_KEEP 的
    // tool 结果压成「前缀 + 存档指针」存根，全文可 readArchive 取回。
    const hist: ChatMessage[] = [{ role: 'user', content: 'q' }]
    const originals: string[] = []
    for (let i = 0; i < 34; i++) {
      const content = `${i}:` + 'x'.repeat(1890)
      originals.push(content)
      hist.push({ role: 'tool', content, toolCallId: `bk_${i}`, name: 'x' })
    }
    agentInternals(ctx).setHistory(hist)
    await agentInternals(ctx).trimHistory()

    const tools = ctx.agent.getHistory().filter((m): m is ToolMessage => m.role === 'tool')
    const stubbed = tools.filter((m) => m.content.includes('read_archived_result('))
    expect(stubbed.length).toBeGreaterThan(0)
    for (const m of stubbed) {
      expect(m.content.length).toBeLessThan(700)
      expect(m.content).toContain('full result archived')
    }
    // 存根前的全文已在 OPFS 存档（首条验内容逐字一致）
    expect(await readArchive('bk_0')).toBe(originals[0])
    expect(await readArchive(stubbed[stubbed.length - 1]!.toolCallId)).toMatch(/^(\d+):x+$/)
    // 预算达标后停止压缩：较新的 tool 结果保持完整
    expect(tools.some((m) => !m.content.includes('read_archived_result('))).toBe(true)
    expect(root).toBeDefined()
  })

  it('trimHistory compresses replies that merely MENTION read_archived_result (anchored stub check)', async () => {
    const { ctx } = await setupAgent([])
    // 正文中引用函数名 ≠ 存根：该回复仍要被预算压缩
    const mention =
      'I retrieved the full listing via read_archived_result("call_x") and here is my summary. ' +
      'y'.repeat(65000)
    agentInternals(ctx).setHistory([
      { role: 'user', content: 'q' },
      assistant(mention),
      { role: 'user', content: 'thanks' },
      assistant('done'),
      { role: 'user', content: 'bye' },
      assistant('bye'),
    ])
    await agentInternals(ctx).trimHistory()
    const text = assistantText(ctx.agent.getHistory()[1] as AssistantMessage)
    expect(text.length).toBeLessThanOrEqual(2000 + 100)
    expect(text).toContain('[earlier reply truncated for context budget]')
  })

  it('trimHistory leaves thinking blocks and tool calls alone when shortening a reply', async () => {
    const { ctx } = await setupAgent([])
    const call: AssistantPart = { type: 'tool-call', id: 'c1', name: 'x', input: {} }
    agentInternals(ctx).setHistory([
      { role: 'user', content: 'q' },
      { role: 'assistant', parts: [THINKING, { type: 'text', text: 'y'.repeat(65000) }, call] },
      { role: 'tool', toolCallId: 'c1', name: 'x', content: 'r' },
      { role: 'user', content: 'next' },
      assistant('a'),
      { role: 'user', content: 'latest' },
    ])
    await agentInternals(ctx).trimHistory()
    const { parts } = ctx.agent.getHistory()[1] as AssistantMessage
    expect(parts[0]).toEqual(THINKING)
    expect(parts[2]).toEqual(call)
    expect((parts[1] as { text: string }).text.length).toBeLessThan(2200)
  })

  it('does not slide a message-count window over history', async () => {
    const { ctx } = await setupAgent([])
    const hist: ChatMessage[] = [{ role: 'user', content: 'q' }]
    for (let i = 0; i < 30; i++) {
      hist.push(toolCalling(`c${i}`))
      hist.push({ role: 'tool', toolCallId: `c${i}`, name: 'x', content: 'r' })
    }
    agentInternals(ctx).setHistory(hist)
    await agentInternals(ctx).trimHistory()
    expect(ctx.agent.getHistory()).toHaveLength(hist.length)
  })

  // ---- 自动 Compact（maybeCompact：阈值触发 → 摘要替换旧历史） ----

  /** 构造超过 COMPACT_TRIGGER_CHARS 的历史：user + 长 assistant + 收尾 */
  function oversizedHistory(): ChatMessage[] {
    return [
      { role: 'user', content: '分析一下这些数据' },
      assistant('A'.repeat(30_000)),
      { role: 'user', content: '继续' },
      assistant('B'.repeat(20_000)),
    ] // ≈50k > 40k 触发线
  }

  it('auto-compacts oversized history at turn boundary and emits assistant/compacted', async () => {
    // chunk 批次顺序：第 1 批给 compact 摘要请求，第 2 批给正常 turn
    const { ctx, calls } = await setupAgent([
      textReply('## Confirmed findings\n- PC 34:1 high confidence'),
      textReply('OK, continuing.'),
    ])
    ctx.agent.setHistory(oversizedHistory())

    let compacted: [number, number] | null = null
    ctx.on('assistant/compacted', (before: number, after: number) => (compacted = [before, after]))

    await ctx.agent.send('下一步')

    // 摘要请求确实发出：2 次调用（compact + turn），compact 请求不带 tools
    expect(calls.length).toBe(2)
    expect(calls[0]!.tools).toBeUndefined()
    expect(calls[0]!.maxTokens).toBe(COMPACT_SUMMARY_MAX_TOKENS)

    // 旧历史被替换为 [压缩标记 user, 摘要 assistant, 新 user, 本 turn 回复]
    const h = ctx.agent.getHistory()
    expect(h.length).toBe(4)
    expect((h[0] as UserMessage).content).toContain('compacted')
    expect(assistantText(h[1] as AssistantMessage)).toContain('PC 34:1')
    expect((h[2] as UserMessage).content).toBe('下一步')
    expect(assistantText(h[3] as AssistantMessage)).toBe('OK, continuing.')
    expect(compacted).not.toBeNull()
    expect(compacted![0]).toBeGreaterThan(40_000)
    expect(compacted![1]).toBeLessThan(1_000)
  })

  it('does not compact below the trigger threshold', async () => {
    const { ctx, calls } = await setupAgent([textReply('short answer')])
    ctx.agent.setHistory([{ role: 'user', content: 'q' }, assistant('a'.repeat(1_000))])
    await ctx.agent.send('next')
    // 只有正常 turn 一次调用；历史原样 + 新 user + 回复
    expect(calls.length).toBe(1)
    const h = ctx.agent.getHistory()
    expect(h.length).toBe(4)
    expect((h[2] as UserMessage).content).toBe('next')
  })

  it('counts an image as a flat cost so one screenshot does not trigger compaction', async () => {
    const { ctx, calls } = await setupAgent([textReply('answer')])
    ctx.agent.setHistory([
      { role: 'user', content: 'look', images: ['data:image/png;base64,' + 'x'.repeat(500_000)] },
      assistant('seen'),
    ])
    await ctx.agent.send('tell me more about it')
    expect(calls.length).toBe(1)
    expect((ctx.agent.getHistory()[0] as UserMessage).images).toHaveLength(1)
  })

  it('compact failure (empty summary) silently falls back — user message still goes through', async () => {
    // 第 1 批 = compact 请求只吐 finish（空流）→ 摘要为空 → 放弃压缩；
    // 第 2 批 = 正常 turn 照常进行
    const { ctx, calls } = await setupAgent([
      [{ type: 'finish', reason: 'stop', parts: [] }],
      textReply('recovered'),
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
    expect((h[4] as UserMessage).content).toBe('下一步')
    expect(calls.length).toBe(2)
  })

  it('compact history after a tool-heavy turn has no dangling tool messages', async () => {
    const { ctx } = await setupAgent([textReply('summary of tool work'), textReply('done')])
    const hist: ChatMessage[] = [{ role: 'user', content: 'q' }]
    for (let i = 0; i < 10; i++) {
      hist.push(toolCalling(`c${i}`))
      hist.push({ role: 'tool', toolCallId: `c${i}`, name: 'x', content: 'r'.repeat(4_500) }) // ≈45k > 40k
    }
    hist.push(assistant('final'))
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
    const { ctx } = await setupAgentWithOpfs([toolReply('call_big', 'big'), textReply('done')])

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
    const toolMsg = ctx.agent.getHistory().find((m): m is ToolMessage => m.role === 'tool')
    expect(toolMsg).toBeDefined()
    expect(toolMsg!.content.length).toBeLessThan(2100)
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

  // ---- 多模态图片 ----

  it('keeps images in history for follow-up questions', async () => {
    const { ctx } = await setupAgent([[{ type: 'finish', reason: 'stop', parts: [] }]])
    const IMG = 'data:image/png;base64,BBBB'
    await ctx.agent.send('check this', [IMG])
    const userMsg = ctx.agent.getHistory().find((m): m is UserMessage => m.role === 'user')!
    expect(userMsg.images).toEqual([IMG])
  })

  it("trimHistory keeps only the latest user message's images and stubs older ones", async () => {
    // 旧图留在历史里会让每轮请求全量重传几百 KB 的 dataURL；只保留最近
    // keepRecent 窗口内最后一条带图 user 消息的图片，更早的换占位文字
    const { ctx } = await setupAgent([])
    const IMG = 'data:image/png;base64,' + 'x'.repeat(100)
    agentInternals(ctx).setHistory([
      { role: 'user', content: 'first pic', images: [IMG] },
      assistant('seen it'),
      { role: 'user', content: 'second pic', images: [IMG] },
      assistant('ok'),
    ])
    await agentInternals(ctx).trimHistory()
    const [first, , second] = ctx.agent.getHistory() as UserMessage[]
    // 更早的带图消息：图片被剥、正文追加占位
    expect(first!.content).toBe('first pic\n[image omitted]')
    expect(first!.images).toBeUndefined()
    // 最后一条带图消息保留原样
    expect(second!.content).toBe('second pic')
    expect(second!.images).toEqual([IMG])
  })

  it('trimHistory strips an image that has aged out of the recent window', async () => {
    const { ctx } = await setupAgent([])
    agentInternals(ctx).setHistory([
      { role: 'user', content: 'q', images: ['data:image/png;base64,yyyy'] },
      assistant('a'),
      { role: 'user', content: 'follow-up' },
      assistant('b'),
      { role: 'user', content: 'latest' }, // 把带图消息推出 keepRecent 窗口
      assistant('c'),
    ])
    await agentInternals(ctx).trimHistory()
    const users = ctx.agent.getHistory().filter((m): m is UserMessage => m.role === 'user')
    expect(users[0]!.content).toContain('[image omitted]')
    expect(users.every((m) => !m.images?.length)).toBe(true)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEYS } from '@/shared/config/storageKeys'
import type { ChatMessage, UiChatItem, UiPart } from '../agenttypes/assistant'

type Handler = (...args: never[]) => void

/** 只保留事件总线和 agent 的假运行时：这里测的是事件 → 界面状态这一层 */
const runtime = vi.hoisted(() => ({
  handlers: new Map<string, Handler[]>(),
  agent: {
    send: vi.fn(async () => {}),
    stop: vi.fn(),
    clearHistory: vi.fn(),
    setHistory: vi.fn(),
    dropLastTurn: vi.fn(),
  },
}))

function emit(event: string, ...args: unknown[]): void {
  for (const handler of runtime.handlers.get(event) ?? [])
    (handler as (...a: unknown[]) => void)(...args)
}

vi.mock('../plugins', () => {
  const ctx = {
    agent: runtime.agent,
    on: (event: string, handler: Handler) => {
      runtime.handlers.set(event, [...(runtime.handlers.get(event) ?? []), handler])
    },
    inject: (_deps: string[], callback: (c: unknown) => void) =>
      callback({ agent: runtime.agent, skills: { catalog: () => [] } }),
  }
  return { getAssistantContext: () => ctx, whenAssistantReady: async () => ctx }
})

vi.mock('vue-i18n', async (original) => ({
  ...(await original<typeof import('vue-i18n')>()),
  useI18n: () => ({ t: (key: string) => key }),
}))

async function setup() {
  vi.resetModules()
  runtime.handlers.clear()
  const { useAssistant } = await import('../composables/useAssistant')
  return useAssistant()
}

const reply = (messages: UiChatItem[]) => messages[messages.length - 1]!
const partTypes = (item: UiChatItem) => item.parts?.map((p) => p.type)

describe('useAssistant', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('builds parts in the order they happen', async () => {
    const { messages } = await setup()
    emit('assistant/turn-start')
    emit('assistant/reasoning-delta', 'need ')
    emit('assistant/reasoning-delta', 'data')
    emit('assistant/message-delta', 'Checking.')
    emit('assistant/tool-call', 'c1', 'get_page_state', { a: 1 })
    emit('assistant/tool-result', 'c1', false, 'state')
    emit('assistant/reasoning-delta', 'now answer')
    emit('assistant/message-delta', 'Done.')
    emit('assistant/turn-end', false)

    const item = reply(messages.value)
    expect(partTypes(item)).toEqual(['reasoning', 'text', 'tool', 'reasoning', 'text'])
    expect(item.parts![0]).toEqual({ type: 'reasoning', text: 'need data', active: false })
    expect(item.parts![2]).toMatchObject({ id: 'c1', state: 'done', preview: 'state' })
    // 不同步骤的正文复制时隔开，不粘在一起
    expect(item.content).toBe('Checking.\n\nDone.')
    expect(item.pending).toBe(false)
  })

  it('keeps reasoning active only until the reply or a tool call starts', async () => {
    const { messages } = await setup()
    emit('assistant/turn-start')
    emit('assistant/reasoning-delta', 'hmm')
    const active = () =>
      (reply(messages.value).parts![0] as Extract<UiPart, { type: 'reasoning' }>).active
    expect(active()).toBe(true)
    emit('assistant/message-delta', 'ok')
    expect(active()).toBe(false)
  })

  it('matches results to tool calls by id, even with the same tool twice', async () => {
    const { messages } = await setup()
    emit('assistant/turn-start')
    emit('assistant/tool-call', 'c1', 'lookup', {})
    emit('assistant/tool-call', 'c2', 'lookup', {})
    emit('assistant/tool-result', 'c1', true, 'failed')
    const [first, second] = reply(messages.value).parts as Extract<UiPart, { type: 'tool' }>[]
    expect(first).toMatchObject({ state: 'error', preview: 'failed' })
    expect(second).toMatchObject({ state: 'running', preview: '' })
  })

  it('marks unfinished tools as stopped when the turn is interrupted', async () => {
    const { messages } = await setup()
    emit('assistant/turn-start')
    emit('assistant/reasoning-delta', 'hmm')
    emit('assistant/tool-call', 'c1', 'slow', {})
    emit('assistant/turn-end', true)

    const item = reply(messages.value)
    expect(item.interrupted).toBe(true)
    expect(item.parts![1]).toMatchObject({ state: 'stopped' })
    expect(item.error).toBeUndefined()
  })

  it('shows the turn error on its reply', async () => {
    const { messages, streaming } = await setup()
    emit('assistant/turn-start')
    expect(streaming.value).toBe(true)
    emit('assistant/message-delta', 'partial')
    emit('assistant/error', 'HTTP 500')
    emit('assistant/turn-end', false)

    const item = reply(messages.value)
    expect(item.error).toBe('HTTP 500')
    expect(item.content).toBe('partial')
    expect(streaming.value).toBe(false)
  })

  it('never leaves a blank reply', async () => {
    const { messages } = await setup()
    emit('assistant/turn-start')
    emit('assistant/turn-end', false)
    expect(reply(messages.value).error).toBeTruthy()
  })

  it('places the compaction notice before the reply it happened in', async () => {
    const { messages } = await setup()
    emit('assistant/turn-start')
    emit('assistant/compacted', 50_000, 800)
    emit('assistant/message-delta', 'answer')
    emit('assistant/turn-end', false)

    const [notice, answer] = messages.value
    expect(notice!.compacted).toBe(true)
    expect(answer!.content).toBe('answer')
  })

  it('retries without duplicating the user message', async () => {
    const { messages, send, retry } = await setup()
    await send('question', ['data:image/png;base64,AAAA'])
    emit('assistant/turn-start')
    emit('assistant/error', 'boom')
    emit('assistant/turn-end', false)
    expect(messages.value).toHaveLength(2)
    runtime.agent.send.mockClear()

    await retry()

    expect(messages.value.map((m) => m.role)).toEqual(['user'])
    expect(runtime.agent.dropLastTurn).toHaveBeenCalledOnce()
    expect(runtime.agent.send).toHaveBeenCalledWith('question', ['data:image/png;base64,AAAA'])
  })

  it('does not retry while a turn is running', async () => {
    const { send, retry } = await setup()
    await send('question')
    emit('assistant/turn-start')
    runtime.agent.send.mockClear()
    await retry()
    expect(runtime.agent.send).not.toHaveBeenCalled()
  })

  it('restores saved messages into the model history as plain text', async () => {
    const saved: UiChatItem[] = [
      { id: '1', role: 'user', content: 'hi', images: ['data:image/png;base64,AAAA'] },
      {
        id: '2',
        role: 'assistant',
        content: 'hello',
        parts: [
          { type: 'reasoning', text: 'x', active: false },
          { type: 'text', text: 'hello' },
        ],
      },
      { id: '3', role: 'assistant', content: 'notice', compacted: true },
      { id: '4', role: 'user', content: 'again' },
      { id: '5', role: 'assistant', content: '', error: 'boom' },
    ]
    localStorage.setItem(STORAGE_KEYS.assistantHistory, JSON.stringify(saved))

    await setup()

    const expected: ChatMessage[] = [
      { role: 'user', content: 'hi', images: ['data:image/png;base64,AAAA'] },
      { role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
      { role: 'user', content: 'again' },
    ]
    expect(runtime.agent.setHistory).toHaveBeenCalledWith(expected)
  })

  it('does not persist in-progress state', async () => {
    const { send } = await setup()
    await send('question')
    emit('assistant/turn-start')
    emit('assistant/reasoning-delta', 'hmm')
    emit('assistant/tool-call', 'c1', 'slow', {})
    emit('assistant/compacted', 50_000, 800) // 回合中途也会存一次

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.assistantHistory)!) as UiChatItem[]
    const item = stored[stored.length - 1]!
    expect(item.pending).toBe(false)
    expect(item.parts![0]).toMatchObject({ active: false })
    expect(item.parts![1]).toMatchObject({ state: 'stopped' })
  })
})

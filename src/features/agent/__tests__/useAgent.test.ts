import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSnapshot } from '../plugins/agent'

const runtime = vi.hoisted(() => ({
  listener: undefined as ((snapshot: AgentSnapshot) => void) | undefined,
  agent: {
    ready: vi.fn(async () => {}),
    subscribe: vi.fn(),
    send: vi.fn(async () => true),
    stop: vi.fn(),
    regenerate: vi.fn(),
    compact: vi.fn(),
    retrySave: vi.fn(),
  },
}))
vi.mock('../bootstrap', () => ({
  whenAgentReady: async () => ({ agent: runtime.agent, skills: { catalog: () => [] } }),
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const empty = (): AgentSnapshot => ({
  sessionId: 's',
  phase: 'idle',
  mode: 'temporary',
  messages: [],
  error: null,
})

async function setup() {
  vi.resetModules()
  runtime.agent.subscribe.mockImplementation((listener) => {
    runtime.listener = listener
    listener(empty())
    return () => {}
  })
  const { useAgent } = await import('../composables/useAgent')
  const api = useAgent()
  await vi.waitFor(() => expect(runtime.listener).toBeDefined())
  return api
}

beforeEach(() => {
  vi.clearAllMocks()
  runtime.listener = undefined
  localStorage.clear()
})
describe('useAgent session bridge', () => {
  it('renders session snapshots without restoring UI text into a model history', async () => {
    localStorage.setItem('assistant_chat_history', '[{"content":"old"}]')
    const api = await setup()
    expect(api.messages.value).toEqual([])
    runtime.listener!({
      ...empty(),
      messages: [
        {
          id: 'a',
          role: 'assistant',
          content: 'restored',
          parts: [{ type: 'reasoning', text: 'reason', active: false }],
        },
      ],
    })
    expect(api.messages.value[0]?.content).toBe('restored')
  })

  it('derives busy status through preparation, generation and stopping', async () => {
    const api = await setup()
    for (const phase of ['preparing', 'generating', 'stopping'] as const) {
      runtime.listener!({ ...empty(), phase })
      expect(api.streaming.value).toBe(true)
    }
    runtime.listener!(empty())
    expect(api.streaming.value).toBe(false)
  })

  it('forwards explicit commands to the public agent interface', async () => {
    const api = await setup()
    expect(await api.send('hello')).toBe(true)
    await api.stop()
    await api.retry()
    await api.compact()
    await api.retrySave()
    expect(runtime.agent.send).toHaveBeenCalledWith('hello', undefined)
    for (const name of ['stop', 'regenerate', 'compact', 'retrySave'] as const)
      expect(runtime.agent[name]).toHaveBeenCalledOnce()
  })

  it('shows a divider while compacting, where the finished marker will appear', async () => {
    const api = await setup()
    const user = { id: 'u', role: 'user' as const, content: 'q' }
    const reply = { id: 'r', role: 'assistant' as const, content: '', pending: true }
    const ids = () => api.messages.value.map((item) => item.id)

    runtime.listener!({ ...empty(), phase: 'compacting', messages: [user, reply] })
    expect(ids()).toEqual(['u', 'compacting', 'r'])
    expect(api.messages.value[1]).toMatchObject({
      compacted: true,
      pending: true,
      content: 'common.agent.compacting',
    })

    runtime.listener!({ ...empty(), phase: 'compacting', messages: [user] })
    expect(ids()).toEqual(['u', 'compacting'])

    // 空对话压缩不能把居中的欢迎界面顶走
    runtime.listener!({ ...empty(), phase: 'compacting' })
    expect(ids()).toEqual([])

    runtime.listener!({ ...empty(), phase: 'generating', messages: [user, reply] })
    expect(ids()).toEqual(['u', 'r'])
  })

  it('pages only the transcript and resets the window on session changes', async () => {
    const api = await setup()
    const messages = Array.from({ length: 130 }, (_, i) => ({
      id: String(i),
      role: 'user' as const,
      content: String(i),
    }))
    runtime.listener!({ ...empty(), messages })
    expect(api.messages.value).toHaveLength(100)
    expect(api.earlierAvailable.value).toBe(true)
    await api.loadEarlier()
    expect(api.messages.value).toHaveLength(130)
    runtime.listener!({ ...empty(), sessionId: 'new', messages })
    expect(api.messages.value).toHaveLength(100)
  })
})

/** 多对话的流程：新建、切换、删除、导入，以及运行中不能切换 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAgentDataset } from '../bridge/datasetBinding'
import { MAX_SESSIONS, SessionBusyError, SessionLimitError } from '../plugins/session-persistence'
import type { SessionArchive } from '../plugins/session-persistence'
import { createLockedAgent, text, toolCall, type LockedAgent } from './lockedAgent'

const open: LockedAgent[] = []
async function setup(...args: Parameters<typeof createLockedAgent>) {
  const h = await createLockedAgent(...args)
  await h.agent.ready()
  open.push(h)
  return h
}
async function turn(h: LockedAgent, value = 'question') {
  const accepted = await h.agent.send(value)
  await h.agent.whenIdle()
  return accepted
}
const contents = (h: LockedAgent) =>
  h.agent
    .snapshot()
    .messages.filter((item) => item.role === 'user')
    .map((item) => item.content)
const currentId = (h: LockedAgent) => h.agent.snapshot().sessionId
const lastCall = (h: LockedAgent) => JSON.stringify(h.calls[h.calls.length - 1]!.messages)
const answers = (count: number) => Array.from({ length: count }, (_, i) => text(`answer ${i}`))

/** 填满对话上限，返回各段对话的 id，最后一段是当前对话 */
async function fill(h: LockedAgent) {
  const ids: string[] = []
  for (let i = 0; i < MAX_SESSIONS; i++) {
    if (i > 0) await h.agent.newConversation()
    await turn(h, `conversation ${i}`)
    ids.push(currentId(h))
  }
  return ids
}

async function archiveOf(h: LockedAgent, id = currentId(h)): Promise<SessionArchive> {
  const storage = h.storages.find((entry) => entry.storage.id === id)!.storage
  return { id: 'imported-id', batches: await storage.read(), artifacts: new Map() }
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(
    'assistant_connection',
    JSON.stringify({ endpoint: 'anthropic', baseUrl: 'https://llm.test', apiKey: 'k', model: 'm' }),
  )
  setAgentDataset('dataset-a', true)
})

afterEach(async () => {
  for (const h of open.splice(0)) await h.dispose()
})

describe('starting and switching', () => {
  it('keeps the previous conversation and can go back to continue it', async () => {
    const h = await setup(answers(3))
    await turn(h, 'first')
    const first = currentId(h)
    await h.agent.newConversation()
    const second = currentId(h)
    expect(second).not.toBe(first)
    expect(contents(h)).toEqual([])
    await turn(h, 'second')

    await h.agent.openConversation(first)
    expect(currentId(h)).toBe(first)
    expect(contents(h)).toEqual(['first'])
    expect(await turn(h, 'first again')).toBe(true)
    expect(contents(h)).toEqual(['first', 'first again'])
    // 模型看到的是这段对话自己的历史，不混入另一段
    expect(lastCall(h)).not.toContain('second')
  })

  it('stays put when the current conversation is still blank', async () => {
    const h = await setup()
    const blank = currentId(h)
    await h.agent.newConversation()
    expect(currentId(h)).toBe(blank)
  })

  it('does nothing when asked for the conversation already open', async () => {
    const h = await setup(answers(1))
    await turn(h)
    const current = currentId(h)
    await h.agent.openConversation(current)
    expect(currentId(h)).toBe(current)
    expect(h.agent.snapshot().phase).toBe('idle')
    expect(contents(h)).toEqual(['question'])
  })

  it('leaves the current conversation untouched at the limit', async () => {
    const h = await setup(answers(MAX_SESSIONS + 1))
    const ids = await fill(h)
    await expect(h.agent.newConversation()).rejects.toBeInstanceOf(SessionLimitError)
    expect(currentId(h)).toBe(ids[ids.length - 1])
    expect(h.agent.snapshot().phase).toBe('idle')
    expect(h.agent.snapshot().error).toBeNull()
    expect(await turn(h, 'still works')).toBe(true)
  })

  it('leaves the current conversation untouched when the target cannot be opened', async () => {
    const h = await setup(answers(2))
    await turn(h, 'first')
    const first = currentId(h)
    await expect(h.agent.openConversation('gone')).rejects.toThrow()
    expect(currentId(h)).toBe(first)
    expect(h.agent.snapshot().error).toBeNull()
    expect(await turn(h, 'next')).toBe(true)
  })

  it('leaves the current conversation untouched when the target log is damaged', async () => {
    const h = await setup(answers(2))
    await turn(h, 'first')
    const first = currentId(h)
    await h.agent.newConversation()
    await turn(h, 'second')
    const second = currentId(h)
    const damaged = h.storages.find((entry) => entry.storage.id === first)!.storage
    const read = damaged.read.bind(damaged)
    damaged.read = async () => {
      throw new Error('Session log is corrupted')
    }
    await expect(h.agent.openConversation(first)).rejects.toThrow('corrupted')
    expect(currentId(h)).toBe(second)
    expect(h.agent.snapshot().phase).toBe('idle')
    damaged.read = read
  })

  it('lists only conversations that have a question, for the current dataset', async () => {
    const h = await setup(answers(2))
    expect(await h.agent.conversations()).toEqual([])
    await turn(h, 'in a')
    expect((await h.agent.conversations()).map((item) => item.title)).toEqual(['in a'])

    setAgentDataset('dataset-b', true)
    await vi.waitFor(() => expect(contents(h)).toEqual([]))
    expect(await h.agent.conversations()).toEqual([])
    await turn(h, 'in b')
    expect((await h.agent.conversations()).map((item) => item.title)).toEqual(['in b'])

    setAgentDataset('dataset-a', true)
    await vi.waitFor(() => expect(contents(h)).toEqual(['in a']))
    expect((await h.agent.conversations()).map((item) => item.title)).toEqual(['in a'])
  })
})

describe('when the conversation that should open cannot be read', () => {
  async function broken() {
    const h = await setup(answers(3))
    await turn(h, 'damaged')
    const damaged = currentId(h)
    await h.agent.newConversation()
    await turn(h, 'healthy')
    const healthy = currentId(h)
    await h.agent.openConversation(damaged)
    const storage = h.storages.find((entry) => entry.storage.id === damaged)!.storage
    storage.read = async () => {
      throw new Error('Session log is corrupted')
    }
    // 换数据集再换回来，等于重新打开这段对话
    setAgentDataset('dataset-b', true)
    await vi.waitFor(() => expect(contents(h)).toEqual([]))
    setAgentDataset('dataset-a', true)
    await vi.waitFor(() => expect(h.agent.snapshot().phase).toBe('storage-error'))
    return { h, damaged, healthy }
  }

  it('reports the failure, with no conversation open', async () => {
    const { h } = await broken()
    expect(currentId(h)).toBe('')
    expect(h.agent.snapshot().error).toContain('corrupted')
  })

  it('can switch away, which clears the error', async () => {
    const { h, healthy } = await broken()
    await h.agent.openConversation(healthy)
    expect(currentId(h)).toBe(healthy)
    expect(h.agent.snapshot().phase).toBe('idle')
    expect(h.agent.snapshot().error).toBeNull()
    expect(await turn(h, 'continue')).toBe(true)
    expect(h.agent.snapshot().error).toBeNull()
  })

  it('can delete it, which opens another conversation', async () => {
    const { h, damaged, healthy } = await broken()
    await h.agent.deleteConversation(damaged)
    expect(currentId(h)).toBe(healthy)
    expect(h.agent.snapshot().phase).toBe('idle')
    expect((await h.agent.conversations()).map((item) => item.id)).toEqual([healthy])
  })

  it('can start a new conversation', async () => {
    const { h, damaged } = await broken()
    await h.agent.newConversation()
    expect(currentId(h)).not.toBe('')
    expect(currentId(h)).not.toBe(damaged)
    expect(h.agent.snapshot().phase).toBe('idle')
  })
})

describe('while a turn is running', () => {
  it('refuses to switch, start, delete or import, and the turn finishes normally', async () => {
    const h = await setup([text('done'), toolCall('slow'), text('after tool')])
    await turn(h, 'other')
    const other = currentId(h)
    await h.agent.newConversation()
    const running = currentId(h)
    const archive = await archiveOf(h, other)

    const accepted = h.agent.send('long')
    await h.slowTool.entered

    const refused = 'Wait for the current turn to finish'
    await expect(h.agent.newConversation()).rejects.toThrow(refused)
    await expect(h.agent.openConversation(other)).rejects.toThrow(refused)
    await expect(h.agent.deleteConversation(other)).rejects.toThrow(refused)
    await expect(h.agent.deleteConversation(running)).rejects.toThrow(refused)
    await expect(h.agent.importConversation(archive)).rejects.toThrow(refused)
    expect(currentId(h)).toBe(running)
    expect(h.agent.snapshot().phase).toBe('executing-tools')

    h.slowTool.release()
    expect(await accepted).toBe(true)
    await h.agent.whenIdle()
    const { messages } = h.agent.snapshot()
    expect(messages[messages.length - 1]?.content).toBe('after tool')
    expect((await h.agent.conversations()).map((item) => item.id)).toContain(other)
  })

  it('still follows a dataset change, which stops the turn', async () => {
    const h = await setup([toolCall('slow')])
    const accepted = h.agent.send('long')
    await h.slowTool.entered
    setAgentDataset('dataset-b', true)
    expect(await accepted).toBe(true)
    await vi.waitFor(() => expect(h.agent.snapshot().phase).toBe('idle'))
    expect(contents(h)).toEqual([])
  })
})

describe('deleting', () => {
  it('moves to the newest remaining conversation when the current one is deleted', async () => {
    const h = await setup(answers(4))
    const [first, second, third] = await fill(h)
    await h.agent.deleteConversation(third!)
    expect(currentId(h)).toBe(second)
    expect((await h.agent.conversations()).map((item) => item.id)).toEqual([second, first])
    expect(await turn(h, 'continue')).toBe(true)
    expect(h.agent.snapshot().error).toBeNull()
  })

  it('starts a blank conversation when the last one is deleted', async () => {
    const h = await setup(answers(1))
    await turn(h)
    const only = currentId(h)
    await h.agent.deleteConversation(only)
    expect(currentId(h)).not.toBe(only)
    expect(contents(h)).toEqual([])
    expect(h.agent.snapshot().phase).toBe('idle')
    expect(await h.agent.conversations()).toEqual([])
  })

  it('stays on the current conversation when another one is deleted', async () => {
    const h = await setup(answers(3))
    const [first, , third] = await fill(h)
    await h.agent.deleteConversation(first!)
    expect(currentId(h)).toBe(third)
    expect(h.agent.snapshot().phase).toBe('idle')
    expect(await h.agent.conversations()).toHaveLength(MAX_SESSIONS - 1)
  })

  it('frees a place at the limit', async () => {
    const h = await setup(answers(MAX_SESSIONS + 1))
    const ids = await fill(h)
    await expect(h.agent.newConversation()).rejects.toBeInstanceOf(SessionLimitError)
    await h.agent.deleteConversation(ids[0]!)
    await h.agent.newConversation()
    expect(contents(h)).toEqual([])
    expect(await turn(h, 'new one')).toBe(true)
  })

  it('reports a conversation another tab is writing and reopens the current one', async () => {
    const busy = new Set<string>()
    const h = await setup(answers(1), { busySessions: busy })
    await turn(h)
    const current = currentId(h)
    busy.add(current)
    await expect(h.agent.deleteConversation(current)).rejects.toBeInstanceOf(SessionBusyError)
    expect(currentId(h)).toBe(current)
    expect(contents(h)).toEqual(['question'])
    expect(h.agent.snapshot().phase).toBe('idle')
  })
})

describe('importing', () => {
  it('switches to the imported conversation and can continue it', async () => {
    const h = await setup(answers(3))
    await turn(h, 'original')
    const archive = await archiveOf(h)
    await h.agent.newConversation()
    await turn(h, 'current')
    await h.agent.importConversation(archive)
    expect(currentId(h)).toBe('imported-id')
    expect(contents(h)).toEqual(['original'])
    expect(await turn(h, 'continued')).toBe(true)
    expect(contents(h)).toEqual(['original', 'continued'])
    expect(lastCall(h)).toContain('original')
    expect(lastCall(h)).not.toContain('current')
  })

  it('takes over from a blank current conversation', async () => {
    const h = await setup(answers(1))
    await turn(h, 'original')
    const archive = await archiveOf(h)
    const original = currentId(h)
    await h.agent.deleteConversation(original)
    const blank = currentId(h)
    await h.agent.importConversation(archive)
    expect(currentId(h)).toBe('imported-id')
    expect(currentId(h)).not.toBe(blank)
  })

  it('leaves the current conversation untouched at the limit', async () => {
    const h = await setup(answers(MAX_SESSIONS))
    const ids = await fill(h)
    await expect(h.agent.importConversation(await archiveOf(h))).rejects.toBeInstanceOf(
      SessionLimitError,
    )
    expect(currentId(h)).toBe(ids[ids.length - 1])
    expect(contents(h)).toEqual([`conversation ${MAX_SESSIONS - 1}`])
    expect(h.agent.snapshot().phase).toBe('idle')
  })

  it('reopens a blank conversation when the import fails', async () => {
    const h = await setup(answers(1))
    await turn(h, 'original')
    const archive = await archiveOf(h)
    await h.agent.deleteConversation(currentId(h))
    const persistence = h.ctx.sessionPersistence
    const write = persistence.importSession.bind(persistence)
    persistence.importSession = async () => {
      throw new Error('disk full')
    }
    await expect(h.agent.importConversation(archive)).rejects.toThrow('disk full')
    persistence.importSession = write
    expect(h.agent.snapshot().phase).toBe('idle')
    expect(contents(h)).toEqual([])
  })

  it('regenerates against the current dataset when the conversation came from another', async () => {
    const h = await setup(answers(3))
    await turn(h, 'asked on a')
    const archive = await archiveOf(h)
    setAgentDataset('dataset-b', true)
    await vi.waitFor(() => expect(contents(h)).toEqual([]))
    await h.agent.importConversation(archive)
    expect(contents(h)).toEqual(['asked on a'])

    expect(await h.agent.regenerate()).toBe(true)
    await h.agent.whenIdle()
    expect(h.agent.snapshot().error).toBeNull()
    expect(contents(h)).toEqual(['asked on a'])
    const storage = h.storages.find((entry) => entry.storage.id === 'imported-id')!.storage
    const starts = (await storage.read())
      .flatMap((batch) => batch.events as { type: string; binding?: { datasetId: string } }[])
      .filter((event) => event.type === 'turn/start')
    expect(starts.map((event) => event.binding?.datasetId)).toEqual(['dataset-a', 'dataset-b'])

    expect(await turn(h, 'asked on b')).toBe(true)
    expect(h.agent.snapshot().error).toBeNull()
  })
})

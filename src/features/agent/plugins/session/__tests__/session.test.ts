import { describe, expect, it, vi } from 'vitest'
import { createMemoryStorage, type SessionStorage } from '../../session-persistence'
import type { UserMessage } from '../../llm'
import { eventMessage, Session, type SessionEventInput } from '../index'

const instructions = (text: string) =>
  ({ type: 'instructions/set', name: 'AGENTS.md', text }) as const

/** append 由测试手动放行或失败 */
function gatedStorage() {
  const storage = createMemoryStorage()
  const append = storage.append.bind(storage)
  const gates: { release(): void; fail(error: Error): void }[] = []
  const gated: SessionStorage = {
    ...storage,
    read: () => storage.read(),
    append: (batch) =>
      new Promise<void>((resolve, reject) => {
        gates.push({
          release: () => void append(batch).then(resolve, reject),
          fail: reject,
        })
      }),
  }
  return { storage: gated, gates }
}

async function setup() {
  const { storage, gates } = gatedStorage()
  const session = new Session(storage)
  await session.restore()
  return { session, gates }
}

describe('unstored batches', () => {
  it('does not count a batch that is still being written', async () => {
    const { session, gates } = await setup()
    const writing = session.commit([instructions('one')])
    await vi.waitFor(() => expect(gates).toHaveLength(1))
    expect(session.hasUnstoredBatch).toBe(false)
    gates[0]!.release()
    await writing
    expect(session.hasUnstoredBatch).toBe(false)
    expect(session.events).toHaveLength(1)
  })

  it('counts a batch once its write has failed, until it is saved again', async () => {
    const { session, gates } = await setup()
    const writing = session.commit([instructions('one')])
    await vi.waitFor(() => expect(gates).toHaveLength(1))
    gates[0]!.fail(new Error('quota'))
    await expect(writing).rejects.toThrow('quota')
    expect(session.hasUnstoredBatch).toBe(true)
    expect(session.events).toHaveLength(0)

    const retrying = session.retrySave()
    await vi.waitFor(() => expect(gates).toHaveLength(2))
    expect(session.hasUnstoredBatch).toBe(true)
    gates[1]!.release()
    await retrying
    expect(session.hasUnstoredBatch).toBe(false)
    expect(session.events).toHaveLength(1)
  })

  it('keeps the batch when saving it again fails too', async () => {
    const { session, gates } = await setup()
    const writing = session.commit([instructions('one')])
    await vi.waitFor(() => expect(gates).toHaveLength(1))
    gates[0]!.fail(new Error('quota'))
    await expect(writing).rejects.toThrow('quota')

    const retrying = session.retrySave()
    await vi.waitFor(() => expect(gates).toHaveLength(2))
    gates[1]!.fail(new Error('still full'))
    await expect(retrying).rejects.toThrow('still full')
    expect(session.hasUnstoredBatch).toBe(true)
  })

  it('refuses new events until the failed batch is saved', async () => {
    const { session, gates } = await setup()
    const writing = session.commit([instructions('one')])
    await vi.waitFor(() => expect(gates).toHaveLength(1))
    gates[0]!.fail(new Error('quota'))
    await expect(writing).rejects.toThrow('quota')
    await expect(session.commit([instructions('two')])).rejects.toThrow(
      'Save the failed session batch',
    )
    expect(gates).toHaveLength(1)
  })

  it('writes queued batches one at a time, in order', async () => {
    const { session, gates } = await setup()
    const first = session.commit([instructions('one')])
    const second = session.commit([instructions('two')])
    await vi.waitFor(() => expect(gates).toHaveLength(1))
    gates[0]!.release()
    await first
    await vi.waitFor(() => expect(gates).toHaveLength(2))
    expect(session.hasUnstoredBatch).toBe(false)
    gates[1]!.release()
    await second
    expect(session.events.map((event) => event.seq)).toEqual([0, 1])
  })
})

describe('the event log', () => {
  const user: UserMessage = { role: 'user', content: 'question' }
  const opening: SessionEventInput[] = [
    {
      type: 'turn/start',
      turnId: 't',
      user,
      binding: { datasetId: '', generation: 0, page: {} },
      baseSurface: [],
    },
    { type: 'message', turnId: 't', message: user },
  ]
  const calling = (...ids: string[]): SessionEventInput => ({
    type: 'message',
    turnId: 't',
    message: {
      role: 'assistant',
      parts: ids.map((id) => ({ type: 'tool-call', id, name: 'lookup', arguments: '{}' })),
    },
  })

  async function open() {
    const session = new Session(createMemoryStorage())
    await session.restore()
    return session
  }

  it('closes unfinished tool calls once, without repeating them', async () => {
    const session = await open()
    await session.commit([
      ...opening,
      calling('one', 'two'),
      { type: 'tool/start', turnId: 't', callKey: '2:0', callId: 'one', name: 'lookup', input: {} },
    ])
    await session.recover()
    const count = session.events.length
    await session.recover()
    expect(session.events).toHaveLength(count)
    expect(session.deriveMessages().slice(-2)).toMatchObject([
      { content: expect.stringContaining('TOOL_OUTCOME_UNKNOWN') },
      { content: expect.stringContaining('TOOL_NOT_STARTED') },
    ])
  })

  it('rejects a summary that splits a tool call from its result, and freezes what it logged', async () => {
    const session = await open()
    await session.commit([
      ...opening,
      calling('c'),
      {
        type: 'message',
        turnId: 't',
        callKey: '2:0',
        message: { role: 'tool', toolCallId: 'c', name: 'lookup', content: 'evidence' },
      },
    ])
    const call = session.events[2]!
    const size = session.events.length
    await expect(
      session.commit([
        {
          type: 'message',
          surfaceOp: { op: 'replace', nodes: [call.seq] },
          surfaceReason: 'summary',
          message: { role: 'user', content: 'summary' },
        },
      ]),
    ).rejects.toThrow('tool pair')
    expect(session.events).toHaveLength(size)
    expect(Object.isFrozen(call)).toBe(true)
    expect(Object.isFrozen(eventMessage(call))).toBe(true)
  })
})

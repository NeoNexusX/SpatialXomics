import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { saveContextWindow, LlmCode, type ChatMessage, type StreamChunk } from '../../llm'
import { setAgentDataset } from '../../../bridge/datasetBinding'
import {
  createLockedAgent,
  fail,
  outcomeOf,
  text,
  toolCall,
  type LockedAgent,
  type ScriptStep,
} from '../../../__tests__/lockedAgent'
import { COMPACTION_INSTRUCTION, headroomTokens, resolvePolicy } from '../index'

const endpoint = {
  endpoint: 'anthropic' as const,
  baseUrl: 'https://llm.test/v1',
  apiKey: 'k',
  source: 'user' as const,
}
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg=='

const open: LockedAgent[] = []
async function setup(script: ScriptStep[], window = 64_000) {
  const h = await createLockedAgent(script)
  open.push(h)
  saveContextWindow(endpoint, 'm', window)
  return h
}
async function turn(h: LockedAgent, value: string, images?: string[]) {
  await h.agent.send(value, images)
  await h.agent.whenIdle()
}
type LoggedEvent = {
  type: string
  seq: number
  surfaceReason?: string
  surfaceOp?: unknown
  error?: string
  nodes?: number[]
  summary?: string
  message?: { role: string; content?: string }
}
const eventsOf = async (h: LockedAgent) =>
  (await outcomeOf(h)).logs.flatMap((log) => log.events as LoggedEvent[])
const replacements = (events: LoggedEvent[]) =>
  events.filter((event) => event.type === 'message' && typeof event.surfaceOp === 'object')
const isInstruction = (message: ChatMessage) =>
  message.role === 'user' && message.content === COMPACTION_INSTRUCTION.content

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

describe('compaction budget', () => {
  it.each([
    // W, O, threshold, retained tail, headroom
    [1_000_000, 64_000, 800_000, 149_760, 65_536],
    [256_000, 64_000, 128_000, 30_720, 64_000],
    [64_000, 16_000, 32_000, 7_680, 16_000],
    [16_000, 4_000, 8_000, 1_920, 4_000],
  ])('window %i with output %i', (window, output, threshold, retain, headroom) => {
    expect(resolvePolicy(window, output)).toEqual({
      thresholdTokens: threshold,
      retainTokens: retain,
    })
    expect(headroomTokens(window)).toBe(headroom)
  })
})

describe('summary request', () => {
  it('replays the real conversation prefix and appends the instruction', async () => {
    const h = await setup([
      [
        { type: 'reasoning-delta', index: 0, text: 'plan' },
        { type: 'tool-call-delta', index: 1, id: 'a', name: 'lookup', argumentsDelta: '{}' },
        { type: 'finish', reason: { kind: 'tool-calls' } },
      ],
      text('e'.repeat(75_000)),
      text('checkpoint body'),
      text('second answer'),
    ])
    await turn(h, 'q'.repeat(60_000))
    const lastTurnRequest = h.calls[1]!
    await turn(h, 'next question')
    const summary = h.calls[2]!
    expect(summary.system).toBe(lastTurnRequest.system)
    expect(summary.tools).toEqual(lastTurnRequest.tools)
    expect(isInstruction(summary.messages[summary.messages.length - 1]!)).toBe(true)
    const replayed = summary.messages.slice(0, -1)
    expect(replayed).toEqual(lastTurnRequest.messages.slice(0, replayed.length))
    expect(replayed.some((message) => message.role === 'tool')).toBe(true)
    expect(JSON.stringify(replayed)).toContain('plan')
  })

  it('keeps only the text the model wrote', async () => {
    const checkpoint: StreamChunk[] = [
      { type: 'reasoning-delta', index: 0, text: 'SECRET REASONING' },
      { type: 'text-delta', index: 1, text: 'checkpoint body' },
      { type: 'tool-call-delta', index: 2, id: 'x', name: 'lookup', argumentsDelta: '{}' },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ]
    const h = await setup([text('e'.repeat(75_000)), checkpoint, text('second')])
    await turn(h, 'q'.repeat(60_000))
    await turn(h, 'next question')
    const [replacement] = replacements(await eventsOf(h))
    expect(replacement!.message!.content).toContain(
      '<compacted-summary>\ncheckpoint body\n</compacted-summary>',
    )
    expect(replacement!.message!.content).not.toContain('SECRET')
  })

  it.each([
    ['truncated', [{ type: 'finish', reason: { kind: 'max-tokens' } }] as StreamChunk[]],
    ['refused', [{ type: 'finish', reason: { kind: 'refusal' } }] as StreamChunk[]],
    ['empty', [{ type: 'finish', reason: { kind: 'stop' } }] as StreamChunk[]],
    ['tool only', toolCall('lookup', {}, 'x')],
  ])('keeps the history when the summary is %s', async (_name, reply) => {
    const h = await setup([text('e'.repeat(75_000)), reply, text('second')])
    await turn(h, 'q'.repeat(60_000))
    await turn(h, 'next question')
    const events = await eventsOf(h)
    expect(replacements(events)).toEqual([])
    expect(events.find((event) => event.type === 'compaction/end')?.error).toBeTruthy()
    expect(h.agent.snapshot().error).toBeNull()
    expect(JSON.stringify(h.calls[2]!.messages)).toContain('q'.repeat(100))
  })

  it('rejects a summary that is no shorter than what it replaces', async () => {
    const h = await setup(
      [text('e'.repeat(9_000)), text('s'.repeat(40_000)), text('second')],
      17_000,
    )
    await turn(h, 'q'.repeat(3_000))
    await turn(h, 'r'.repeat(21_000))
    const events = await eventsOf(h)
    expect(replacements(events)).toEqual([])
    expect(events.find((event) => event.type === 'compaction/end')?.error).toBe(
      'Compaction did not reduce context',
    )
  })
})

describe('what gets compacted', () => {
  it('does not summarise a lone checkpoint again when the tail alone is over the threshold', async () => {
    const h = await setup([
      text('e'.repeat(36_000)),
      text('f'.repeat(120_000)),
      text('checkpoint'),
      text('third answer'),
    ])
    await turn(h, 'q'.repeat(3_000))
    await turn(h, 'second question')
    await turn(h, 'third question')
    expect(h.calls).toHaveLength(4)
    expect(replacements(await eventsOf(h))).toHaveLength(1)
  })

  it('leaves out of the summary what would not fit in the window', async () => {
    const h = await setup(
      [text('e'.repeat(3_000)), text('f'.repeat(30_000)), text('checkpoint'), text('next')],
      12_000,
    )
    await turn(h, 'q'.repeat(3_000))
    await turn(h, 'r'.repeat(21_000))
    await turn(h, 'third question')
    const summary = h.calls.find((call) => isInstruction(call.messages[call.messages.length - 1]!))!
    expect(JSON.stringify(summary.messages)).toContain('qqq')
    expect(JSON.stringify(summary.messages)).not.toContain('rrr')
  })

})

describe('overflow recovery', () => {
  it('retries the summary at overflow even if the same turn failed one under pressure', async () => {
    const h = await setup([
      text('e'.repeat(60_000)),
      fail(LlmCode.SERVER, 'summary failed'),
      fail(LlmCode.CONTEXT_WINDOW_EXCEEDED, 'too long'),
      text('checkpoint'),
      text('second answer'),
    ])
    await turn(h, 'q'.repeat(45_000))
    await turn(h, 'next question')
    expect(replacements(await eventsOf(h))).toHaveLength(1)
    expect(h.agent.snapshot().error).toBeNull()
  })
})

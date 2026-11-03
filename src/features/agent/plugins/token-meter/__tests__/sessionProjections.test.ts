import { beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMemoryStorage } from '../../session-persistence'
import { Session } from '../../session'
import { SessionProjections } from '../../session-projection'
import { estimateMessage, TokenMeter } from '../index'
import type { SessionEventInput } from '../../session'

async function setup() {
  const ctx = new Context()
  await ctx.plugin(SessionProjections)
  await ctx.plugin(TokenMeter)
  await new Promise((resolve) => setTimeout(resolve, 0))
  const storage = createMemoryStorage()
  const session = new Session(storage, ctx.sessionProjections)
  await session.restore()
  return { ctx, session }
}

const request = {
  system: 'system prompt',
  tools: [],
  nodes: [1],
  route: { endpoint: 'anthropic' as const, baseUrl: 'https://llm.test/v1', model: 'm' },
  contextWindow: 10_000,
  maxTokens: 2_000,
  imageMode: 'image' as const,
  purpose: 'conversation' as const,
  turnStart: 1,
}

function turn(events: SessionEventInput[]): SessionEventInput[] {
  return [
    {
      type: 'turn/start',
      turnId: 't1',
      user: { role: 'user', content: 'question' },
      binding: { datasetId: '', generation: 0, page: {} },
      baseSurface: [],
    },
    { type: 'message', turnId: 't1', message: { role: 'user', content: 'question' } },
    ...events,
  ]
}

describe('session projections', () => {
  beforeEach(() => localStorage.clear())

  it('prices CJK text and tool arguments', () => {
    const tokens = estimateMessage({
      role: 'assistant',
      parts: [{ type: 'tool-call', id: 'c', name: 'tool', arguments: '中'.repeat(100) }],
    })
    expect(tokens).toBeGreaterThan(100)
  })

  it('shares token usage and provider-anchored pressure for the same session', async () => {
    const { ctx, session } = await setup()
    await session.commit(
      turn([
        { type: 'step/start', turnId: 't1', step: 1 },
        { type: 'attempt/start', turnId: 't1', attemptId: 'a1', step: 1, request },
        {
          type: 'attempt/end',
          turnId: 't1',
          attemptId: 'a1',
          status: 'committed',
          usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 30 },
        },
        {
          type: 'message',
          turnId: 't1',
          message: {
            role: 'assistant',
            parts: [{ type: 'text', text: 'answer' }],
          },
        },
        { type: 'step/end', turnId: 't1', step: 1 },
        { type: 'turn/end', turnId: 't1', reason: 'completed' },
      ]),
    )

    const snapshot = ctx.sessionProjections.snapshot(session)
    expect(snapshot.asOfSeq).toBe(session.events.length - 1)
    expect(snapshot.values.tokenUsage).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 30,
    })
    const pressure = snapshot.values.contextPressure as {
      contextWindow: number
      outputReserve: number
      inputBudget: number
      inputTokens: number
      estimated: boolean
      ratio: number
    }
    expect(pressure).toMatchObject({
      contextWindow: 10_000,
      outputReserve: 2_000,
      estimated: false,
    })
    expect(pressure.inputBudget).toBe(7_800)
    expect(pressure.inputTokens).toBeGreaterThan(100)
    expect(pressure.ratio).toBeGreaterThan(0)
  })

  it('recomputes the pressure surface after a summary replacement', async () => {
    const { ctx, session } = await setup()
    await session.commit(
      turn([
        { type: 'step/start', turnId: 't1', step: 1 },
        { type: 'attempt/start', turnId: 't1', attemptId: 'a1', step: 1, request },
        {
          type: 'attempt/end',
          turnId: 't1',
          attemptId: 'a1',
          status: 'committed',
          usage: { inputTokens: 100, outputTokens: 20 },
        },
        {
          type: 'message',
          turnId: 't1',
          message: {
            role: 'assistant',
            parts: [{ type: 'text', text: 'answer '.repeat(100) }],
          },
        },
        { type: 'step/end', turnId: 't1', step: 1 },
        { type: 'turn/end', turnId: 't1', reason: 'completed' },
      ]),
    )
    const before = ctx.sessionProjections.viewOf<{ inputTokens: number }>(
      session,
      'contextPressure',
    )!
    const nodes = session.nodes
    await session.commit([
      {
        type: 'message',
        surfaceOp: { op: 'replace', nodes },
        surfaceReason: 'summary',
        message: { role: 'user', content: 'summary' },
      },
    ])
    const after = ctx.sessionProjections.viewOf<{ inputTokens: number }>(
      session,
      'contextPressure',
    )!
    expect(after.inputTokens).toBeLessThan(before.inputTokens)
  })

  it('drives every registered projection from restore and reset', async () => {
    const { ctx, session } = await setup()
    await session.commit(turn([{ type: 'step/start', turnId: 't1', step: 1 }]))
    const storage = session.storage
    const restored = new Session(storage, ctx.sessionProjections)
    await restored.restore()
    expect(ctx.sessionProjections.snapshot(restored).asOfSeq).toBe(restored.events.length - 1)
    expect(() =>
      ctx.sessionProjections.register({ key: 'tokenUsage', init: () => ({}), apply: (s) => s, view: (s) => s }),
    ).toThrow('already registered')
  })
})

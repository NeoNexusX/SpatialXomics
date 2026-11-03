/** 组合表本身的约束，以及插件真的可以被卸下或替换 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { baseBundle } from '../bundles/base'
import { LlmCode, saveContextWindow } from '../plugins/llm'
import { setAgentDataset } from '../bridge/datasetBinding'
import { createLockedAgent, fail, outcomeOf, text, toolCall, type LockedAgent } from './lockedAgent'

const open: LockedAgent[] = []
async function setup(...args: Parameters<typeof createLockedAgent>) {
  const h = await createLockedAgent(...args)
  open.push(h)
  return h
}
async function turn(h: LockedAgent, value = 'question') {
  const accepted = await h.agent.send(value)
  await h.agent.whenIdle()
  return accepted
}
const eventsOf = async (h: LockedAgent) =>
  (await outcomeOf(h)).logs.flatMap((log) => log.events as { type: string; archiveId?: string }[])

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

describe('production bundle', () => {
  it('starts every row, whatever order the rows are in', async () => {
    for (const rows of [baseBundle, [...baseBundle].reverse()]) {
      const ctx = new Context()
      const fibers = rows.map((row) => ({ id: row.id, fiber: ctx.plugin(row.plugin, row.config) }))
      await new Promise((resolve) => setTimeout(resolve, 0))
      // FiberState.ACTIVE
      expect(fibers.filter(({ fiber }) => fiber.state !== 2).map(({ id }) => id)).toEqual([])
      await ctx.fiber.dispose()
    }
  })

  it('has one row per plugin folder; the storage contract has no behaviour of its own', () => {
    const folders = Object.keys(import.meta.glob('../plugins/*/index.ts')).map(
      (path) => path.split('/')[2]!,
    )
    const ids = baseBundle.map((row) => row.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual(
      folders.filter((folder) => folder !== 'session-persistence').sort(),
    )
  })

  it('reports which plugin failed to start', async () => {
    vi.resetModules()
    vi.doMock('../bundles/base', () => ({
      baseBundle: [
        {
          id: 'broken',
          plugin: {
            apply() {
              throw new Error('boom')
            },
          },
        },
      ],
    }))
    const { whenAgentReady } = await import('../bootstrap')
    await expect(whenAgentReady()).rejects.toThrow('broken')
    vi.doUnmock('../bundles/base')
  })
})

describe('the loop only depends on its extension points', () => {
  it('runs a turn with only the core plugins', async () => {
    const h = await setup([toolCall('lookup'), text('answer')], {
      without: [
        'agent-instructions',
        'compaction',
        'llm-retry',
        'model-catalog',
        'persona',
        'session-transcript',
        'skill',
        'skill-bundled',
        'token-meter',
        'tool-archive',
        'tool-skill',
      ],
    })
    expect(await turn(h)).toBe(true)
    expect(h.calls).toHaveLength(2)
    const events = await eventsOf(h)
    expect(events[events.length - 1]).toMatchObject({ type: 'turn/end', reason: 'completed' })
  })

  it('does not retry without llm-retry', async () => {
    const h = await setup([fail(LlmCode.SERVER)], { without: ['llm-retry'] })
    await turn(h)
    expect(h.calls).toHaveLength(1)
    expect(h.agent.snapshot().error).toBe(LlmCode.SERVER)
  })

  it('does not compact without compaction, even when asked to', async () => {
    const h = await setup([text('e'.repeat(75_000)), text('second answer')], {
      without: ['compaction'],
    })
    saveContextWindow(
      { endpoint: 'anthropic', baseUrl: 'https://llm.test/v1', apiKey: 'k', source: 'user' },
      'm',
      64_000,
    )
    await turn(h, 'q'.repeat(60_000))
    await turn(h, 'next question')
    expect(h.calls).toHaveLength(2)
    await h.agent.compact()
    expect(h.agent.snapshot().error).toBe('common.agent.compactionNoProgress')
    expect((await eventsOf(h)).some((event) => event.type.startsWith('compaction/'))).toBe(false)
  })

  it('does not archive tool results without tool-archive', async () => {
    const h = await setup([toolCall('long_lookup'), text('answer')], { without: ['tool-archive'] })
    await turn(h)
    const results = (await eventsOf(h)).filter(
      (event) => event.type === 'message' && 'callKey' in event,
    )
    expect(results).toHaveLength(1)
    expect(results[0]!.archiveId).toBeUndefined()
  })

  it('lets a plugin replace the retry policy', async () => {
    const h = await setup([fail(LlmCode.AUTH), text('recovered')], { without: ['llm-retry'] })
    h.ctx.on('agent/request-error', async (failed, next) =>
      failed.failure.code === LlmCode.AUTH ? { kind: 'retry' } : next(),
    )
    await turn(h)
    expect(h.calls).toHaveLength(2)
    expect(h.agent.snapshot().error).toBeNull()
  })

  it('lets a plugin stop a turn from the guard', async () => {
    const h = await setup([toolCall('lookup')])
    h.ctx.on('agent/guard', (_binding, toolName) => {
      if (toolName === 'lookup') throw new Error('lookup is not allowed here')
    })
    await turn(h)
    expect(h.agent.snapshot().error).toBe('lookup is not allowed here')
  })

  it('removes what a plugin registered when it is unloaded', async () => {
    const h = await setup([])
    const fiber = h.ctx.plugin({
      name: 'temporary',
      inject: ['tools', 'systemPrompt'],
      apply(ctx: Context) {
        ctx.tools.register({
          name: 'temporary_tool',
          description: 'gone after unload',
          parameters: {},
          execute: async () => 'ok',
        })
        ctx.systemPrompt.section({ key: 'temporary', order: 99, render: () => 'temporary section' })
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await h.agent.ready()
    const session = { binding: { datasetId: '', generation: 0, page: {} }, session: {} as never }
    const toolNames = () => h.ctx.tools.list().map((tool) => tool.name)
    expect(toolNames()).toContain('temporary_tool')
    expect(h.ctx.systemPrompt.render(session)).toContain('temporary section')
    await fiber.dispose()
    expect(toolNames()).not.toContain('temporary_tool')
    expect(h.ctx.systemPrompt.render(session)).not.toContain('temporary section')
  })
})

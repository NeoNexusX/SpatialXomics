import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { connectionProvider } from '../providers/connection'
import { llmProvider } from '../providers/llm'
import { modelCatalogProvider, PROBE_BATCH_SIZE } from '../providers/modelCatalog'
import { endpointKey } from '../agentconfig/connectionConfig'
import { STORAGE_KEYS } from '@/shared/config/storageKeys'
import type { LlmAdapter, ResolvedEndpoint, VisionProbeResult } from '../agenttypes/assistant'

const ENDPOINT: ResolvedEndpoint = {
  endpoint: 'anthropic',
  baseUrl: 'https://llm.test/v1',
  apiKey: 'sk-1',
  source: 'user',
}
const OTHER: ResolvedEndpoint = { ...ENDPOINT, baseUrl: 'https://other.test/v1' }

const ids = (count: number) => Array.from({ length: count }, (_, i) => `m${i}`)

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** 探测按手动放行的适配器，用来观察并发和进行中的状态 */
function controllableAdapter(models: string[]) {
  const pending = new Map<string, (result: VisionProbeResult) => void>()
  const probed: string[] = []
  const signals = new Map<string, AbortSignal>()
  const adapter: LlmAdapter = {
    endpoint: 'anthropic',
    async *stream() {},
    listModels: vi.fn(async () => models),
    probeVision: (connection, signal) => {
      probed.push(connection.model)
      if (signal) signals.set(connection.model, signal)
      return new Promise((resolve) => pending.set(connection.model, resolve))
    },
  }
  const settle = async (model: string, result: VisionProbeResult = 'vision') => {
    pending.get(model)?.(result)
    pending.delete(model)
    await flush()
  }
  const settleAll = async (result: VisionProbeResult = 'vision') => {
    while (pending.size > 0) {
      for (const model of [...pending.keys()]) await settle(model, result)
    }
  }
  return { adapter, pending, probed, signals, settle, settleAll }
}

async function setup(adapter: LlmAdapter) {
  const ctx = new Context()
  await ctx.plugin(connectionProvider)
  await ctx.plugin(llmProvider)
  await ctx.plugin(modelCatalogProvider)
  ctx.llm.registerAdapter(adapter)
  return ctx
}

const statusOf = (ctx: Context, id: string) =>
  ctx.models.snapshot().models.find((model) => model.id === id)?.status

describe('ctx.models', () => {
  beforeEach(() => localStorage.clear())

  it('tests only the first batch until the user allows more', async () => {
    const { adapter, probed, settleAll } = controllableAdapter(ids(13))
    const ctx = await setup(adapter)
    ctx.models.open(ENDPOINT)
    await ctx.models.refresh()
    await settleAll()

    expect(probed).toHaveLength(PROBE_BATCH_SIZE)
    expect(probed).toEqual(ids(10))
    expect(statusOf(ctx, 'm10')).toBe('pending')

    ctx.models.testMore()
    await settleAll()
    expect(probed).toHaveLength(13)
    expect(statusOf(ctx, 'm12')).toBe('vision')
  })

  it('never runs more than four probes at once', async () => {
    const { adapter, pending, settle, settleAll } = controllableAdapter(ids(10))
    const ctx = await setup(adapter)
    ctx.models.open(ENDPOINT)
    await ctx.models.refresh()
    expect(pending.size).toBe(4)
    await settle('m0')
    expect(pending.size).toBe(4)
    await settleAll()
    expect(pending.size).toBe(0)
  })

  it('records each result and keeps the endpoint order', async () => {
    const { adapter, settle, settleAll } = controllableAdapter(ids(3))
    const ctx = await setup(adapter)
    ctx.models.open(ENDPOINT)
    await ctx.models.refresh()
    await settle('m1', 'no-vision')
    await settle('m2', 'unavailable')
    await settleAll()
    expect(ctx.models.snapshot().models).toEqual([
      { id: 'm0', status: 'vision' },
      { id: 'm1', status: 'no-vision' },
      { id: 'm2', status: 'unavailable' },
    ])
  })

  it('treats a failed probe as inconclusive', async () => {
    const adapter: LlmAdapter = {
      endpoint: 'anthropic',
      async *stream() {},
      listModels: async () => ['m0'],
      probeVision: async () => {
        throw new Error('boom')
      },
    }
    const ctx = await setup(adapter)
    ctx.models.open(ENDPOINT)
    await ctx.models.refresh()
    await flush()
    expect(statusOf(ctx, 'm0')).toBe('unavailable')
  })

  it('does not retry a probe that got no response until asked', async () => {
    const { adapter, probed, settle } = controllableAdapter(ids(1))
    const ctx = await setup(adapter)
    ctx.models.open(ENDPOINT)
    await ctx.models.refresh()
    await settle('m0', 'no-response')
    expect(probed).toEqual(['m0'])
    expect(statusOf(ctx, 'm0')).toBe('no-response')

    await ctx.models.refresh()
    expect(probed).toEqual(['m0', 'm0'])
  })

  it('reports a failed listing', async () => {
    const adapter: LlmAdapter = {
      endpoint: 'anthropic',
      async *stream() {},
      listModels: async () => {
        throw new Error('bad key')
      },
      probeVision: async () => 'vision',
    }
    const ctx = await setup(adapter)
    ctx.models.open(ENDPOINT)
    await ctx.models.refresh()
    expect(ctx.models.snapshot()).toMatchObject({
      listing: false,
      listError: 'bad key',
      models: [],
    })
  })

  it('keeps results across a refresh and tests only what is new', async () => {
    const list = ['m0', 'm1']
    const { adapter, probed, settleAll } = controllableAdapter(list)
    const ctx = await setup(adapter)
    ctx.models.open(ENDPOINT)
    await ctx.models.refresh()
    await settleAll()
    list.push('m2')
    await ctx.models.refresh()
    await settleAll()
    expect(probed).toEqual(['m0', 'm1', 'm2'])
  })

  it('tests again from the first batch on request', async () => {
    const { adapter, probed, settleAll } = controllableAdapter(ids(13))
    const ctx = await setup(adapter)
    ctx.models.open(ENDPOINT)
    await ctx.models.refresh()
    await settleAll()
    ctx.models.testMore()
    await settleAll()
    probed.length = 0
    ctx.models.retest()
    await settleAll()
    expect(probed).toHaveLength(PROBE_BATCH_SIZE)
    expect(statusOf(ctx, 'm12')).toBe('pending')
  })

  it('tests a manually entered model without spending the batch', async () => {
    const { adapter, probed, settleAll } = controllableAdapter(ids(13))
    const ctx = await setup(adapter)
    ctx.models.open(ENDPOINT)
    await ctx.models.refresh()
    await settleAll()
    ctx.models.addModel('private-model')
    await settleAll()
    expect(statusOf(ctx, 'private-model')).toBe('vision')
    expect(ctx.models.snapshot().models[0]!.id).toBe('private-model')
    // 手动测的那个不占额度：第 11 个模型还没测
    expect(statusOf(ctx, 'm10')).toBe('pending')
    expect(probed).toHaveLength(PROBE_BATCH_SIZE + 1)
  })

  it('aborts running probes and ignores late results when the endpoint changes', async () => {
    const { adapter, signals, pending } = controllableAdapter(ids(2))
    const ctx = await setup(adapter)
    ctx.models.open(ENDPOINT)
    await ctx.models.refresh()
    const late = pending.get('m0')!
    ctx.models.open(OTHER)
    expect(signals.get('m0')!.aborted).toBe(true)
    late('vision')
    await flush()
    expect(ctx.models.snapshot().models).toEqual([])
  })

  describe('state survives', () => {
    it('continues running when nothing reopens it', async () => {
      const { adapter, settleAll } = controllableAdapter(ids(2))
      const ctx = await setup(adapter)
      ctx.models.open(ENDPOINT)
      await ctx.models.refresh()
      // 重复 open 同一个端点（切回界面时会发生）不打断进行中的测试
      ctx.models.open(ENDPOINT)
      expect(statusOf(ctx, 'm0')).toBe('testing')
      await settleAll()
      expect(statusOf(ctx, 'm0')).toBe('vision')
    })

    it('restores results after a reload and resumes what was unfinished', async () => {
      const first = controllableAdapter(ids(6))
      const before = await setup(first.adapter)
      before.models.open(ENDPOINT)
      await before.models.refresh()
      await first.settle('m0', 'vision')
      await first.settle('m1', 'no-vision')

      // 模拟刷新：新的运行时，没有进行中的请求
      const second = controllableAdapter(ids(6))
      const after = await setup(second.adapter)
      after.models.open(ENDPOINT)

      expect(statusOf(after, 'm0')).toBe('vision')
      expect(statusOf(after, 'm1')).toBe('no-vision')
      expect(second.probed).not.toContain('m0')
      expect(second.probed).not.toContain('m1')
      await second.settleAll()
      expect(second.probed.sort()).toEqual(['m2', 'm3', 'm4', 'm5'])
      expect(second.adapter.listModels).not.toHaveBeenCalled()
    })

    it('does not count requests the browser cancels on reload as failures', async () => {
      const first = controllableAdapter(ids(2))
      const before = await setup(first.adapter)
      before.models.open(ENDPOINT)
      await before.models.refresh()

      window.dispatchEvent(new PageTransitionEvent('pagehide'))
      // 浏览器中断请求后迟到的失败结果
      await first.settle('m0', 'unavailable')
      expect(statusOf(before, 'm0')).toBe('pending')

      const second = controllableAdapter(ids(2))
      const after = await setup(second.adapter)
      after.models.open(ENDPOINT)
      await second.settleAll()
      expect(second.probed.sort()).toEqual(['m0', 'm1'])
      expect(statusOf(after, 'm0')).toBe('vision')
    })

    // WebKit 在 pagehide 之前就让进行中的请求失败，这种结果不能留到刷新之后
    it('tests again after a reload when a probe got no response', async () => {
      const first = controllableAdapter(ids(2))
      const before = await setup(first.adapter)
      before.models.open(ENDPOINT)
      await before.models.refresh()
      await first.settle('m0', 'no-response')
      await first.settle('m1', 'vision')

      const second = controllableAdapter(ids(2))
      const after = await setup(second.adapter)
      after.models.open(ENDPOINT)
      await second.settleAll()
      expect(second.probed).toEqual(['m0'])
      expect(statusOf(after, 'm0')).toBe('vision')
      expect(statusOf(after, 'm1')).toBe('vision')
    })

    it('tests again when the page comes back from the back-forward cache', async () => {
      const { adapter, probed, settle, settleAll } = controllableAdapter(ids(1))
      const ctx = await setup(adapter)
      ctx.models.open(ENDPOINT)
      await ctx.models.refresh()
      await settle('m0', 'no-response')

      window.dispatchEvent(new PageTransitionEvent('pagehide'))
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
      await settleAll()
      expect(probed).toEqual(['m0', 'm0'])
      expect(statusOf(ctx, 'm0')).toBe('vision')
    })

    it('does not resume models the user has not allowed', async () => {
      const first = controllableAdapter(ids(13))
      const before = await setup(first.adapter)
      before.models.open(ENDPOINT)
      await before.models.refresh()
      await first.settleAll()

      const second = controllableAdapter(ids(13))
      const after = await setup(second.adapter)
      after.models.open(ENDPOINT)
      await flush()
      expect(second.probed).toEqual([])
      expect(after.models.snapshot().allowed).toBe(PROBE_BATCH_SIZE)
    })

    it('keeps results per endpoint, and a new key starts fresh', async () => {
      const { adapter, settleAll } = controllableAdapter(ids(1))
      const ctx = await setup(adapter)
      ctx.models.open(ENDPOINT)
      await ctx.models.refresh()
      await settleAll()

      ctx.models.open({ ...ENDPOINT, apiKey: 'sk-2' })
      expect(ctx.models.snapshot().models).toEqual([])

      ctx.models.open(ENDPOINT)
      expect(statusOf(ctx, 'm0')).toBe('vision')
    })

    it('never stores the API key', async () => {
      const { adapter, settleAll } = controllableAdapter(ids(1))
      const ctx = await setup(adapter)
      ctx.models.open(ENDPOINT)
      await ctx.models.refresh()
      await settleAll()
      const stored = localStorage.getItem(STORAGE_KEYS.assistantModelCatalog)!
      expect(stored).toContain(endpointKey(ENDPOINT))
      expect(stored).not.toContain('sk-1')
    })

    it('survives corrupt storage', async () => {
      localStorage.setItem(STORAGE_KEYS.assistantModelCatalog, '{not json')
      const { adapter } = controllableAdapter([])
      const ctx = await setup(adapter)
      ctx.models.open(ENDPOINT)
      expect(ctx.models.snapshot().models).toEqual([])
    })
  })
})

/* eslint-disable vitest/expect-expect -- 断言在 lock() 里 */
/**
 * 行为锁定：端到端跑一遍 agent 的全部分支，逐字节比较写进存储的事件、发给模型的请求、
 * 界面状态序列和最终快照。快照变了就说明行为变了，不要直接更新。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LlmCode, saveContextWindow } from '../plugins/llm'
import { createMemoryStorage, makeBatch, type SessionStorage } from '../plugins/session-persistence'
import { defineTool } from '../plugins/tools'
import { registerContextProviders, unregisterContextProviders } from '../bridge/analysisContext'
import { markAgentDatasetReady, setAgentDataset } from '../bridge/datasetBinding'
import {
  dataModeRef,
  ionDims,
  metadataAttrsRef,
  mzAxisRef,
  pixelSpectrum,
  polarityRef,
  resetZarrSharedState,
} from '@/services/zarr/zarrSharedState'
import type { StreamChunk } from '../plugins/llm'
import {
  createLockedAgent,
  fail,
  normalize,
  outcomeOf,
  text,
  toolCall,
  type LockedAgent,
  type LockedAgentOptions,
  type ScriptStep,
} from './lockedAgent'

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg=='
const CONNECTION = { endpoint: 'anthropic', baseUrl: 'https://llm.test', apiKey: 'key', model: 'm' }
const connection = {
  endpoint: 'anthropic' as const,
  baseUrl: 'https://llm.test/v1',
  apiKey: 'key',
  source: 'user' as const,
}

let baseGeneration = 0
const open: LockedAgent[] = []

async function setup(script: ScriptStep[] = [], options: LockedAgentOptions = {}) {
  const h = await createLockedAgent(script, options)
  open.push(h)
  return h
}

async function lock(name: string, h: LockedAgent, extra: Record<string, unknown> = {}) {
  await expect(normalize(await outcomeOf(h, extra), baseGeneration)).toMatchFileSnapshot(
    `./__snapshots__/behaviorLock/${name}.json`,
  )
}

/** 发一轮并等它彻底结束 */
async function turn(h: LockedAgent, value = 'question', images?: string[]) {
  const accepted = await h.agent.send(value, images)
  await h.agent.whenIdle()
  return accepted
}

function loadDataset(): void {
  dataModeRef.value = 'continuous'
  ionDims.value = { width: 10, height: 5 }
  mzAxisRef.value = new Float64Array([100, 200, 300])
  metadataAttrsRef.value = {
    name: 'mouse-brain',
    filename: 'mouse-brain.imzML',
    spectrum_count_num: 50,
    pixel_size_horizontal: 10,
    pixel_size_vertical: 10,
    analyzer: 'FTICR',
    ionisation_source: 'MALDI',
  } as never
  polarityRef.value = 'positive'
}

function selectIon(mz = 741.531): void {
  registerContextProviders({
    selectedIon: () => ({
      mz,
      tolerance: 0.01,
      matrix: new Float32Array([1, 2, 3, 4]),
      width: 2,
      height: 2,
    }),
  })
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('assistant_connection', JSON.stringify(CONNECTION))
  baseGeneration = setAgentDataset('dataset-a', true)
})

afterEach(async () => {
  for (const h of open.splice(0)) await h.dispose()
  unregisterContextProviders()
  resetZarrSharedState()
  vi.unstubAllGlobals()
})

describe('system prompt and tool catalog', () => {
  it('renders the production prompt byte for byte', async () => {
    loadDataset()
    selectIon()
    const h = await setup([text('done')], { fullTools: true, noScriptTools: true })
    await h.agent.setInstructions('AGENTS.md', 'Keep exact m/z values.')
    await turn(h)
    await expect(h.calls[0]!.system).toMatchFileSnapshot(
      './__snapshots__/behaviorLock/system-prompt.txt',
    )
  })

  it('renders the prompt without a dataset or instructions', async () => {
    const h = await setup([text('done')], { fullTools: true, noScriptTools: true })
    await turn(h)
    await expect(h.calls[0]!.system).toMatchFileSnapshot(
      './__snapshots__/behaviorLock/system-prompt-empty.txt',
    )
  })

  it('sends the sorted production tool schemas', async () => {
    const h = await setup([text('done')], { fullTools: true, noScriptTools: true })
    await turn(h)
    await expect(JSON.stringify(h.calls[0]!.tools, null, 2) + '\n').toMatchFileSnapshot(
      './__snapshots__/behaviorLock/tool-schemas.json',
    )
    expect(h.calls[0]!.tools).toHaveLength(29)
  })
})

describe('turns', () => {
  it('plain answer with reasoning, usage and replay state', async () => {
    const h = await setup([
      [
        { type: 'reasoning-delta', index: 0, text: 'think' },
        { type: 'text-delta', index: 1, text: 'answer' },
        { type: 'usage', usage: { inputTokens: 120, outputTokens: 12, cacheReadTokens: 30 } },
        {
          type: 'finish',
          reason: { kind: 'stop' },
          replayState: { response: { kind: 'test' }, blocks: [{ type: 'thinking' }, {}] },
        },
      ],
    ])
    await lock('plain-answer', h, { accepted: await turn(h) })
  })

  it('captures the analysis context message when a dataset and ion are selected', async () => {
    loadDataset()
    selectIon()
    registerContextProviders({
      kmeans: () => ({ k: 2, clusterSizes: [3, 4], selectedIds: [1] }),
      annotations: () => ({
        count: 0,
        rows: () => [],
        weights: { mass: 0.5, adduct: 0.2, spatial: 0.3 },
      }),
    })
    pixelSpectrum.value = { pixelIndex: 4, x: 1, y: 2 } as never
    const h = await setup([text('done')])
    await lock('analysis-context', h, { accepted: await turn(h) })
  })

  it('refuses blank input and reports no connection', async () => {
    const h = await setup([text('unused')])
    const blank = await turn(h, '   ')
    localStorage.clear()
    h.ctx.connection.clear()
    const missing = await turn(h)
    await lock('no-connection', h, { blank, missing })
  })

  it('reports a preparation failure without opening a turn', async () => {
    const h = await setup([], {
      adapter: {
        resolveModel: async () => {
          throw new Error('model facts unavailable')
        },
      },
    })
    await lock('prepare-failure', h, { accepted: await turn(h) })
  })

  it('rejects concurrent sends', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const h = await setup([
      async function* () {
        yield { type: 'text-delta', index: 0, text: 'first' } as StreamChunk
        await gate
        yield { type: 'finish', reason: { kind: 'stop' } } as StreamChunk
      },
    ])
    const first = await h.agent.send('one')
    await vi.waitFor(() => expect(h.agent.snapshot().phase).toBe('generating'))
    const second = await h.agent.send('two')
    release()
    await h.agent.whenIdle()
    await lock('concurrent-send', h, { first, second })
  })

  it('captures the route for the whole turn when settings change', async () => {
    const models: string[] = []
    const h: LockedAgent = await setup([
      async function* (_options, route) {
        models.push(route.model)
        h.ctx.connection.save({
          endpoint: 'anthropic',
          baseUrl: 'https://other.test',
          apiKey: 'other-key',
          model: 'other',
        })
        yield* toolCall('lookup')
      },
      async function* (_options, route) {
        models.push(route.model)
        yield* text('done')
      },
    ])
    await lock('route-capture', h, { accepted: await turn(h), models })
  })

  it.each([
    ['max-tokens', { kind: 'max-tokens' }],
    ['refusal', { kind: 'refusal' }],
  ] as const)('ends the turn on a %s finish', async (name, reason) => {
    const h = await setup([
      [
        { type: 'text-delta', index: 0, text: 'partial' },
        { type: 'finish', reason },
      ],
    ])
    await lock(`finish-${name}`, h, { accepted: await turn(h) })
  })

  it('ends the turn on an empty response', async () => {
    const h = await setup([[{ type: 'finish', reason: { kind: 'stop' } }]])
    await lock('finish-empty', h, { accepted: await turn(h) })
  })

  it('keeps going until the model stops calling tools', async () => {
    const h = await setup([...Array.from({ length: 60 }, (_, i) => toolCall('lookup', {}, `c${i}`)), text('done')])
    expect(await turn(h)).toBe(true)
    expect(h.calls).toHaveLength(61)
    expect(h.agent.snapshot()).toMatchObject({ phase: 'idle', error: null })
    const stored = await outcomeOf(h)
    const events = stored.logs.flatMap((log) => log.events as { type: string; reason?: string; step?: number }[])
    expect(events.filter((event) => event.type === 'step/start').map((event) => event.step)).toEqual(Array.from({ length: 61 }, (_, index) => index + 1))
    expect(events.filter((event) => event.type === 'turn/end')).toEqual([expect.objectContaining({ reason: 'completed' })])
  })

  it('regenerates the last turn', async () => {
    const h = await setup([text('old'), text('new')])
    await turn(h)
    const regenerated = await h.agent.regenerate()
    await h.agent.whenIdle()
    await lock('regenerate', h, { regenerated })
  })

  it('refuses to regenerate while the dataset is loading', async () => {
    const h = await setup([text('old')])
    await turn(h)
    setAgentDataset('dataset-a', false)
    await vi.waitFor(() => expect(h.agent.snapshot().phase).toBe('idle'))
    await lock('regenerate-not-ready', h, { regenerated: await h.agent.regenerate() })
  })

  it('stops accepting work once disposed', async () => {
    const h = await setup([text('done')])
    await turn(h)
    await h.agent.dispose()
    await lock('disposed', h, { accepted: await h.agent.send('late') })
  })

  it('starts a new conversation and keeps the previous one', async () => {
    const h = await setup([text('first'), text('second')])
    await h.agent.setInstructions('AGENTS.md', 'Keep exact m/z values.')
    await turn(h)
    await h.agent.newConversation()
    await turn(h)
    await lock('new-conversation', h)
  })
})

describe('tools', () => {
  it('runs a tool and continues', async () => {
    const h = await setup([toolCall('lookup'), text('answer')])
    await lock('tool-round-trip', h, { accepted: await turn(h) })
  })

  it('archives a truncated result and reads it back in windows', async () => {
    const h = await setup([
      toolCall('long_lookup'),
      async function* (options) {
        const stub = options.messages
          .flatMap((message) => (message.role === 'tool' ? [message.content] : []))
          .join('')
        const archiveId = /read_archived_result\("([^"]+)"\)/.exec(stub)![1]!
        yield* toolCall('read_archived_result', { archiveId }, 'c2')
      },
      toolCall('read_archived_result', { archiveId: 'missing-id' }, 'c3'),
      text('answer'),
    ])
    await lock('tool-archive', h, { accepted: await turn(h) })
  })

  it('reports unknown tools, bad arguments and failures to the model', async () => {
    const h = await setup([
      [
        { type: 'tool-call-delta', index: 0, id: 'a', name: 'missing', argumentsDelta: '{}' },
        { type: 'tool-call-delta', index: 1, id: 'b', name: 'needs_arg', argumentsDelta: '{}' },
        { type: 'tool-call-delta', index: 2, id: 'c', name: 'failing', argumentsDelta: '{}' },
        { type: 'tool-call-delta', index: 3, id: 'd', name: 'lookup', argumentsDelta: 'not json' },
        { type: 'finish', reason: { kind: 'tool-calls' } },
      ],
      text('answer'),
    ])
    await lock('tool-errors', h, { accepted: await turn(h) })
  })

  it('honours the tool pipeline events', async () => {
    const h = await setup([toolCall('lookup'), toolCall('failing', {}, 'c2'), text('answer')])
    h.ctx.on('tools/pre-execute', (exec) =>
      exec.name === 'lookup' ? { kind: 'deny', reason: 'blocked by policy' } : undefined,
    )
    h.ctx.on('tools/post-execute', (exec, next) => {
      const result = next()
      return exec.name === 'failing' ? { ...result, content: 'rewritten failure' } : result
    })
    await lock('tool-pipeline', h, { accepted: await turn(h) })
  })
})

describe('retries', () => {
  it('retries a retryable failure', async () => {
    const h = await setup([
      [
        { type: 'text-delta', index: 0, text: 'bad prefix' },
        ...fail(LlmCode.SERVER, 'upstream hiccup'),
      ],
      text('good'),
    ])
    await lock('retry-success', h, { accepted: await turn(h) })
  })

  it('gives up after the retry budget', async () => {
    const h = await setup([fail(LlmCode.SERVER), fail(LlmCode.SERVER), fail(LlmCode.SERVER)])
    await lock('retry-exhausted', h, { accepted: await turn(h) })
  })

  it('counts retries per step', async () => {
    const h = await setup([
      fail(LlmCode.SERVER),
      fail(LlmCode.SERVER),
      toolCall('lookup'),
      fail(LlmCode.TIMEOUT),
      fail(LlmCode.TIMEOUT),
      text('done'),
    ])
    await lock('retry-per-step', h, { accepted: await turn(h) })
  })

  it('does not retry a permanent failure', async () => {
    const h = await setup([
      [
        {
          type: 'finish',
          reason: { kind: 'error', failure: { code: LlmCode.AUTH, message: 'nope', status: 401 } },
        },
      ],
    ])
    await lock('retry-permanent', h, { accepted: await turn(h) })
  })

  it('turns an adapter exception into a failure', async () => {
    const h = await setup([
      async function* () {
        throw new Error('socket closed')
      },
    ])
    await lock('adapter-throws', h, { accepted: await turn(h) })
  })

  it('stops during the retry backoff', async () => {
    const h = await setup([fail(LlmCode.SERVER)], {
      retryPolicy: {
        maxRetries: 2,
        backoff: { initialDelayMs: 60_000, maxDelayMs: 60_000, jitterRatio: 0 },
      },
    })
    const accepted = await h.agent.send('question')
    await vi.waitFor(() =>
      expect(h.agent.snapshot().messages[1]?.retrying).toEqual({ retry: 1, maxRetries: 2 }),
    )
    h.agent.stop()
    await h.agent.whenIdle()
    await lock('retry-stopped', h, { accepted })
  })
})

describe('context budget', () => {
  it('compacts under pressure before the request', async () => {
    const h = await setup([
      text('e'.repeat(75_000)),
      text('summary of the first turn with m/z 885.5'),
      text('second answer'),
    ])
    saveContextWindow(connection, 'm', 64_000)
    await turn(h, 'q'.repeat(60_000))
    await lock('compaction-pressure', h, { accepted: await turn(h, 'next question') })
  })

  it('summarises old images with the rest of the history', async () => {
    const h = await setup([
      text('e'.repeat(9_000)),
      text('summary of the three images'),
      text('second answer'),
    ])
    saveContextWindow(connection, 'm', 20_000)
    await turn(h, 'look at these', [PNG, PNG, PNG])
    await lock('compaction-images', h, { accepted: await turn(h, 'next question') })
  })

  it('keeps a tool call and its results together', async () => {
    const h = await setup([
      [
        { type: 'tool-call-delta', index: 0, id: 'a', name: 'long_lookup', argumentsDelta: '{}' },
        { type: 'tool-call-delta', index: 1, id: 'b', name: 'long_lookup', argumentsDelta: '{}' },
        { type: 'tool-call-delta', index: 2, id: 'c', name: 'long_lookup', argumentsDelta: '{}' },
        { type: 'finish', reason: { kind: 'tool-calls' } },
      ],
      text('first answer'),
      text('summary of the first question'),
      text('second answer'),
    ])
    saveContextWindow(connection, 'm', 6_000)
    await turn(h, 'q'.repeat(1_500))
    await lock('compaction-tool-pairs', h, { accepted: await turn(h, 'next question') })
  })

  it('continues when the summary fails and the request still fits', async () => {
    const h = await setup([
      text('e'.repeat(60_000)),
      fail(LlmCode.SERVER, 'summary failed'),
      text('second answer'),
    ])
    saveContextWindow(connection, 'm', 64_000)
    await turn(h, 'q'.repeat(60_000))
    await lock('compaction-summary-fails', h, { accepted: await turn(h, 'next question') })
  })

  it('merges a prior checkpoint into the next one', async () => {
    const h = await setup([
      text('e'.repeat(75_000)),
      text('first checkpoint'),
      text('f'.repeat(75_000)),
      text('merged checkpoint'),
      text('third answer'),
    ])
    saveContextWindow(connection, 'm', 64_000)
    await turn(h, 'q'.repeat(60_000))
    await turn(h, 'r'.repeat(10_000))
    await lock('compaction-merges-checkpoint', h, { accepted: await turn(h, 'third question') })
  })

  it('leaves it to the endpoint when the estimate is over the window', async () => {
    const h = await setup([text('it fit after all')])
    saveContextWindow(connection, 'm', 16_000)
    await lock('context-estimate-over', h, { accepted: await turn(h, 'q'.repeat(100_000)) })
  })

  it('reports an overflow when there is nothing older to shrink', async () => {
    const h = await setup([fail(LlmCode.CONTEXT_WINDOW_EXCEEDED, 'too long')])
    saveContextWindow(connection, 'm', 16_000)
    await lock('context-too-large', h, { accepted: await turn(h, 'q'.repeat(100_000)) })
  })

  it('recovers from an overflow reported by the endpoint', async () => {
    const h = await setup([
      text('e'.repeat(45_000)),
      fail(LlmCode.CONTEXT_WINDOW_EXCEEDED, 'too long'),
      text('summary of the first turn'),
      text('second answer'),
    ])
    saveContextWindow(connection, 'm', 64_000)
    await turn(h, 'q'.repeat(30_000))
    await lock('overflow-recovered', h, { accepted: await turn(h, 'next question') })
  })

  it('gives up when the retry overflows again without a reply in between', async () => {
    const h = await setup([
      text('e'.repeat(45_000)),
      fail(LlmCode.CONTEXT_WINDOW_EXCEEDED, 'too long'),
      text('summary of the first turn'),
      fail(LlmCode.CONTEXT_WINDOW_EXCEEDED, 'still too long'),
    ])
    saveContextWindow(connection, 'm', 64_000)
    await turn(h, 'q'.repeat(30_000))
    await lock('overflow-once', h, { accepted: await turn(h, 'next question') })
  })

  it('reports an overflow it cannot shrink', async () => {
    const h = await setup([text('short'), fail(LlmCode.CONTEXT_WINDOW_EXCEEDED, 'too long')])
    await turn(h)
    await lock('overflow-no-progress', h, { accepted: await turn(h, 'next question') })
  })

  it('ends a tool loop that fills the window and continues from it next turn', async () => {
    const h = await setup([
      toolCall('lookup', {}, 'c0'),
      toolCall('lookup', {}, 'c1'),
      fail(LlmCode.CONTEXT_WINDOW_EXCEEDED, 'too long'),
      text('carried on'),
    ])
    await turn(h)
    await lock('overflow-tool-loop', h, { accepted: await turn(h, 'continue') })
  })

  it('compacts on demand', async () => {
    const h = await setup([text('e'.repeat(180_000)), text('manual summary')])
    await turn(h, 'q'.repeat(200_000))
    await h.agent.compact()
    await lock('compact-manual', h)
  })

  it('compacts on demand on a window smaller than the default output limit', async () => {
    const h = await setup([text('e'.repeat(75_000)), text('manual summary')])
    saveContextWindow(connection, 'm', 64_000)
    await turn(h, 'q'.repeat(60_000))
    await h.agent.compact()
    await lock('compact-manual-small-window', h)
  })

  it('reports a manual compaction without progress', async () => {
    const h = await setup([text('short')])
    await turn(h)
    await h.agent.compact()
    await lock('compact-manual-no-progress', h)
  })

  it('reports no progress when compacting an empty conversation', async () => {
    const h = await setup([])
    await h.agent.ready()
    await h.agent.compact()
    await lock('compact-manual-empty', h)
  })

  it('stops while the summary is being written', async () => {
    const h = await setup([
      text('e'.repeat(75_000)),
      async function* (_options, _route, signal) {
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        )
        yield { type: 'finish', reason: { kind: 'stop' } } as StreamChunk
      },
    ])
    saveContextWindow(connection, 'm', 64_000)
    await turn(h, 'q'.repeat(60_000))
    const accepted = await h.agent.send('next question')
    await vi.waitFor(() => expect(h.agent.snapshot().phase).toBe('compacting'))
    h.agent.stop()
    await h.agent.whenIdle()
    await lock('compaction-stopped', h, { accepted })
  })

  it('compacts again after a turn fails to shrink the same surface', async () => {
    const h = await setup([
      text('e'.repeat(60_000)),
      fail(LlmCode.SERVER, 'summary failed'),
      text('second answer'),
      fail(LlmCode.SERVER, 'summary failed again'),
      toolCall('lookup'),
      text('third answer'),
    ])
    saveContextWindow(connection, 'm', 64_000)
    await turn(h, 'q'.repeat(60_000))
    await turn(h, 'second question')
    await lock('compaction-retried-next-turn', h, { accepted: await turn(h, 'third question') })
  })

  it('respects the model context window and adapter limits', async () => {
    const h = await setup([text('done')], {
      adapter: {
        resolveModel: async () => ({
          endpoint: 'anthropic',
          id: 'm',
          context: { contextWindow: 64_000 },
          defaultMaxTokens: 8_000,
        }),
      },
    })
    await lock('model-limits', h, { accepted: await turn(h) })
  })
})

describe('cancellation', () => {
  it('keeps delivered text when stopped mid-stream', async () => {
    const h = await setup([
      async function* (_options, _route, signal) {
        yield { type: 'text-delta', index: 0, text: 'partial' } as StreamChunk
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        )
        yield { type: 'finish', reason: { kind: 'stop' } } as StreamChunk
      },
    ])
    const accepted = await h.agent.send('question')
    await vi.waitFor(() =>
      expect(h.agent.snapshot().messages[1]?.parts?.[0]).toMatchObject({ text: 'partial' }),
    )
    h.agent.stop()
    await h.agent.whenIdle()
    await lock('stop-mid-stream', h, { accepted })
  })

  it('stops an adapter that ignores cancellation', async () => {
    const h = await setup([
      async function* () {
        await new Promise<void>(() => {})
        yield* text('late')
      },
    ])
    const accepted = await h.agent.send('question')
    await vi.waitFor(() => expect(h.agent.snapshot().phase).toBe('generating'))
    h.agent.stop()
    await h.agent.whenIdle()
    await lock('stop-unresponsive-adapter', h, { accepted })
  })

  it('closes a running tool when stopped', async () => {
    const h = await setup([toolCall('slow')])
    const accepted = await h.agent.send('question')
    await h.slowTool.entered
    h.agent.stop()
    await h.agent.whenIdle()
    await lock('stop-during-tool', h, { accepted })
  })

  it('does not run a tool once a cancelled gate lets go', async () => {
    const h = await setup([toolCall('gated')])
    const execute = vi.fn(async () => 'unexpected')
    h.ctx.tools.register(defineTool({ name: 'gated', description: '', parameters: {}, execute }))
    let release: (() => void) | undefined
    h.ctx.on('tools/pre-execute', async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
    })
    await h.agent.send('question')
    await vi.waitFor(() => expect(release).toBeDefined())
    h.agent.stop()
    release!()
    await h.agent.whenIdle()
    expect(execute).not.toHaveBeenCalled()
  })

  it('stops during preparation', async () => {
    let enter!: () => void
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const h = await setup([], {
      adapter: {
        resolveModel: async (route, signal) => {
          enter()
          await new Promise<void>((resolve) =>
            signal?.addEventListener('abort', () => resolve(), { once: true }),
          )
          return { endpoint: route.endpoint, id: route.model }
        },
      },
    })
    const sending = h.agent.send('question')
    await entered
    h.agent.stop()
    const accepted = await sending
    await h.agent.whenIdle()
    await lock('stop-preparing', h, { accepted })
  })
})

describe('analysis binding', () => {
  it('holds a question until the dataset is ready', async () => {
    const h = await setup([text('done')])
    const generation = setAgentDataset('dataset-b', false)
    const early = await turn(h, 'draft')
    markAgentDatasetReady(generation)
    const ready = await turn(h, 'draft')
    await lock('dataset-not-ready', h, { early, ready })
  })

  it('switches sessions with the dataset and comes back', async () => {
    const h = await setup([text('on a'), text('on b')])
    await turn(h, 'first')
    setAgentDataset('dataset-b', true)
    await vi.waitFor(() => expect(h.agent.snapshot().messages).toEqual([]))
    await turn(h, 'second')
    setAgentDataset('dataset-a', true)
    await vi.waitFor(() => {
      expect(h.agent.snapshot().messages).toHaveLength(2)
      expect(h.agent.snapshot().phase).toBe('idle')
    })
    await lock('dataset-switch', h)
  })

  it('abandons a running tool when the dataset changes', async () => {
    const h = await setup([toolCall('slow')])
    const accepted = await h.agent.send('question')
    await h.slowTool.entered
    setAgentDataset('dataset-b', true)
    await vi.waitFor(() => {
      expect(h.agent.snapshot().messages).toEqual([])
      expect(h.agent.snapshot().phase).toBe('idle')
    })
    await lock('dataset-switch-during-tool', h, { accepted })
  })

  it.each([
    ['ion', 'get_ion_image_stats', () => selectIon(741.531), () => selectIon(800.5)],
    [
      'clusters',
      'get_kmeans_summary',
      () =>
        registerContextProviders({
          kmeans: () => ({ k: 2, clusterSizes: [3, 4], selectedIds: [1] }),
        }),
      () =>
        registerContextProviders({
          kmeans: () => ({ k: 2, clusterSizes: [3, 4], selectedIds: [0] }),
        }),
    ],
    [
      'pixel',
      'get_pixel_spectrum',
      () => {
        pixelSpectrum.value = { pixelIndex: 4, x: 1, y: 2 } as never
      },
      () => {
        pixelSpectrum.value = { pixelIndex: 5, x: 2, y: 2 } as never
      },
    ],
    [
      'weights',
      'get_annotation_top',
      () =>
        registerContextProviders({
          annotations: () => ({
            count: 0,
            rows: () => [],
            weights: { mass: 0.5, adduct: 0.2, spatial: 0.3 },
          }),
        }),
      () =>
        registerContextProviders({
          annotations: () => ({
            count: 0,
            rows: () => [],
            weights: { mass: 0.1, adduct: 0.2, spatial: 0.7 },
          }),
        }),
    ],
  ] as const)('fails the turn when the %s selection changes', async (name, tool, before, after) => {
    before()
    const h = await setup(
      [
        async function* () {
          after()
          yield* toolCall(tool)
        },
      ],
      { fullTools: true, noScriptTools: true },
    )
    await lock(`binding-${name}`, h, { accepted: await turn(h) })
  })
})

describe('attachments', () => {
  it('stores images and sends them to the model', async () => {
    const h = await setup([text('a picture')])
    const accepted = await turn(h, 'look', [PNG])
    await vi.waitFor(() => expect(h.agent.snapshot().messages[0]?.images).toHaveLength(1))
    await lock('images', h, { accepted })
  })

  it('rejects a text-only model before a turn starts', async () => {
    const h = await setup([text('no picture')], {
      adapter: {
        resolveModel: async (route) => ({
          endpoint: route.endpoint,
          id: route.model,
          inputModalities: ['text'],
        }),
      },
    })
    const accepted = await turn(h, 'look', [PNG, PNG])
    expect(accepted).toBe(false)
    expect(h.calls).toHaveLength(0)
    expect(h.agent.snapshot().error).toContain('multimodal model')
    await lock('images-text-only', h, { accepted })
  })

  it('rejects an unsupported attachment', async () => {
    const h = await setup([])
    await lock('images-invalid', h, {
      accepted: await turn(h, 'look', ['data:image/gif;base64,R0lGODdh']),
    })
  })

  it('resolves a stored image to a url', async () => {
    const h = await setup([text('a picture')])
    await turn(h, 'look', [PNG])
    const [ref] = h.agent.snapshot().messages[0]!.attachments!
    const url = await h.agent.imageUrl(ref!.id)
    await expect(h.agent.imageUrl('missing')).rejects.toThrow()
    await lock('images-url', h, { url })
  })
})

describe('instructions', () => {
  it('feeds instructions into the prompt and restores them', async () => {
    const storage = createMemoryStorage()
    const h = await setup([text('one'), text('two'), text('three')], {
      openStorage: async () => storage,
    })
    await h.agent.setInstructions('AGENTS.md', 'First rule.')
    await turn(h)
    await h.agent.setInstructions('RULES.md', 'Second rule.')
    await turn(h)
    await h.agent.setInstructions('', '')
    await turn(h)
    await h.agent.setInstructions('AGENTS.md', 'Last rule.')
    const prompts = h.calls.map(
      (call) => /## User-provided instructions[^\n]*\n[^\n]*/.exec(call.system!)?.[0] ?? null,
    )
    await h.dispose()
    open.splice(open.indexOf(h), 1)

    const next = await setup([text('four')], { openStorage: async () => storage })
    await next.agent.ready()
    const restored = next.agent.snapshot().instructions
    await turn(next)
    await lock('instructions', next, { restored, prompts })
    expect(next.calls[0]!.system).toContain('## User-provided instructions (AGENTS.md)\nLast rule.')
  })

  it('rejects oversized instructions and changes during a turn', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const h = await setup([
      async function* () {
        await gate
        yield* text('done')
      },
    ])
    const tooLarge = await h.agent
      .setInstructions('big.md', 'x'.repeat(65_537))
      .catch((error: Error) => error.message)
    await h.agent.send('question')
    await vi.waitFor(() => expect(h.agent.snapshot().phase).toBe('generating'))
    const busy = await h.agent
      .setInstructions('AGENTS.md', 'rule')
      .catch((error: Error) => error.message)
    release()
    await h.agent.whenIdle()
    await lock('instructions-rejected', h, { tooLarge, busy })
  })
})

describe('storage', () => {
  /** 一段写于重构之前的日志：停在工具调用中途，第二个调用还没开始 */
  const crashedLog = () => {
    const binding = { datasetId: 'dataset-a', generation: baseGeneration, page: {} }
    const user = { role: 'user', content: 'question' }
    const request = {
      system: 'old system prompt',
      tools: [],
      nodes: [2],
      route: { endpoint: 'anthropic', baseUrl: 'https://llm.test/v1', model: 'm' },
      maxTokens: 4096,
      contextWindow: 256000,
      imageMode: 'image',
      purpose: 'conversation',
      turnStart: 0,
    }
    const events = [
      { type: 'instructions/set', name: 'AGENTS.md', text: 'Old rule.' },
      { type: 'turn/start', turnId: 't1', user, binding, baseSurface: [] },
      { type: 'message', turnId: 't1', message: user },
      { type: 'step/start', turnId: 't1', step: 1 },
      { type: 'request/context', turnId: 't1', attemptId: 'a1', request },
      { type: 'attempt/start', turnId: 't1', step: 1, attemptId: 'a1', request },
      {
        type: 'attempt/end',
        turnId: 't1',
        attemptId: 'a1',
        status: 'committed',
        usage: { inputTokens: 100, outputTokens: 5 },
      },
      {
        type: 'message',
        turnId: 't1',
        message: {
          role: 'assistant',
          parts: [
            { type: 'reasoning', text: 'plan' },
            { type: 'tool-call', id: 'one', name: 'lookup', arguments: '{}' },
            { type: 'tool-call', id: 'two', name: 'lookup', arguments: '{}' },
          ],
          source: { endpoint: 'anthropic', baseUrl: 'https://llm.test/v1', model: 'm' },
        },
      },
      {
        type: 'tool/start',
        turnId: 't1',
        callKey: '7:1',
        callId: 'one',
        name: 'lookup',
        input: {},
      },
    ].map((event, seq) => ({ ...event, seq, id: `e${seq}`, time: 1_700_000_000_000 + seq }))
    return makeBatch('b1', 0, events)
  }

  /** 旧版压缩写的日志：裁剪过图片和工具结果，摘要带 compaction/request 和输入存档 */
  const legacyCompactionLog = () => {
    const binding = { datasetId: 'dataset-a', generation: baseGeneration, page: {} }
    const user = { role: 'user', content: 'old question' }
    const request = {
      system: 'old summary prompt',
      nodes: [1, 2],
      route: { endpoint: 'anthropic', baseUrl: 'https://llm.test/v1', model: 'm' },
      maxTokens: 8000,
      contextWindow: 256000,
      imageMode: 'placeholder',
      purpose: 'compaction',
    }
    const events = [
      { type: 'turn/start', turnId: 't1', user, binding, baseSurface: [] },
      { type: 'message', turnId: 't1', message: user },
      {
        type: 'message',
        turnId: 't1',
        message: { role: 'assistant', parts: [{ type: 'text', text: 'old answer' }] },
      },
      { type: 'turn/end', turnId: 't1', reason: 'completed' },
      { type: 'compaction/start', compactionId: 'c1', nodes: [1, 2] },
      {
        type: 'message',
        surfaceOp: { op: 'replace', nodes: [1] },
        surfaceReason: 'image-offload',
        message: { role: 'user', content: 'old question\n[1 earlier images omitted]' },
      },
      { type: 'compaction/request', compactionId: 'c1', inputId: 'old-input', request },
      {
        type: 'message',
        surfaceOp: { op: 'replace', nodes: [5, 2] },
        surfaceReason: 'summary',
        message: {
          role: 'user',
          content: '[Earlier conversation summary]\nold summary\n[End of summary]',
        },
      },
      {
        type: 'compaction/end',
        compactionId: 'c1',
        beforeTokens: 900,
        afterTokens: 100,
      },
    ].map((event, seq) => ({ ...event, seq, id: `e${seq}`, time: 1_700_000_000_000 + seq }))
    return makeBatch('b1', 0, events)
  }

  it('still reads a log written by the old compaction', async () => {
    const storage = createMemoryStorage()
    await storage.append(legacyCompactionLog())
    const h = await setup([text('continued')], { openStorage: async () => storage })
    await h.agent.ready()
    const accepted = await turn(h, 'next')
    expect(JSON.stringify(h.calls[0]!.messages)).toContain('old summary')
    await lock('legacy-compaction-log', h, { accepted })
  })

  it('recovers a log that was interrupted by a crash', async () => {
    const storage = createMemoryStorage()
    await storage.append(crashedLog())
    const h = await setup([text('continued')], { openStorage: async () => storage })
    await h.agent.ready()
    const recovered = h.agent.snapshot()
    await turn(h, 'next')
    await lock('crash-recovery', h, { recovered: recovered.messages })
  })

  it('shows a conversation open in another tab as read-only', async () => {
    const source = createMemoryStorage()
    await source.append(crashedLog())
    const storage: SessionStorage = {
      ...source,
      id: 'read-only',
      mode: 'read-only',
      read: () => source.read(),
      append: async () => {
        throw new Error('Session is read-only')
      },
    }
    const h = await setup([], { openStorage: async () => storage })
    await h.agent.ready()
    await lock('read-only', h, { accepted: await turn(h) })
  })

  it('keeps a failed batch until it is saved again', async () => {
    const storage = createMemoryStorage()
    const append = storage.append.bind(storage)
    let failing = true
    storage.append = async (batch) => {
      if (failing) throw new Error('quota')
      await append(batch)
    }
    const h = await setup([text('done')], { openStorage: async () => storage })
    const accepted = await turn(h)
    const during = h.agent.snapshot().phase
    failing = false
    await h.agent.retrySave()
    const resumed = await turn(h, 'again')
    await lock('storage-failure', h, { accepted, during, resumed })
  })

  it('reports a failed open and retries it', async () => {
    const storage = createMemoryStorage()
    let failing = true
    const h = await setup([text('done')], {
      openStorage: async () => {
        if (failing) throw new Error('disk unavailable')
        return storage
      },
    })
    const opened = await h.agent.ready().then(
      () => 'opened',
      (error: Error) => error.message,
    )
    const during = h.agent.snapshot()
    failing = false
    await h.agent.retrySave()
    await lock('storage-open-failure', h, {
      opened,
      during: { phase: during.phase, error: during.error },
      accepted: await turn(h),
    })
  })

  it('closes the open turn after a write fails mid-turn', async () => {
    const storage = createMemoryStorage()
    const append = storage.append.bind(storage)
    let writes = 0
    let failing = true
    storage.append = async (batch) => {
      if (failing && ++writes >= 4) throw new Error('quota')
      await append(batch)
    }
    const h = await setup([text('done')], { openStorage: async () => storage })
    const accepted = await turn(h)
    const during = { phase: h.agent.snapshot().phase, error: h.agent.snapshot().error }
    failing = false
    await h.agent.retrySave()
    await lock('storage-failure-mid-turn', h, { accepted, during })
  })
})

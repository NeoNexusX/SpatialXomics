import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { KeggClient } from '../kegg'
import { keggLookup, pathwayEnrichment, apply } from '../index'
import { ToolRuntime } from '../../tools'
import { SystemPrompt } from '../../system-prompt'
import {
  registerContextProviders,
  unregisterContextProviders,
} from '../../../bridge/analysisContext'
import type { AnnotationRow } from '../../../bridge/analysisTypes'

let tick = 0
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.UTC(2026, 10, 3) + tick++ * 1_000_000)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  unregisterContextProviders()
})

async function complete<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => {})
  await vi.runAllTimersAsync()
  return promise
}

function stub(routes: Record<string, string | Response>) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    init?.signal?.throwIfAborted()
    expect(url.startsWith('/kegg-rest/')).toBe(true)
    const path = url.slice('/kegg-rest/'.length)
    if (!(path in routes)) throw new Error(`Unexpected request: ${path}`)
    const result = routes[path]!
    return typeof result === 'string'
      ? new Response(result, { headers: { 'content-type': 'text/plain' } })
      : result
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

function row(rank: number, name: string, formula: string): AnnotationRow {
  return {
    id: rank,
    rank,
    name,
    formula,
    origin: 'endogenous',
    candidates: [{ id: '', name, origin: 'endogenous' }],
    adduct: '[M+H]+',
    theoMz: 100,
    obsMz: 100,
    errPpm: 0,
    intensity: 1,
    massScore: 1,
    adductFit: 1,
    chaos: null,
    coloc: null,
    spatialScore: null,
    totalScore: 1,
    q: null,
    siblings: [],
    samePeak: [],
    missingAdducts: [],
  }
}

const glucose = {
  'list/C00031': 'C00031\tD-Glucose; Glucose\n',
  'link/pathway/C00031': 'cpd:C00031\tpath:map00010\ncpd:C00031\tpath:map00010\n',
  'list/map00010': 'map00010\tGlycolysis / Gluconeogenesis\n',
}

it('looks up a compound using live official list/link routes and returns citations', async () => {
  const fetcher = stub(glucose)
  const text = await complete(keggLookup('C00031', 10))
  expect(text).toContain('https://www.kegg.jp/entry/C00031')
  expect(text).toContain('https://www.kegg.jp/pathway/map00010')
  expect(text).toContain('1 reference pathway(s)')
  expect(text).toContain('KEGG REST API (live query; retrieved')
  expect(fetcher).toHaveBeenCalledTimes(3)
})

it('looks up pathway members and accepts simplified official identifiers', async () => {
  stub({
    'list/map00010': glucose['list/map00010'],
    'link/compound/map00010': 'path:map00010\tcpd:C00031\npath:map00010\tcpd:C00022\n',
    'list/C00031': glucose['list/C00031'],
  })
  const text = await complete(keggLookup('map00010', 1))
  expect(text).toContain('showing 1 of 2')
  expect(text).toContain('D-Glucose')
})

it('folds adducts by formula, maps distinct identities once, and reports unmapped groups', async () => {
  const fetcher = stub({
    'find/compound/D-Glucose/nop': glucose['list/C00031'],
    'find/compound/L-Glutamine/nop': 'C00064\tL-Glutamine\n',
    'find/compound/PC%2034%3A1/nop': '',
    'link/pathway/C00031+C00064': 'cpd:C00031\tpath:map00010\ncpd:C00064\tpath:map00010\n',
    'list/map00010': glucose['list/map00010'],
  })
  const result = await complete(
    pathwayEnrichment(
      [
        row(1, 'D-Glucose', 'C6H12O6'),
        row(2, 'D-Glucose', 'C6H12O6'),
        row(3, 'L-Glutamine', 'C5H10N2O3'),
        row(4, 'PC 34:1', 'C42H82NO8P'),
      ],
      20,
    ),
  )
  expect(result).toMatchObject({ totalFormulas: 3, mappedFormulas: 2, unmapped: ['PC 34:1'] })
  expect(result.hits[0]!.formulas).toEqual(['C6H12O6', 'C5H10N2O3'])
  expect(fetcher).toHaveBeenCalledTimes(5)
})

it('does not accept a derivative keyword hit as the annotated identity', async () => {
  const fetcher = stub({ 'find/compound/Glucose/nop': 'C00092\tD-Glucose 6-phosphate\n' })
  const result = await complete(pathwayEnrichment([row(1, 'Glucose', 'C6H12O6')], 10))
  expect(result.mappedFormulas).toBe(0)
  expect(result.unmapped).toEqual(['Glucose'])
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('retains ambiguous exact matches without double-counting a formula', async () => {
  stub({
    'find/compound/Glucose/nop': 'C00031\tD-Glucose; Glucose\nC00267\talpha-D-Glucose; Glucose\n',
    'link/pathway/C00031+C00267': 'cpd:C00031\tpath:map00010\ncpd:C00267\tpath:map00010\n',
    'list/map00010': glucose['list/map00010'],
  })
  const result = await complete(pathwayEnrichment([row(1, 'Glucose', 'C6H12O6')], 10))
  expect(result.ambiguous).toEqual([{ query: 'Glucose', ids: ['C00031', 'C00267'] }])
  expect(result.hits[0]!.formulas).toEqual(['C6H12O6'])
})

it('uses an explicit candidate KEGG ID instead of a display name', async () => {
  stub(glucose)
  const annotation = row(1, 'unresolved display label', 'C6H12O6')
  annotation.candidates[0]!.id = 'C00031'
  expect((await complete(pathwayEnrichment([annotation], 10))).mappedFormulas).toBe(1)
})

it('bounds candidate queries and exposes deferred alternatives as incomplete coverage', async () => {
  const annotation = row(1, 'candidate0', 'C6H12O6')
  annotation.candidates = Array.from({ length: 51 }, (_, i) => ({
    id: '',
    name: `candidate${i}`,
    origin: 'endogenous',
  }))
  const fetcher = stub(
    Object.fromEntries(
      annotation.candidates.map((candidate) => [`find/compound/${candidate.name}/nop`, '']),
    ),
  )
  const result = await complete(pathwayEnrichment([annotation], 10))
  expect(fetcher).toHaveBeenCalledTimes(50)
  expect(result.deferred).toEqual(['candidate50'])
})

it.each([
  new Response('<!doctype html><html></html>', { headers: { 'content-type': 'text/html' } }),
  new Response('not a KEGG response'),
  new Response('unavailable', { status: 503 }),
  new Response('rate limited', { status: 429 }),
])(
  'reports malformed/proxy/upstream failures rather than empty pathway results',
  async (response) => {
    stub({ 'list/C00031': response })
    await expect(complete(keggLookup('C00031', 5))).rejects.toThrow(/KEGG/)
  },
)

it('preserves an explicit empty successful response as a search miss', async () => {
  stub({ 'find/compound/unknown/nop': '', 'find/pathway/unknown': '' })
  expect(await complete(keggLookup('unknown', 5))).toContain('database search miss')
})

it('shares rate limits across clients and deduplicates only within each invocation', async () => {
  const fetcher = stub(glucose)
  const starts: number[] = []
  const original = fetcher.getMockImplementation()!
  fetcher.mockImplementation(async (...args) => {
    starts.push(Date.now())
    return original(...args)
  })
  const first = new KeggClient()
  await complete(
    Promise.all([
      first.findCompounds('C00031'),
      first.findCompounds('C00031'),
      new KeggClient().findCompounds('C00031'),
    ]),
  )
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(350)
})

it('cancels queued work without making an upstream request', async () => {
  const fetcher = stub(glucose)
  const controller = new AbortController()
  const reason = new Error('cancelled by user')
  const client = new KeggClient(controller.signal)
  const first = client.findCompounds('C00031')
  controller.abort(reason)
  await expect(complete(first)).rejects.toBe(reason)
  expect(fetcher).not.toHaveBeenCalled()
})

it('cancels an in-flight fetch and preserves the caller cancellation reason', async () => {
  const fetcher = vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
      }),
  )
  vi.stubGlobal('fetch', fetcher)
  const controller = new AbortController()
  const reason = new Error('stop this query')
  const work = new KeggClient(controller.signal).findCompounds('C00031')
  void work.catch(() => {})
  await vi.advanceTimersByTimeAsync(0)
  expect(fetcher).toHaveBeenCalledTimes(1)
  controller.abort(reason)
  await expect(complete(work)).rejects.toBe(reason)
  expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true)
})

it('reports network failure and cancels the other queued requests in the invocation', async () => {
  const fetcher = vi.fn(async () => {
    throw new TypeError('network unavailable')
  })
  vi.stubGlobal('fetch', fetcher)
  await expect(complete(keggLookup('Glucose', 5))).rejects.toThrow('network/timeout')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('splits live definition requests into batches of at most ten IDs', async () => {
  const ids = Array.from({ length: 11 }, (_, i) => `C${String(i + 1).padStart(5, '0')}`)
  const fetcher = stub({
    [`list/${ids.slice(0, 10).join('+')}`]: ids
      .slice(0, 10)
      .map((id) => `${id}\tcompound ${id}`)
      .join('\n'),
    [`list/${ids[10]}`]: `${ids[10]}\tlast compound`,
  })
  const result = await complete(new KeggClient().list(ids))
  expect(result).toHaveLength(11)
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('runs the actual pathway tool without any HMDB or KEGG files', async () => {
  const fetcher = stub(glucose)
  const annotation = row(1, 'D-Glucose', 'C6H12O6')
  annotation.candidates[0]!.id = 'C00031'
  registerContextProviders({ annotations: () => ({ count: 1, rows: () => [annotation] }) })
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    apply(ctx)
    const result = await complete(
      ctx.tools.execute({
        callId: 'pathways',
        name: 'pathway_enrichment',
        arguments: {},
        signal: new AbortController().signal,
      }),
    )
    expect(result.isError).toBe(false)
    expect(result.content).toContain('1 mapped to at least one KEGG pathway')
    expect(result.content).toContain('Counts are descriptive')
    expect(result.content).toContain('KEGG REST API (live query')
    expect(fetcher).toHaveBeenCalledTimes(3)
  } finally {
    await ctx.fiber.dispose()
  }
})

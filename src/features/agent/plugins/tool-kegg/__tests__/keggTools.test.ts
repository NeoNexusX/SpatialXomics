import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ADDUCTS, apply, keggFind, keggMassSearch } from '../index'
import { KeggClient, parseAtext } from '../kegg'
import { polarityRef } from '@/services/zarr/zarrSharedState'
import { ToolRuntime } from '../../tools'
import { SystemPrompt } from '../../system-prompt'

let tick = 0
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.UTC(2026, 10, 6) + tick++ * 1_000_000)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  polarityRef.value = ''
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

function compoundRows(count: number): string {
  return Array.from(
    { length: count },
    (_, index) => `C${String(index + 1).padStart(5, '0')}\tCompound ${index + 1}`,
  ).join('\n')
}

const field = (key: string, value: string) => `${key.padEnd(12)}${value}`
const continuation = (value: string) => `${' '.repeat(12)}${value}`

function compoundEntry(id: string, name = `Compound ${id}`): string {
  return `${field('ENTRY', `${id}                      Compound`)}\n${field('NAME', name)}\n///\n`
}

function compoundIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `C${String(index + 1).padStart(5, '0')}`)
}

function pathwayEntry(id: string, name = `Pathway ${id}`): string {
  return [
    field('ENTRY', `${id}                      Pathway`),
    field('NAME', name),
    field('CLASS', 'Global and overview maps'),
    field('DESCRIPTION', `Description of ${name}`),
    '///',
  ].join('\n')
}

function pathwayCompoundLinks(id: string, compounds: string[]): string {
  return compounds.map((compound) => `path:${id}\tcpd:${compound}`).join('\n')
}

function exactMassEntry(id: string, name: string, exactMass: number): string {
  return [
    field('ENTRY', `${id}                      Compound`),
    field('NAME', name),
    field('EXACT_MASS', String(exactMass)),
    '///',
  ].join('\n')
}

function massFindRoutes(
  mz: number,
  polarity: 'positive' | 'negative',
  ppm: number,
  hits: Record<string, [string, string][]> = {},
): Record<string, string> {
  const routes: Record<string, string> = {}
  const tolerance = (mz * ppm) / 1e6
  for (const [adduct, shift] of Object.entries(ADDUCTS[polarity])) {
    const neutral = mz - shift
    const lo = Math.max(neutral - tolerance, 1e-6)
    const hi = neutral + tolerance
    routes[`find/compound/${lo.toFixed(6)}-${hi.toFixed(6)}/exact_mass`] = (hits[adduct] ?? [])
      .map(([id, name]) => `${id}\t${name}`)
      .join('\n')
  }
  return routes
}

function resultJson(text: string) {
  return JSON.parse(text.slice(0, text.indexOf('\nsource:')))
}

async function makeContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  apply(ctx)
  return ctx
}

it('retrieves all matches before slicing and reports the result window', async () => {
  const fetcher = stub({ 'find/compound/target': compoundRows(30) })
  const result = resultJson(await complete(keggFind('target', 'compound', 10, 5)))
  expect(result.window).toEqual({ total: 30, offset: 10, limit: 5, returned: 5, nextOffset: 15 })
  expect(result.entries.map((entry: { id: string }) => entry.id)).toEqual([
    'C00011',
    'C00012',
    'C00013',
    'C00014',
    'C00015',
  ])
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('sends multi-word queries without /nop so DBGET AND semantics apply', async () => {
  const fetcher = stub({ 'find/compound/glucose%20phosphate': 'C00092\tGlucose 6-phosphate\n' })
  const result = resultJson(await complete(keggFind('glucose phosphate', 'compound', 0, 10)))
  expect(result.entries).toEqual([{ id: 'C00092', name: 'Glucose 6-phosphate' }])
  expect(fetcher).toHaveBeenCalledWith(
    '/kegg-rest/find/compound/glucose%20phosphate',
    expect.anything(),
  )
})

it('preserves total and an empty page when offset is beyond the result set', async () => {
  stub({ 'find/compound/target': compoundRows(3) })
  const result = resultJson(await complete(keggFind('target', 'compound', 20, 10)))
  expect(result).toMatchObject({
    window: { total: 3, offset: 20, limit: 10, returned: 0, nextOffset: null },
    entries: [],
  })
})

it('uses the pathway endpoint only when db is pathway', async () => {
  const fetcher = stub({ 'find/pathway/glycolysis': 'map00010\tGlycolysis / Gluconeogenesis\n' })
  const result = resultJson(await complete(keggFind('glycolysis', 'pathway', 0, 10)))
  expect(result.entries).toEqual([{ id: 'map00010', name: 'Glycolysis / Gluconeogenesis' }])
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('applies one independent result window to every query in a batch', async () => {
  stub({
    'find/compound/alpha': compoundRows(3),
    'find/compound/beta': compoundRows(3),
  })
  const ctx = await makeContext()
  try {
    const result = await complete(
      ctx.tools.execute({
        callId: 'batch-window',
        name: 'kegg_find',
        arguments: { queries: ['alpha', 'beta'], offset: 1, limit: 1 },
        signal: new AbortController().signal,
      }),
    )
    expect(result.isError).toBe(false)
    expect(result.content).toContain('### alpha')
    expect(result.content).toContain('### beta')
    expect(result.content.match(/"total": 3/g)).toHaveLength(2)
    expect(result.content.match(/"offset": 1/g)).toHaveLength(2)
    expect(result.content.match(/"id": "C00002"/g)).toHaveLength(2)
    expect(result.content).not.toContain('C00001')
    expect(result.content).not.toContain('C00003')
  } finally {
    await ctx.fiber.dispose()
  }
})

it('caps each result page at 25 without treating limit as a total cap', async () => {
  stub({ 'find/compound/target': compoundRows(30) })
  const ctx = await makeContext()
  try {
    const result = await complete(
      ctx.tools.execute({
        callId: 'page-cap',
        name: 'kegg_find',
        arguments: { query: 'target', limit: 100 },
        signal: new AbortController().signal,
      }),
    )
    const parsed = resultJson(result.content)
    expect(parsed.window).toMatchObject({ total: 30, limit: 25, returned: 25, nextOffset: 25 })
    expect(parsed.entries).toHaveLength(25)
  } finally {
    await ctx.fiber.dispose()
  }
})

it('does not reuse result offset/limit as batch input pagination', async () => {
  const queries = Array.from({ length: 9 }, (_, index) => `q${index}`)
  stub(Object.fromEntries(queries.map((query) => [`find/compound/${query}`, ''])))
  const ctx = await makeContext()
  try {
    const result = await complete(
      ctx.tools.execute({
        callId: 'nine-inputs',
        name: 'kegg_find',
        arguments: { queries, offset: 2, limit: 1 },
        signal: new AbortController().signal,
      }),
    )
    expect(result.isError).toBe(false)
    for (const query of queries) expect(result.content).toContain(`### ${query}`)
    expect(result.content).not.toContain('queries not returned')
  } finally {
    await ctx.fiber.dispose()
  }
})

it('parses a-text continuations, multiple names, pathways, DBLINKS and pathway fields', () => {
  const text = [
    field('ENTRY', 'C00031                      Compound'),
    field('NAME', 'D-Glucose;'),
    continuation('Glucose;'),
    continuation('Dextrose'),
    field('FORMULA', 'C6H12O6'),
    field('EXACT_MASS', '180.063388'),
    field('MOL_WEIGHT', '180.1559'),
    field('PATHWAY', 'map00010  Glycolysis / Gluconeogenesis'),
    continuation('map00052  Galactose metabolism'),
    field('DBLINKS', 'PubChem: 5793'),
    continuation('ChEBI: 15903, 4167'),
    '///',
    field('ENTRY', 'map00010                      Pathway'),
    field('NAME', 'Glycolysis / Gluconeogenesis'),
    field('CLASS', 'Global and overview maps'),
    field('DESCRIPTION', 'Glycolysis is'),
    continuation('a central pathway.'),
    '///',
  ].join('\n')
  const [compound, pathway] = parseAtext(text)
  expect(compound).toMatchObject({
    id: 'C00031',
    names: ['D-Glucose', 'Glucose', 'Dextrose'],
    formula: 'C6H12O6',
    exactMass: 180.063388,
    molecularWeight: 180.1559,
    pathways: [
      { id: 'map00010', name: 'Glycolysis / Gluconeogenesis' },
      { id: 'map00052', name: 'Galactose metabolism' },
    ],
    dblinks: [
      { database: 'PubChem', values: ['5793'] },
      { database: 'ChEBI', values: ['15903', '4167'] },
    ],
  })
  expect(pathway).toMatchObject({
    id: 'map00010',
    class: 'Global and overview maps',
    description: 'Glycolysis is a central pathway.',
  })
})

it('parses real pathway entries with bare key-only lines and space-separated DBLINKS', () => {
  // Shape sampled from live https://rest.kegg.jp/get/map00010 (2026-11-09):
  // pathway entries contain key-only "REFERENCE" lines of exactly 12 columns and
  // space-separated multi-value DBLINKS ("GO: 0006096 0006094").
  const text = [
    field('ENTRY', 'map00010                    Pathway'),
    field('NAME', 'Glycolysis / Gluconeogenesis'),
    field('DESCRIPTION', 'Glycolysis is the process of converting glucose'),
    continuation('into pyruvate.'),
    'REFERENCE   ',
    continuation('AUTHORS   Heinisch J'),
    field('DBLINKS', 'GO: 0006096 0006094'),
    continuation('RN: R01786'),
    '///',
  ].join('\n')
  const [entry] = parseAtext(text)
  expect(entry).toMatchObject({
    id: 'map00010',
    names: ['Glycolysis / Gluconeogenesis'],
    description: 'Glycolysis is the process of converting glucose into pyruvate.',
    dblinks: [
      { database: 'GO', values: ['0006096', '0006094'] },
      { database: 'RN', values: ['R01786'] },
    ],
  })
})

it('skips a single malformed entry and malformed value lines instead of failing the chunk', () => {
  const text = [
    field('ENTRY', 'C00031                      Compound'),
    field('NAME', 'D-Glucose'),
    field('PATHWAY', 'rn00100  not a map id'),
    field('DBLINKS', 'no-colon-malformed'),
    '///',
    field('ENTRY', 'GARBAGE                      Compound'),
    field('NAME', 'Broken'),
    '///',
    field('ENTRY', 'C00162                      Compound'),
    field('NAME', 'Fatty acid'),
    field('DBLINKS', 'CAS: 50-99-7 2280-44-6'),
    '///',
  ].join('\n')
  const entries = parseAtext(text)
  expect(entries.map((entry) => entry.id)).toEqual(['C00031', 'C00162'])
  expect(entries[0]!.pathways).toEqual([])
  expect(entries[0]!.dblinks).toEqual([])
  // Live KEGG separates multi-value DBLINKS with spaces; both values survive.
  expect(entries[1]!.dblinks).toEqual([{ database: 'CAS', values: ['50-99-7', '2280-44-6'] }])
})

it('frames an empty successful keyword search as a database miss, not biological absence', async () => {
  stub({ 'find/compound/unknown': '' })
  const out = await complete(keggFind('unknown', 'compound', 0, 10))
  expect(out).toContain('"total": 0')
  expect(out).toContain(
    'No KEGG entries matched "unknown". This is a database search miss, not biological absence.',
  )
})

it('frames an empty mass search as a database miss, not biological absence', async () => {
  stub(massFindRoutes(500.5, 'positive', 10))
  const out = await complete(keggMassSearch(500.5, 'positive', 10, 0, 10))
  expect(out).toContain('"matches": []')
  expect(out).toContain('This is a database search miss, not biological absence.')
})

it('isolates one invalid compound id in a batch instead of failing the whole call', async () => {
  stub({
    'get/C00162': [
      field('ENTRY', 'C00162                      Compound'),
      field('NAME', 'Caffeine'),
      '///',
    ].join('\n'),
  })
  const ctx = await makeContext()
  try {
    const result = await complete(
      ctx.tools.execute({
        callId: 'compound-mixed-batch',
        name: 'kegg_compound',
        arguments: { ids: ['C00162', 'bad'] },
        signal: new AbortController().signal,
      }),
    )
    expect(result.isError).toBe(false)
    expect(result.content).toContain('names: Caffeine')
    expect(result.content).toContain('Error: Invalid KEGG compound id "BAD"')
  } finally {
    await ctx.fiber.dispose()
  }
})

it('isolates one invalid pathway id in a batch instead of failing the whole call', async () => {
  stub({
    'get/map00010': pathwayEntry('map00010', 'Glycolysis / Gluconeogenesis'),
    'link/compound/map00010': pathwayCompoundLinks('map00010', ['C00031']),
    'list/C00031': 'C00031\tD-Glucose; Glucose\n',
  })
  const ctx = await makeContext()
  try {
    const result = await complete(
      ctx.tools.execute({
        callId: 'pathway-mixed-batch',
        name: 'kegg_pathway',
        arguments: { ids: ['map00010', 'nope'] },
        signal: new AbortController().signal,
      }),
    )
    expect(result.isError).toBe(false)
    expect(result.content).toContain('name: Glycolysis / Gluconeogenesis')
    expect(result.content).toContain('Error: Invalid KEGG pathway id "nope"')
  } finally {
    await ctx.fiber.dispose()
  }
})

it('returns compound identity fields, official links and an explicit PubChem SID label', async () => {
  stub({
    'get/C00162': [
      field('ENTRY', 'C00162                      Compound'),
      field('NAME', 'Fatty acid'),
      field('FORMULA', 'CHO2R'),
      field('EXACT_MASS', '45.0'),
      field('MOL_WEIGHT', '45.02'),
      field('PATHWAY', 'map00062  Fatty acid elongation'),
      continuation('map00071  Fatty acid degradation'),
      field('DBLINKS', 'PubChem: 3462'),
      continuation('ChEBI: 35366'),
      '///',
    ].join('\n'),
  })
  const ctx = await makeContext()
  try {
    const result = await complete(
      ctx.tools.execute({
        callId: 'compound-detail',
        name: 'kegg_compound',
        arguments: { id: 'cpd:C00162' },
        signal: new AbortController().signal,
      }),
    )
    expect(result.isError).toBe(false)
    expect(result.content).toContain('https://www.kegg.jp/entry/C00162')
    expect(result.content).toContain('formula: CHO2R')
    expect(result.content).toContain('exact_mass: 45')
    expect(result.content).toContain('mol_weight: 45.02')
    expect(result.content).toContain('https://www.kegg.jp/pathway/map00062')
    expect(result.content).toContain('https://www.kegg.jp/pathway/map00071')
    expect(result.content).toContain('PubChem SID: 3462')
    expect(result.content).not.toContain('PubChem: 3462')
    expect(result.content).toContain('ChEBI: 35366')
  } finally {
    await ctx.fiber.dispose()
  }
})

it.each([11, 25])('chunks %i compound ids into get requests of at most ten', async (count) => {
  const ids = compoundIds(count)
  const routes: Record<string, string> = {}
  for (let index = 0; index < ids.length; index += 10) {
    const chunk = ids.slice(index, index + 10)
    routes[`get/${chunk.join('+')}`] = chunk.map((id) => compoundEntry(id)).join('')
  }
  const fetcher = stub(routes)
  const entries = await complete(new KeggClient().getEntries(ids))
  expect(entries.map((entry) => entry.id)).toEqual(ids)
  expect(fetcher).toHaveBeenCalledTimes(Math.ceil(count / 10))
  expect(fetcher.mock.calls.every(([url]) => url.split('get/')[1]!.split('+').length <= 10)).toBe(
    true,
  )
})

it('treats an all-unknown 10-id chunk 404 as absent entries instead of failing the whole call', async () => {
  // Live-verified against rest.kegg.jp (2026-11-10): get/<unknown> alone → 404;
  // mixed valid+unknown → 200 with only the valid entries. A 404 chunk must
  // degrade to per-id "not returned" messages, never reject the batch.
  const ids = compoundIds(11)
  const routes: Record<string, string | Response> = {}
  for (let index = 0; index < ids.length - 1; index += 10) {
    const chunk = ids.slice(index, index + 10)
    routes[`get/${chunk.join('+')}`] = chunk.map((id) => compoundEntry(id)).join('')
  }
  routes[`get/${ids[10]}`] = new Response('not found', { status: 404 })
  stub(routes)
  const ctx = await makeContext()
  try {
    const result = await complete(
      ctx.tools.execute({
        callId: 'compound-unknown-tail',
        name: 'kegg_compound',
        arguments: { ids },
        signal: new AbortController().signal,
      }),
    )
    expect(result.isError).toBe(false)
    expect(result.content).toContain(`names: Compound ${ids[9]}`)
    expect(result.content).toContain(
      `No KEGG compound entry was returned for ${ids[10]}; the request succeeded but this id was absent.`,
    )
  } finally {
    await ctx.fiber.dispose()
  }
})

it.each([
  new Response('<!doctype html><html></html>', { headers: { 'content-type': 'text/html' } }),
  new Response('not atext'),
  new Response('unavailable', { status: 503 }),
])(
  'reports compound get failures instead of treating them as missing compounds',
  async (response) => {
    stub({ 'get/C00001': response })
    await expect(complete(new KeggClient().getEntries(['C00001']))).rejects.toThrow(/KEGG|a-text/)
  },
)

it('one failing request no longer cancels its sibling requests in the same invocation', async () => {
  // The old client aborted the whole invocation on the first upstream error;
  // with 50 funnelled queries one 429/503 would kill the other 49 (R2-5).
  // Now only the failing request rejects; siblings complete normally.
  const fetcher = stub({
    'find/compound/bad': new Response('rate limited', { status: 429 }),
    'find/compound/good': 'C00031\tD-Glucose\n',
  })
  const client = new KeggClient()
  const bad = client.findCompounds('bad')
  const good = client.findCompounds('good')
  await expect(
    complete(
      bad.then(
        () => undefined,
        (error: Error) => Promise.reject(error),
      ),
    ),
  ).rejects.toThrow('HTTP 429')
  await expect(complete(good)).resolves.toEqual([{ id: 'C00031', names: ['D-Glucose'] }])
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('validates compound ids and documents identity verification', async () => {
  const ctx = await makeContext()
  try {
    const tool = ctx.tools.list().find((item) => item.name === 'kegg_compound')!
    expect(tool.description).toContain('identity checking')
    expect(tool.description).toContain('SIDs, not CIDs')
    for (const [callId, arguments_, expected] of [
      ['missing-id', {}, 'Provide "id" or "ids"'],
      ['invalid-id', { id: 'map00010' }, 'Invalid KEGG compound id'],
    ] as const) {
      const result = await complete(
        ctx.tools.execute({
          callId,
          name: 'kegg_compound',
          arguments: arguments_,
          signal: new AbortController().signal,
        }),
      )
      expect(result.isError).toBe(true)
      expect(result.content).toContain(expected)
    }
  } finally {
    await ctx.fiber.dispose()
  }
})

it('returns pathway details and rank 10-20 after retrieving the complete member list', async () => {
  const members = compoundIds(25)
  const selected = members.slice(9, 20)
  const routes: Record<string, string> = {
    'get/map00010': pathwayEntry('map00010', 'Glycolysis / Gluconeogenesis'),
    'link/compound/map00010': pathwayCompoundLinks('map00010', members),
  }
  for (let index = 0; index < selected.length; index += 10) {
    const chunk = selected.slice(index, index + 10)
    routes[`list/${chunk.join('+')}`] = chunk
      .map((id) => `${id}\tMember ${id}; Synonym ${id}`)
      .join('\n')
  }
  const fetcher = stub(routes)
  const ctx = await makeContext()
  try {
    const result = await complete(
      ctx.tools.execute({
        callId: 'pathway-window',
        name: 'kegg_pathway',
        arguments: { id: 'path:map00010', offset: 9, limit: 11 },
        signal: new AbortController().signal,
      }),
    )
    expect(result.isError).toBe(false)
    expect(result.content).toContain('name: Glycolysis / Gluconeogenesis')
    expect(result.content).toContain('class: Global and overview maps')
    expect(result.content).toContain('description: Description of Glycolysis / Gluconeogenesis')
    expect(result.content).toContain('https://www.kegg.jp/pathway/map00010')
    expect(result.content).toContain(
      'window: {"total":25,"offset":9,"limit":11,"returned":11,"nextOffset":20}',
    )
    expect(result.content).toContain('[Member C00010](https://www.kegg.jp/entry/C00010)')
    expect(result.content).toContain('[Member C00020](https://www.kegg.jp/entry/C00020)')
    expect(result.content).not.toContain('Member C00009')
    expect(result.content).not.toContain('Member C00021')
    const listRequests = fetcher.mock.calls.filter(([url]) => url.includes('/list/'))
    expect(listRequests).toHaveLength(2)
    expect(listRequests.every(([url]) => !/C0000[1-9](?:\D|$)/.test(url))).toBe(true)
    expect(listRequests.every(([url]) => !/C0002[1-5](?:\D|$)/.test(url))).toBe(true)
  } finally {
    await ctx.fiber.dispose()
  }
})

it('applies member windows independently to multiple pathways', async () => {
  stub({
    'get/map00010+map00020': `${pathwayEntry('map00010')}\n${pathwayEntry('map00020')}`,
    'link/compound/map00010': pathwayCompoundLinks('map00010', compoundIds(3)),
    'link/compound/map00020': pathwayCompoundLinks('map00020', compoundIds(6).slice(3)),
    'list/C00002': 'C00002\tMember C00002',
    'list/C00005': 'C00005\tMember C00005',
  })
  const ctx = await makeContext()
  try {
    const result = await complete(
      ctx.tools.execute({
        callId: 'pathway-batch',
        name: 'kegg_pathway',
        arguments: { ids: ['map00010', 'map00020'], offset: 1, limit: 1 },
        signal: new AbortController().signal,
      }),
    )
    expect(result.isError).toBe(false)
    expect(result.content).toContain('### map00010')
    expect(result.content).toContain('### map00020')
    expect(
      result.content.match(/"total":3,"offset":1,"limit":1,"returned":1,"nextOffset":2/g),
    ).toHaveLength(2)
    expect(result.content).toContain('Member C00002')
    expect(result.content).toContain('Member C00005')
    expect(result.content).not.toContain('Member C00001')
    expect(result.content).not.toContain('Member C00004')
  } finally {
    await ctx.fiber.dispose()
  }
})

it('distinguishes an empty member list from an out-of-range member window', async () => {
  stub({
    'get/map00010': pathwayEntry('map00010'),
    'link/compound/map00010': pathwayCompoundLinks('map00010', compoundIds(2)),
    'get/map00020': pathwayEntry('map00020'),
    'link/compound/map00020': '',
  })
  const ctx = await makeContext()
  try {
    const beyond = await complete(
      ctx.tools.execute({
        callId: 'pathway-beyond',
        name: 'kegg_pathway',
        arguments: { id: 'map00010', offset: 5, limit: 10 },
        signal: new AbortController().signal,
      }),
    )
    expect(beyond.content).toContain(
      'window: {"total":2,"offset":5,"limit":10,"returned":0,"nextOffset":null}',
    )
    expect(beyond.content).toContain('No compounds in this window')
    const empty = await complete(
      ctx.tools.execute({
        callId: 'pathway-empty',
        name: 'kegg_pathway',
        arguments: { id: 'map00020' },
        signal: new AbortController().signal,
      }),
    )
    expect(empty.content).toContain('"total":0')
    expect(empty.content).toContain('No member compounds returned by KEGG')
  } finally {
    await ctx.fiber.dispose()
  }
})

it('reports a successfully requested pathway whose entry was absent', async () => {
  stub({ 'get/map99999': '' })
  const ctx = await makeContext()
  try {
    const result = await complete(
      ctx.tools.execute({
        callId: 'pathway-absent',
        name: 'kegg_pathway',
        arguments: { id: 'map99999' },
        signal: new AbortController().signal,
      }),
    )
    expect(result.isError).toBe(false)
    expect(result.content).toContain('No KEGG pathway entry was returned for map99999')
  } finally {
    await ctx.fiber.dispose()
  }
})

it('suggests the map form when an organism-specific pathway code is rejected', async () => {
  const ctx = await makeContext()
  try {
    const result = await complete(
      ctx.tools.execute({
        callId: 'pathway-organism',
        name: 'kegg_pathway',
        arguments: { id: 'hsa00010' },
        signal: new AbortController().signal,
      }),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('organism-specific codes like hsa00010 are not accepted')
    expect(result.content).toContain('map00010')
  } finally {
    await ctx.fiber.dispose()
  }
})

it('hints at the map form when find/pathway drops an organism-code query', async () => {
  // findPathways short-circuits organism codes to list/<id>, which returns
  // rn-style rows; the map-only filter drops them and the hint must fire.
  stub({ 'list/rn00970': 'rn00970\tSteroid degradation\n' })
  const out = await complete(keggFind('rn00970', 'pathway', 0, 10))
  expect(out).toContain('organism- or reference-specific pathway code')
  expect(out).toContain('map00010')
  expect(out).not.toContain('database search miss')
})

it('prefetches member lists in parallel inside one shared client for pathway batches', async () => {
  // R2-3: members must be fetched via one invocation-shared client (dedup +
  // rate funnel) rather than per-item serial round trips.
  const routes: Record<string, string> = {
    'get/map00010+map00020': `${pathwayEntry('map00010')}\n${pathwayEntry('map00020')}`,
    'link/compound/map00010': pathwayCompoundLinks('map00010', compoundIds(3)),
    'link/compound/map00020': pathwayCompoundLinks('map00020', compoundIds(6).slice(3)),
    'list/C00001+C00002': 'C00001\tMember C00001\nC00002\tMember C00002\n',
    'list/C00004+C00005': 'C00004\tMember C00004\nC00005\tMember C00005\n',
  }
  const fetcher = stub(routes)
  const ctx = await makeContext()
  try {
    const result = await complete(
      ctx.tools.execute({
        callId: 'pathway-prefetch',
        name: 'kegg_pathway',
        arguments: { ids: ['map00010', 'map00020'], offset: 0, limit: 2 },
        signal: new AbortController().signal,
      }),
    )
    expect(result.isError).toBe(false)
    expect(result.content).toContain('Member C00001')
    expect(result.content).toContain('Member C00004')
    // one get (10-chunk) + two link requests + two list requests for names
    const paths = fetcher.mock.calls.map(([url]) => url.slice('/kegg-rest/'.length))
    expect(paths.filter((path) => path.startsWith('link/'))).toHaveLength(2)
  } finally {
    await ctx.fiber.dispose()
  }
})

it('validates pathway ids and documents full-result window semantics', async () => {
  const ctx = await makeContext()
  try {
    const tool = ctx.tools.list().find((item) => item.name === 'kegg_pathway')!
    expect(tool.description).toContain('per-pathway window')
    expect(tool.description).toContain('offset 9 + limit 11')
    for (const [callId, arguments_, expected] of [
      ['missing-pathway', {}, 'Provide "id" or "ids"'],
      ['invalid-pathway', { id: 'C00031' }, 'Invalid KEGG pathway id'],
    ] as const) {
      const result = await complete(
        ctx.tools.execute({
          callId,
          name: 'kegg_pathway',
          arguments: arguments_,
          signal: new AbortController().signal,
        }),
      )
      expect(result.isError).toBe(true)
      expect(result.content).toContain(expected)
    }
  } finally {
    await ctx.fiber.dispose()
  }
})

it('uses six-decimal exact-mass ranges and parses KEGG id/name candidates', async () => {
  const fetcher = stub({
    'find/compound/75.030000-75.040000/exact_mass': 'C00037\tGlycine\nC01837\tGlycine derivative',
  })
  const result = await complete(new KeggClient().findExactMass(75.03, 75.04))
  expect(result).toEqual([
    ['C00037', 'Glycine'],
    ['C01837', 'Glycine derivative'],
  ])
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('merges adducts, recalculates delta ppm from get entries, sorts and then slices', async () => {
  const mz = 200
  const ppm = 10
  const h = mz - ADDUCTS.positive['[M+H]+']!
  const na = mz - ADDUCTS.positive['[M+Na]+']!
  const k = mz - ADDUCTS.positive['[M+K]+']!
  stub({
    ...massFindRoutes(mz, 'positive', ppm, {
      '[M+H]+': [['C00001', 'Five ppm']],
      '[M+Na]+': [['C00002', 'Closest']],
      '[M+K]+': [['C00003', 'Second']],
    }),
    'get/C00001+C00002+C00003': [
      exactMassEntry('C00001', 'Five ppm', h + 0.001),
      exactMassEntry('C00002', 'Closest', na + 0.00002),
      exactMassEntry('C00003', 'Second', k - 0.0004),
    ].join('\n'),
  })
  const result = resultJson(await complete(keggMassSearch(mz, 'positive', ppm, 0, 2)))
  expect(result.window).toEqual({ total: 3, offset: 0, limit: 2, returned: 2, nextOffset: 2 })
  expect(result.matches.map((match: { id: string }) => match.id)).toEqual(['C00002', 'C00003'])
  expect(result.matches[0].deltaPpm).toBeCloseTo(0.1, 6)
  expect(result.matches[1].deltaPpm).toBeCloseTo(-2, 6)
  expect(result.matches.map((match: { adduct: string }) => match.adduct)).toEqual([
    '[M+Na]+',
    '[M+K]+',
  ])
})

it('chunks candidate detail requests at ten ids without capping total matches', async () => {
  const mz = 100
  const ppm = 10
  const neutral = mz - ADDUCTS.positive['[M+H]+']!
  const ids = compoundIds(11)
  const routes: Record<string, string> = massFindRoutes(mz, 'positive', ppm, {
    '[M+H]+': ids.map((id) => [id, `Candidate ${id}`] as [string, string]),
  })
  for (let index = 0; index < ids.length; index += 10) {
    const chunk = ids.slice(index, index + 10)
    routes[`get/${chunk.join('+')}`] = chunk
      .map((id) => exactMassEntry(id, `Mass ${id}`, neutral))
      .join('\n')
  }
  const fetcher = stub(routes)
  const result = resultJson(await complete(keggMassSearch(mz, 'positive', ppm, 0, 25)))
  expect(result.window).toMatchObject({ total: 11, returned: 11, nextOffset: null })
  expect(result.matches).toHaveLength(11)
  expect(fetcher.mock.calls.filter(([url]) => url.includes('/get/'))).toHaveLength(2)
})

it('uses dataset polarity and keeps batch m/z windows independent with empty results', async () => {
  polarityRef.value = 'negative'
  stub({ ...massFindRoutes(100, 'negative', 10), ...massFindRoutes(200, 'negative', 10) })
  const ctx = await makeContext()
  try {
    const result = await complete(
      ctx.tools.execute({
        callId: 'mass-batch',
        name: 'kegg_mass_search',
        arguments: { mzs: [100, 200] },
        signal: new AbortController().signal,
      }),
    )
    expect(result.isError).toBe(false)
    expect(result.content).toContain('### m/z 100')
    expect(result.content).toContain('### m/z 200')
    expect(result.content.match(/"polarity": "negative"/g)).toHaveLength(2)
    expect(result.content.match(/"total": 0/g)).toHaveLength(2)
    expect(result.content.match(/"matches": \[\]/g)).toHaveLength(2)
  } finally {
    await ctx.fiber.dispose()
  }
})

it('caps ppm at 50 before constructing exact-mass ranges', async () => {
  const fetcher = stub(massFindRoutes(100, 'positive', 50))
  const ctx = await makeContext()
  try {
    const result = await complete(
      ctx.tools.execute({
        callId: 'mass-ppm-cap',
        name: 'kegg_mass_search',
        arguments: { mz: 100, polarity: 'positive', ppm: 100 },
        signal: new AbortController().signal,
      }),
    )
    expect(result.isError).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(Object.keys(ADDUCTS.positive).length)
  } finally {
    await ctx.fiber.dispose()
  }
})

it('validates mass-search inputs and documents KEGG small-molecule coverage', async () => {
  polarityRef.value = ''
  const ctx = await makeContext()
  try {
    const tool = ctx.tools.list().find((item) => item.name === 'kegg_mass_search')!
    expect(tool.description).toContain('roughly 19,000')
    expect(tool.description).toContain('excludes lipids')
    for (const [callId, arguments_, expected] of [
      ['missing-mz', { polarity: 'positive' }, 'Provide "mz" or "mzs"'],
      ['invalid-mz', { mz: -1, polarity: 'positive' }, 'Provide a positive m/z'],
      ['missing-polarity', { mz: 100 }, 'Unknown ion polarity'],
    ] as const) {
      const result = await complete(
        ctx.tools.execute({
          callId,
          name: 'kegg_mass_search',
          arguments: arguments_,
          signal: new AbortController().signal,
        }),
      )
      expect(result.isError).toBe(true)
      expect(result.content).toContain(expected)
    }
  } finally {
    await ctx.fiber.dispose()
  }
})

it('covers the annotation panel adducts in KEGG mass searches', () => {
  // 数值来自共享加合物表（shared/chem/adducts.ts）；面板规则表的每个键都必须可检索（防未来漂移）
  expect(ADDUCTS.positive['[M+Li]+']).toBeCloseTo(7.015455, 5)
  expect(ADDUCTS.negative['[M-2H+Na]-']).toBeCloseTo(20.974666, 5)
  expect(ADDUCTS.negative['[M-2H+K]-']).toBeCloseTo(36.948606, 5)
  for (const key of ['M+H', 'M+Na', 'M+K', 'M+NH4', 'M+Li']) {
    expect(ADDUCTS.positive[`[${key}]+`]).toBeDefined()
  }
  for (const key of ['M-H', 'M+Cl', 'M+HCOO', 'M+CH3COO', 'M-2H+Na', 'M-2H+K']) {
    expect(ADDUCTS.negative[`[${key}]-`]).toBeDefined()
  }
})

it('validates missing queries and documents that keyword hits need verification', async () => {
  const ctx = await makeContext()
  try {
    const tool = ctx.tools.list().find((item) => item.name === 'kegg_find')!
    expect(tool.description).toContain('Keyword hits are search candidates, not identity')
    expect(tool.description).toContain('AND semantics')
    const result = await complete(
      ctx.tools.execute({
        callId: 'missing-query',
        name: 'kegg_find',
        arguments: {},
        signal: new AbortController().signal,
      }),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Provide "query" or "queries"')
  } finally {
    await ctx.fiber.dispose()
  }
})

// ---- Mechanism tests (migrated from tool-bio/__tests__/kegg.test.ts, R2-10) ----

it('shares rate limits across clients and deduplicates only within each invocation', async () => {
  const fetcher = stub({ 'list/C00031': 'C00031\tD-Glucose; Glucose\n' })
  const starts: number[] = []
  const original = fetcher.getMockImplementation()!
  fetcher.mockImplementation(async (...args) => {
    starts.push(Date.now())
    return original(...(args as Parameters<typeof original>))
  })
  const first = new KeggClient()
  await complete(
    Promise.all([
      first.findCompounds('C00031'),
      first.findCompounds('C00031'), // same invocation → deduped onto the in-flight request
      new KeggClient().findCompounds('C00031'), // separate invocation → its own request
    ]),
  )
  expect(fetcher).toHaveBeenCalledTimes(2)
  // The shared 350ms limiter spans instances: KEGG allows at most 3 req/s.
  expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(350)
})

it('cancels queued work without making an upstream request', async () => {
  const fetcher = stub({ 'list/C00031': 'C00031\tD-Glucose; Glucose\n' })
  const controller = new AbortController()
  const reason = new Error('cancelled by user')
  const client = new KeggClient(controller.signal)
  const first = client.findCompounds('C00031')
  const second = client.findCompounds('map00010')
  // Attach handlers immediately: aborting synchronously after the calls can
  // race the promise chain and surface as an unhandled rejection otherwise.
  void first.catch(() => {})
  void second.catch(() => {})
  controller.abort(reason)
  await expect(complete(first)).rejects.toBe(reason)
  await expect(complete(second)).rejects.toBe(reason)
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

it('reports a 429 from the shared proxy bucket as a query failure, not an empty miss', async () => {
  stub({ 'find/compound/glucose': new Response('rate limited', { status: 429 }) })
  await expect(complete(keggFind('glucose', 'compound', 0, 10))).rejects.toThrow('HTTP 429')
})

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, keggFind, keggMassSearch } from '../index'
import { KeggClient, parseAtext } from '../kegg'
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

async function callTool(name: string, args: Record<string, unknown>) {
  const ctx = await makeContext()
  try {
    return await complete(
      ctx.tools.execute({
        callId: name,
        name,
        arguments: args,
        signal: new AbortController().signal,
      }),
    )
  } finally {
    await ctx.fiber.dispose()
  }
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

it('uses one AND search for a multi-word query through the registered tool', async () => {
  const fetcher = stub({ 'find/compound/glucose%20phosphate': 'C00092\tGlucose 6-phosphate\n' })
  const result = await callTool('kegg_find', { query: 'glucose phosphate' })
  expect(result.isError).toBe(false)
  expect(resultJson(result.content).entries).toEqual([
    { id: 'C00092', name: 'Glucose 6-phosphate' },
  ])
  expect(fetcher).toHaveBeenCalledTimes(1)
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

it('reads the other entries in a response containing a malformed record', () => {
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
  stub({ 'find/compound/101.006276-101.008276/exact_mass': '' })
  const out = await complete(keggMassSearch(100, '[M-H]-', 10, 0, 10))
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

it.each(['kegg_compound', 'kegg_pathway'])(
  'gets ten distinct entries in one request for %s',
  async (name) => {
    const pathway = name === 'kegg_pathway'
    const ids = compoundIds(10).map((id) => (pathway ? id.replace('C', 'map') : id))
    const fetcher = stub({
      [`get/${ids.join('+')}`]: ids
        .map((id) => (pathway ? pathwayEntry(id) : compoundEntry(id)))
        .join('\n'),
    })
    const result = await callTool(name, { ids })
    expect(result.isError).toBe(false)
    for (const id of ids) expect(result.content).toContain(`### ${id}`)
    expect(fetcher).toHaveBeenCalledTimes(1)
  },
)

it.each(['kegg_compound', 'kegg_pathway'])(
  'rejects eleven submitted ids before deduplication or I/O for %s',
  async (name) => {
    const fetcher = stub({})
    const ids = Array<string>(11).fill(name === 'kegg_compound' ? 'C00031' : 'map00010')
    const result = await callTool(name, { ids })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('at most 10')
    expect(fetcher).not.toHaveBeenCalled()
  },
)

it('enforces the native get and list limits in the client', async () => {
  const fetcher = stub({})
  const client = new KeggClient()
  await expect(client.getEntries(compoundIds(11))).rejects.toThrow('1–10')
  await expect(client.list(Array<string>(11).fill('C00031'))).rejects.toThrow('1–10')
  expect(fetcher).not.toHaveBeenCalled()
})

it('reports partial records and all-unknown get responses per id', async () => {
  const fetcher = stub({
    'get/C00031+C99999': compoundEntry('C00031', 'D-Glucose'),
    'get/C99998+C99999': new Response('not found', { status: 404 }),
  })
  const mixed = await callTool('kegg_compound', { ids: ['cpd:c00031', 'C00031', 'C99999'] })
  expect(mixed.isError).toBe(false)
  expect(mixed.content).toContain('names: D-Glucose')
  expect(mixed.content).toContain('No KEGG compound entry was returned for C99999')
  const missing = await callTool('kegg_compound', { ids: ['C99998', 'C99999'] })
  expect(missing.isError).toBe(false)
  expect(missing.content).toContain('No KEGG compound entry was returned for C99998')
  expect(missing.content).toContain('No KEGG compound entry was returned for C99999')
  expect(fetcher).toHaveBeenCalledTimes(2)
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

it('allows independent requests to continue after an upstream error', async () => {
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
    expect(tool.description).toContain('PubChem cross-references are SIDs')
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

it('returns pathway details with a single get request', async () => {
  const fetcher = stub({ 'get/map00010': pathwayEntry('map00010', 'Glycolysis / Gluconeogenesis') })
  const result = await callTool('kegg_pathway', { id: 'path:map00010' })
  expect(result.isError).toBe(false)
  expect(result.content).toContain('name: Glycolysis / Gluconeogenesis')
  expect(result.content).toContain('class: Global and overview maps')
  expect(result.content).toContain('description: Description of Glycolysis / Gluconeogenesis')
  expect(result.content).toContain('https://www.kegg.jp/pathway/map00010')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('groups one combined link response by pathway and pages member ids without looking up names', async () => {
  const firstMembers = compoundIds(25)
  const secondMembers = ['C00031', 'C00010', 'C00032']
  const fetcher = stub({
    'link/compound/map00010+map00020': [
      pathwayCompoundLinks('map00020', secondMembers),
      pathwayCompoundLinks('map00010', [...firstMembers, firstMembers[0]!]),
    ].join('\n'),
  })
  const result = await callTool('kegg_pathway', {
    membersOf: ['path:map00010', 'map00020'],
    offset: 1,
    limit: 11,
  })
  expect(result.isError).toBe(false)
  const [first, second] = result.content.split('### map00020')
  expect(first).toContain('### map00010')
  expect(first).toContain(
    'window: {"total":25,"offset":1,"limit":11,"returned":11,"nextOffset":12}',
  )
  expect(first).toContain('[C00012](https://www.kegg.jp/entry/C00012)')
  expect(first).not.toContain('C00031')
  expect(second).toContain(
    'window: {"total":3,"offset":1,"limit":11,"returned":2,"nextOffset":null}',
  )
  expect(second).toContain('[C00010](https://www.kegg.jp/entry/C00010)')
  expect(second).toContain('[C00032](https://www.kegg.jp/entry/C00032)')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('accepts more than ten path ids in a single link query and distinguishes empty windows from empty groups', async () => {
  const maps = compoundIds(11).map((id) => id.replace('C', 'map'))
  const fetcher = stub({
    [`link/compound/${maps.join('+')}`]: pathwayCompoundLinks(maps[0]!, ['C00031']),
  })
  const result = await callTool('kegg_pathway', { membersOf: maps, offset: 1 })
  expect(result.isError).toBe(false)
  expect(result.content).toContain('No compounds in this window')
  expect(result.content).toContain('No member compounds returned by KEGG')
  expect(result.content).toContain('### map00011')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it.each<[string, Record<string, unknown>]>([
  ['kegg_pathway', { id: 'map00010', membersOf: ['map00010'] }],
  ['kegg_pathway', { membersOf: [] }],
  ['kegg_pathway', { membersOf: ['hsa00010'] }],
  ['kegg_compound', { id: 'C00031', ids: ['C00031'] }],
  ['kegg_compound', { ids: [] }],
])('rejects conflicting or invalid selectors for %s before dispatch', async (name, args) => {
  const fetcher = stub({})
  const result = await callTool(name, args)
  expect(result.isError).toBe(true)
  expect(fetcher).not.toHaveBeenCalled()
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
    expect(result.content).toContain('organism-specific codes like hsa00010')
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

it('reads numeric exact masses from the KEGG range response', async () => {
  const fetcher = stub({
    'find/compound/174.045000-174.055000/exact_mass': 'C00493\t174.052823\nC04236\t174.052823',
  })
  expect(await complete(new KeggClient().findExactMass(174.045, 174.055))).toEqual([
    { id: 'C00493', exactMass: 174.052823 },
    { id: 'C04236', exactMass: 174.052823 },
  ])
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('ranks signed ppm errors for one adduct before paging, using one request for more than ten hits', async () => {
  const more = compoundIds(9).map((id) => id + '\t198.993724')
  const fetcher = stub({
    'find/compound/198.990724-198.994724/exact_mass': [
      ...more,
      'C00010\t198.992324',
      'C00011\t198.992744',
      'C00012\t199.000000',
    ].join('\n'),
  })
  const result = await callTool('kegg_mass_search', {
    mz: 200,
    adduct: '[M+H]+',
    ppm: 10,
    limit: 2,
  })
  expect(result.isError).toBe(false)
  const page = resultJson(result.content)
  expect(page).toMatchObject({
    queryMz: 200,
    adduct: '[M+H]+',
    polarity: 'positive',
    window: { total: 11, returned: 2, nextOffset: 2 },
  })
  expect(page.matches.map((hit: { id: string }) => hit.id)).toEqual(['C00011', 'C00010'])
  expect(page.matches[0].exactMass).toBe(198.992744)
  expect(page.matches[0].deltaPpm).toBeCloseTo(0.1, 2)
  expect(page.matches[1].deltaPpm).toBeCloseTo(-2, 2)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('uses the selected negative adduct and applies the local ppm cap to its range', async () => {
  const fetcher = stub({ 'find/compound/101.002276-101.012276/exact_mass': 'C00001\t101.007276' })
  const result = await callTool('kegg_mass_search', { mz: 100, adduct: '[M-H]-', ppm: 100 })
  expect(result.isError).toBe(false)
  expect(resultJson(result.content)).toMatchObject({
    polarity: 'negative',
    ppm: 50,
    matches: [{ id: 'C00001', adduct: '[M-H]-' }],
  })
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('treats an invalid exact-mass response as an upstream failure', async () => {
  stub({ 'find/compound/101.006276-101.008276/exact_mass': 'C00001\tnot a mass' })
  const result = await callTool('kegg_mass_search', { mz: 100, adduct: '[M-H]-' })
  expect(result.isError).toBe(true)
  expect(result.content).toContain('Invalid KEGG exact_mass response')
})

it.each<[string, Record<string, unknown>]>([
  ['kegg_find', {}],
  ['kegg_find', { query: '  ' }],
  ['kegg_mass_search', { mz: 100 }],
  ['kegg_mass_search', { mz: 100, adduct: 'unknown' }],
  ['kegg_mass_search', { mz: -1, adduct: '[M-H]-' }],
  ['kegg_mass_search', { mz: 1, adduct: '[M+Na]+' }],
])('validates %s inputs before I/O', async (name, args) => {
  const fetcher = stub({})
  const result = await callTool(name, args)
  expect(result.isError).toBe(true)
  expect(fetcher).not.toHaveBeenCalled()
})

it('shares the start-time limit across independent clients', async () => {
  const fetcher = stub({ 'list/C00031': 'C00031\tD-Glucose; Glucose\n' })
  const starts: number[] = []
  const original = fetcher.getMockImplementation()!
  fetcher.mockImplementation(async (...args) => {
    starts.push(Date.now())
    return original(...(args as Parameters<typeof original>))
  })
  await complete(
    Promise.all([
      new KeggClient().findCompounds('C00031'),
      new KeggClient().findCompounds('C00031'),
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

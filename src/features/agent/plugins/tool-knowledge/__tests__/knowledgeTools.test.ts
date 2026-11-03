import { afterEach, describe, expect, it, vi } from 'vitest'
import { pubchemLookupCompound, pubchemSearchFormula } from '../index'

/** fetch mock：按 URL 前缀/包含串路由到固定响应 */
function mockFetch(
  routes: { match: string | RegExp; ok?: boolean; status?: number; body: unknown }[],
) {
  const impl = vi.fn(async (url: string) => {
    const route = routes.find((r) =>
      typeof r.match === 'string' ? url.includes(r.match) : r.match.test(url),
    )
    if (!route) throw new Error(`unexpected fetch: ${url}`)
    if (route.ok === false) {
      return new Response(typeof route.body === 'string' ? route.body : '', {
        status: route.status ?? 500,
      })
    }
    return new Response(JSON.stringify(route.body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pubchemLookupCompound', () => {
  it('formats properties + synonyms + source link', async () => {
    const fetchMock = mockFetch([
      {
        match: '/property/',
        body: {
          PropertyTable: {
            Properties: [
              {
                CID: 5863,
                MolecularFormula: 'C6H12O6',
                MonoisotopicMass: 180.063,
                AverageMass: 180.156,
                CanonicalSMILES: 'C(C1C(C(C(C(O1)O)O)O)O)O',
                InChIKey: 'WQZGKKKJIJFFOK-UHFFFAOYSA-N',
                IUPACName: '(2R,3S,4R,5R)-2,3,4,5,6-pentahydroxyhexanal',
              },
            ],
          },
        },
      },
      {
        match: '/synonyms/',
        body: {
          InformationList: { Information: [{ CID: 5863, Synonym: ['glucose', 'D-glucose', ''] }] },
        },
      },
    ])

    const out = await pubchemLookupCompound('glucose')

    expect(out).toContain('cid: 5863')
    expect(out).toContain('formula: C6H12O6')
    expect(out).toContain('monoisotopic_mass: 180.063')
    // 空同义词被过滤
    expect(out).toContain('synonyms: glucose; D-glucose')
    expect(out).toContain('https://pubchem.ncbi.nlm.nih.gov/compound/5863')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('survives synonyms endpoint failure (props still returned)', async () => {
    mockFetch([
      {
        match: '/property/',
        body: { PropertyTable: { Properties: [{ CID: 1, MolecularFormula: 'CH4' }] } },
      },
      { match: '/synonyms/', ok: false, status: 500, body: 'boom' },
    ])

    const out = await pubchemLookupCompound('methane')
    expect(out).toContain('cid: 1')
    expect(out).not.toContain('synonyms:')
  })

  it('throws readable error on 404 (unknown compound)', async () => {
    mockFetch([{ match: '/property/', ok: false, status: 404, body: '' }])
    await expect(pubchemLookupCompound('not-a-molecule-xyz')).rejects.toThrow(
      'Not found in database (HTTP 404)',
    )
  })
})

describe('pubchemSearchFormula', () => {
  it('lists candidates with total and truncation note', async () => {
    mockFetch([
      {
        match: '/fastformula/',
        body: {
          PropertyTable: {
            Properties: Array.from({ length: 20 }, (_, i) => ({
              CID: 1000 + i,
              MolecularFormula: 'C6H12O6',
              MonoisotopicMass: 180.063 + i,
              InChIKey: `KEY${i}`,
            })),
          },
        },
      },
    ])

    const out = await pubchemSearchFormula('C6H12O6', 15)

    expect(out).toContain('total_matches: 20')
    expect(out).toContain('- 1000 | C6H12O6 | 180.063 | KEY0')
    expect(out).toContain('(…and 5 more)')
  })

  it('throws when no compound matches the formula', async () => {
    mockFetch([{ match: '/fastformula/', body: { PropertyTable: { Properties: [] } } }])
    await expect(pubchemSearchFormula('Xx99', 15)).rejects.toThrow('No compound found')
  })
})

it('uses supported PubChem property names and reads current response keys', async () => {
  const fetcher = mockFetch([
    {
      match: '/property/',
      body: {
        PropertyTable: {
          Properties: [
            {
              CID: 5793,
              MolecularWeight: '180.16',
              ConnectivitySMILES: 'C(O)C',
              MonoisotopicMass: '180.063',
            },
          ],
        },
      },
    },
    {
      match: '/synonyms/',
      body: { InformationList: { Information: [{ Synonym: ['D-glucose'] }] } },
    },
  ])
  const signal = new AbortController().signal
  const result = await pubchemLookupCompound('glucose', signal)
  expect(result).toContain('average_mass: 180.16')
  expect(result).toContain('smiles: C(O)C')
  expect(fetcher.mock.calls[0]![0]).toContain('MolecularWeight,ConnectivitySMILES')
  expect(fetcher.mock.calls[1]![0]).toContain('/cid/5793/synonyms/')
})

it('propagates cancellation during optional PubChem synonyms rather than returning partial success', async () => {
  const controller = new AbortController()
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/property/'))
      return Response.json({ PropertyTable: { Properties: [{ CID: 1 }] } })
    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
    })
  })
  vi.stubGlobal('fetch', fetcher)
  const result = pubchemLookupCompound('methane', controller.signal)
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  const reason = new Error('user stopped lookup')
  controller.abort(reason)
  await expect(result).rejects.toBe(reason)
})

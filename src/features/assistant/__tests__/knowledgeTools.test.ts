import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  pubchemLookupCompound,
  pubchemSearchFormula,
  massSearchLipidIndex,
  normalizeLipidQuery,
  searchLipidIndex,
  ADDUCTS,
  type LipidRow,
} from '../tools/knowledgeTools'
import { pubmedSearch } from '../tools/literatureTools'

/** fetch mock：按 URL 前缀/包含串路由到固定响应 */
function mockFetch(routes: { match: string | RegExp; ok?: boolean; status?: number; body: unknown }[]) {
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

beforeEach(() => {
  // jsdom 的 Response 支持构造；不可用时跳过（环境兜底）
})

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
        body: { InformationList: { Information: [{ CID: 5863, Synonym: ['glucose', 'D-glucose', ''] }] } },
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

describe('pubmedSearch', () => {
  it('two-hop esearch → esummary and formats entries', async () => {
    const fetchMock = mockFetch([
      {
        match: 'esearch.fcgi',
        body: { esearchresult: { idlist: ['111', '222'], count: '2' } },
      },
      {
        match: 'esummary.fcgi',
        body: {
          result: {
            count: '2',
            uids: ['111', '222'],
            '111': {
              title: 'Lipid imaging in brain.',
              fulljournalname: 'J Mass Spectrom',
              pubdate: '2020 Mar',
            },
            '222': {
              title: 'MSI review.',
              source: 'Anal Chem',
              pubdate: '2021 Jan 15',
            },
          },
        },
      },
    ])

    const out = await pubmedSearch('lipid imaging', 5)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    // term 编码进 esearch URL
    expect(fetchMock.mock.calls[0]![0]).toContain('term=lipid%20imaging')
    expect(out).toContain('total_hits: 2')
    expect(out).toContain('- Lipid imaging in brain')
    expect(out).toContain('J Mass Spectrom 2020 | PMID 111 | https://pubmed.ncbi.nlm.nih.gov/111/')
    expect(out).toContain('Anal Chem 2021 | PMID 222')
  })

  it('returns a no-hits message for empty idlist', async () => {
    mockFetch([
      { match: 'esearch.fcgi', body: { esearchresult: { idlist: [], count: '0' } } },
    ])
    const out = await pubmedSearch('zzz nonexistent query', 5)
    expect(out).toContain('No PubMed results')
  })
})

describe('external fetch failure path', () => {
  it('network error becomes a readable CORS/network message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    await expect(pubchemLookupCompound('glucose')).rejects.toThrow('Cannot reach the external database')
  })

  it('non-JSON error body is truncated into the message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('x'.repeat(500), { status: 503 }),
      ),
    )
    await expect(pubmedSearch('q', 5)).rejects.toThrow('HTTP 503')
  })
})

// ---- LIPID MAPS 本地索引（纯函数，固定 fixture） ----

/** 与 build-lipid-index.mjs 输出同构，按精确质量升序 */
const FIXTURE: LipidRow[] = [
  ['LMFA01010001', 'FA 16:0', 'Palmitic acid', 'C16H32O2', 256.240231, 'Fatty Acyls [FA]', 'Fatty Acids and Conjugates [FA01]', 985],
  ['LMFA01010002', 'FA 18:0', 'Stearic acid', 'C18H36O2', 284.271531, 'Fatty Acyls [FA]', 'Fatty Acids and Conjugates [FA01]', 5281],
  ['LMGP01010576', 'PC 34:1', 'PC 16:0/18:1(11Z)', 'C42H82NO8P', 759.577806, 'Glycerophospholipids [GP]', 'Glycerophosphocholines [GP01]', 24778688],
]

describe('normalizeLipidQuery', () => {
  it('unifies shorthand separators and case', () => {
    expect(normalizeLipidQuery('PC(34:1)')).toBe('pc34:1')
    expect(normalizeLipidQuery('PC 34:1')).toBe('pc34:1')
    expect(normalizeLipidQuery('pc_34:1')).toBe('pc34:1')
    expect(normalizeLipidQuery('FA 16:0/18:1')).toBe('fa16:018:1')
    expect(normalizeLipidQuery('PC(16:0/18:1)')).toBe(normalizeLipidQuery('PC 16:0_18:1'))
  })
})

describe('searchLipidIndex', () => {
  it('matches shorthand across separator styles', () => {
    expect(searchLipidIndex(FIXTURE, 'pc(34:1)', 10).map((r) => r[0])).toEqual(['LMGP01010576'])
    expect(searchLipidIndex(FIXTURE, 'palmitic', 10).map((r) => r[0])).toEqual(['LMFA01010001'])
  })

  it('matches LM_ID fragments case-insensitively', () => {
    expect(searchLipidIndex(FIXTURE, 'lmgp0101', 10).map((r) => r[0])).toEqual(['LMGP01010576'])
  })

  it('respects the max cap', () => {
    expect(searchLipidIndex(FIXTURE, 'FA', 1)).toHaveLength(1)
  })
})

describe('massSearchLipidIndex', () => {
  it('finds [M-H]- of palmitic acid with near-zero ppm', () => {
    const mz = 256.240231 - 1.007276 // [M-H]-
    const hits = massSearchLipidIndex(FIXTURE, mz, 'negative', null, 5, 10)
    expect(hits).toHaveLength(1)
    expect(hits[0]![8]).toBe('[M-H]-')
    expect(Math.abs(hits[0]![9])).toBeLessThan(0.01)
  })

  it('ADDUCTS covers the common adducts the annotation panel uses', () => {
    // 检索表缺项时，模型会对着面板里检出的加合离子报「无候选」；[M+Li]+ 显式请求还会
    // 直接抛 Unknown adduct。数值来自共享加合物表（shared/chem/adducts.ts）
    expect(ADDUCTS.positive['[M+Li]+']).toBeCloseTo(7.015455, 5)
    expect(ADDUCTS.negative['[M-2H+Na]-']).toBeCloseTo(20.974666, 5)
    expect(ADDUCTS.negative['[M-2H+K]-']).toBeCloseTo(36.948606, 5)
    // 面板规则表的每个键都必须在对应极性可检索（防未来再漂移）
    for (const key of ['M+H', 'M+Na', 'M+K', 'M+NH4', 'M+Li']) {
      expect(ADDUCTS.positive[`[${key}]+`]).toBeDefined()
    }
    for (const key of ['M-H', 'M+Cl', 'M+HCOO', 'M+CH3COO', 'M-2H+Na', 'M-2H+K']) {
      expect(ADDUCTS.negative[`[${key}]-`]).toBeDefined()
    }
  })

  it('scans the supplemented [M+Li]+ adduct and finds the molecule', () => {
    const mz = 256.240231 + 7.015455 // 棕榈酸 [M+Li]+
    const hits = massSearchLipidIndex(FIXTURE, mz, 'positive', null, 5, 10)
    expect(hits.map((h) => h[0])).toContain('LMFA01010001')
    expect(hits.find((h) => h[0] === 'LMFA01010001')![8]).toBe('[M+Li]+')
  })

  it('finds [M+H]+ of PC 34:1', () => {
    const mz = 759.577806 + 1.007276
    const hits = massSearchLipidIndex(FIXTURE, mz, 'positive', null, 5, 10)
    expect(hits.map((h) => h[0])).toContain('LMGP01010576')
    expect(hits.find((h) => h[0] === 'LMGP01010576')![8]).toBe('[M+H]+')
  })

  it('specific adduct restricts the scan', () => {
    const mz = 759.577806 + 22.989218 // [M+Na]+
    const hits = massSearchLipidIndex(FIXTURE, mz, 'positive', { '[M+Na]+': 22.989218 }, 5, 10)
    expect(hits).toHaveLength(1)
    expect(hits[0]![8]).toBe('[M+Na]+')
  })

  it('returns empty outside the ppm window', () => {
    expect(massSearchLipidIndex(FIXTURE, 500, 'positive', null, 5, 10)).toEqual([])
  })
})

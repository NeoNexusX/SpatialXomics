import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply as applyLiterature, europepmcSearch, pubmedSearch } from '../index'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '../../tools'
import { SystemPrompt } from '../../system-prompt'

afterEach(() => vi.unstubAllGlobals())

function respond(body: unknown) {
  const fetcher = vi.fn(async () => Response.json(body))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

describe('Europe PMC response contract', () => {
  it('reads core results, abstracts, MED identifiers and full text from the public REST shape', async () => {
    const fetcher = respond({
      hitCount: 42,
      resultList: {
        result: [
          {
            id: '12345',
            source: 'MED',
            title: 'Imaging lipids.',
            pubYear: '2024',
            journalInfo: { journal: { title: 'Example journal' } },
            abstractText: '<h4>Results</h4><p>A tissue-specific distribution was observed.</p>',
            doi: '10.1234/example',
            pmcid: 'PMC1234',
            isOpenAccess: 'Y',
          },
        ],
      },
    })
    const signal = new AbortController().signal
    const result = await europepmcSearch('lipids brain', 3, signal)
    expect(result).toContain('total_hits: 42')
    expect(result).toContain('PMID 12345 | PMCID PMC1234 | doi:10.1234/example')
    expect(result).toContain(
      'paper_ids: PMID:12345 | PMCID:PMC1234 | DOI:10.1234/example | Provider:MED:12345',
    )
    expect(result).toContain('abstract: Results A tissue-specific distribution was observed.')
    expect(result).toContain('https://europepmc.org/articles/PMC1234')
    expect(result).not.toContain('<p>')
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('resultType=core'),
      expect.objectContaining({ signal }),
    )
  })

  it('does not assign a PubMed id to a preprint', async () => {
    respond({
      hitCount: 1,
      resultList: { result: [{ id: 'PPR1', source: 'PPR', title: 'Preprint' }] },
    })
    expect(await europepmcSearch('q', 1)).not.toContain('PMID')
  })

  it('exposes excludeIds for complementary searches on both literature tools', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    try {
      applyLiterature(ctx)
      for (const name of ['europepmc_search', 'pubmed_search']) {
        const tool = ctx.tools.list().find((candidate) => candidate.name === name)!
        expect(tool.parameters.properties).toHaveProperty('excludeIds')
      }
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('tells the model the fallback chain in order: pubmed, then europepmc, then web_search', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    try {
      applyLiterature(ctx)
      const tool = (name: string) => ctx.tools.list().find((candidate) => candidate.name === name)!
      expect(tool('pubmed_search').description).toContain('Search PubMed first')
      expect(tool('pubmed_search').description).not.toMatch(/TIER/)
      expect(tool('pubmed_search').description).toContain(
        'fall back to europepmc_search, then web_search',
      )
      expect(tool('europepmc_search').description).toContain(
        'Use only after pubmed_search has errored',
      )
      expect(tool('europepmc_search').description).not.toMatch(/TIER/)
      expect(tool('europepmc_search').description).not.toContain('fall back to pubmed_search')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('filters first-pass records by normalized DOI, PMID and PMCID identifiers', async () => {
    respond({
      hitCount: 3,
      resultList: {
        result: [
          { id: 'A1', source: 'MED', pmid: '111', doi: '10.1234/first', title: 'First paper' },
          {
            id: 'PMC22',
            source: 'PMC',
            pmcid: 'PMC22',
            doi: '10.1234/second',
            title: 'Second paper',
          },
          { id: 'PPR3', source: 'PPR', title: 'New paper', abstractText: 'New abstract.' },
        ],
      },
    })
    const out = await europepmcSearch('claim', 2, undefined, [
      'https://doi.org/10.1234/FIRST',
      'pmcid:pmc22',
    ])
    expect(out).not.toContain('First paper')
    expect(out).not.toContain('Second paper')
    expect(out).toContain('New paper')
    expect(out).toContain('paper_ids: Provider:PPR:PPR3')
  })

  it('excludes a provider-only record when its emitted paper_ids token is passed back', async () => {
    // 预印本没有 PMID/PMCID/DOI，唯一标识就是 provider id。工具输出
    // `Provider:PPR:PPR3` 并要求模型原样回传，这条回路必须真的排得掉。
    respond({
      hitCount: 2,
      resultList: {
        result: [
          { id: 'PPR3', source: 'PPR', title: 'Seen preprint', abstractText: 'Old abstract.' },
          { id: 'PPR9', source: 'PPR', title: 'Fresh preprint', abstractText: 'New abstract.' },
        ],
      },
    })
    const out = await europepmcSearch('claim', 2, undefined, ['Provider:PPR:PPR3'])
    expect(out).not.toContain('Seen preprint')
    expect(out).toContain('Fresh preprint')
  })

  it('reports no non-excluded results when all returned records were already seen', async () => {
    respond({
      hitCount: 1,
      resultList: { result: [{ id: '1', source: 'MED', pmid: '123', title: 'Already found' }] },
    })
    const out = await europepmcSearch('claim', 2, undefined, ['123'])
    expect(out).toContain('No non-excluded Europe PMC results')
  })

  it('distinguishes an empty result from an invalid upstream response', async () => {
    respond({ hitCount: 0, resultList: { result: [] } })
    expect(await europepmcSearch('q', 3)).toContain('No Europe PMC results')
    respond({ error: 'upstream error' })
    await expect(europepmcSearch('q', 3)).rejects.toThrow('Invalid Europe PMC')
  })
})

describe('PubMed', () => {
  const efetchXml = `<?xml version="1.0"?>
<PubmedArticleSet>
  <PubmedArticle><MedlineCitation><PMID>111</PMID><Article><Abstract>
    <AbstractText Label="BACKGROUND">Lipids vary by region.</AbstractText>
    <AbstractText Label="RESULTS">Taurine concentrates in the medulla.</AbstractText>
  </Abstract></Article></MedlineCitation></PubmedArticle>
  <PubmedArticle><MedlineCitation><PMID>222</PMID><Article><Abstract>
    <AbstractText>A broad MSI review.</AbstractText>
  </Abstract></Article></MedlineCitation></PubmedArticle>
</PubmedArticleSet>`

  const searchAndSummary = () =>
    vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ esearchresult: { count: '1024', idlist: ['111', '222'] } }),
      )
      .mockResolvedValueOnce(
        Response.json({
          result: {
            uids: ['111', '222'],
            '111': {
              title: 'Lipid imaging in brain.',
              fulljournalname: 'J Mass Spectrom',
              pubdate: '2020 Mar',
            },
            '222': { title: 'MSI review.', source: 'Anal Chem', pubdate: '2021 Jan 15' },
          },
        }),
      )

  it('searches, summarises, then fetches abstracts, taking the total from the search', async () => {
    const fetcher = searchAndSummary().mockResolvedValueOnce(new Response(efetchXml))
    vi.stubGlobal('fetch', fetcher)
    const signal = new AbortController().signal
    const out = await pubmedSearch('lipid imaging', 2, signal)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher.mock.calls[0]![0]).toContain('term=lipid%20imaging')
    expect(fetcher.mock.calls[2]![0]).toContain('efetch.fcgi')
    expect(fetcher.mock.calls[2]![0]).toContain('id=111,222')
    for (const call of fetcher.mock.calls) expect(call[1].signal).toBe(signal)
    expect(out).toContain('total_hits: 1024')
    expect(out).toContain('- Lipid imaging in brain')
    expect(out).toContain('J Mass Spectrom 2020 | PMID 111 | https://pubmed.ncbi.nlm.nih.gov/111/')
    expect(out).toContain('Anal Chem 2021 | PMID 222')
    // 结构化摘要保留 Label；每条摘要跟在自己的条目下
    expect(out).toContain(
      'abstract: BACKGROUND: Lipids vary by region. RESULTS: Taurine concentrates in the medulla.',
    )
    expect(out).toContain('abstract: A broad MSI review.')
  })

  it('keeps the citation list when the abstract fetch fails', async () => {
    const fetcher = searchAndSummary().mockRejectedValueOnce(new Error('efetch down'))
    vi.stubGlobal('fetch', fetcher)
    const out = await pubmedSearch('lipid imaging', 2)
    expect(out).toContain('PMID 111')
    expect(out).toContain('PMID 222')
    expect(out).not.toContain('abstract:')
  })

  it('reports no hits without asking for a summary', async () => {
    const fetcher = respond({ esearchresult: { idlist: [], count: '0' } })
    expect(await pubmedSearch('nothing', 5)).toContain('No PubMed results')
    expect(fetcher).toHaveBeenCalledOnce()
  })
})

it('rejects empty searches without making requests', async () => {
  const fetcher = respond({})
  for (const search of [pubmedSearch, europepmcSearch])
    await expect(search('  ', 3)).rejects.toThrow('nonempty')
  expect(fetcher).not.toHaveBeenCalled()
})

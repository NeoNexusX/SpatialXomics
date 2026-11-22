import { afterEach, describe, expect, it, vi } from 'vitest'
import { europepmcSearch, pubmedSearch } from '../index'

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

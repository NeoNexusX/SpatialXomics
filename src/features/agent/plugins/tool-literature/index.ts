/**
 * 文献检索工具集：PubMed / Europe PMC / OpenAlex（全部只读、CORS 友好）。
 *
 * - PubMed E-utilities https://eutils.ncbi.nlm.nih.gov/entrez/eutils/
 *   （无鉴权，CORS 友好；仅标题/期刊/PMID，无摘要正文）
 * - Europe PMC REST https://www.ebi.ac.uk/europepmc/webservices/rest/
 *   （PubMed 超集：resultType=core 直接带回摘要正文，CORS ✓）
 * - OpenAlex https://api.openalex.org/works（综述/DOI 元数据/被引，CORS ✓）
 *
 * 设计约束（同 tool-knowledge）：结果摘要化紧凑文本；E-utilities 无 key
 * 限 ~3 req/s，每次调用只发 1-2 个请求。
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, getJson, excerpt, TOOL_RESULT_CHARS_EVIDENCE } from '../tools'

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const EPMC_BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search'
const OPENALEX_BASE = 'https://api.openalex.org/works'

/** 校验查询词，返回限制后的结果数 */
function resultCount(query: string, maxResults: number): number {
  if (!query.trim()) throw new Error('Provide a nonempty search query')
  return Math.min(Math.max(maxResults, 1), 10)
}

const cleanTitle = (title: unknown) => String(title ?? '').replace(/\s*\.\s*$/, '')

// ---- PubMed ----

/** PubMed 文献检索：esearch + esummary 两跳，返回标题/期刊/年份/PMID/链接 */
export async function pubmedSearch(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<string> {
  const n = resultCount(query, maxResults)
  const searchUrl =
    `${EUTILS_BASE}/esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retmax=${n}` +
    `&term=${encodeURIComponent(query)}`
  const search = (await getJson(searchUrl, { signal }))?.esearchresult
  if (!search || search.ERROR) throw new Error(search?.ERROR ?? 'Invalid PubMed search response')
  const ids: string[] = search.idlist ?? []
  if (ids.length === 0) return `No PubMed results for "${query}".`

  const sumUrl = `${EUTILS_BASE}/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`
  const result = (await getJson(sumUrl, { signal }))?.result
  if (!result) throw new Error('Invalid PubMed summary response')

  const lines = [`total_hits: ${search.count ?? ids.length}`]
  for (const uid of (result?.uids ?? ids) as string[]) {
    const r = result[uid]
    if (!r) continue
    const title = cleanTitle(r.title)
    const journal = r.fulljournalname ?? r.source ?? ''
    const date = String(r.pubdate ?? '').split(' ')[0]
    lines.push(
      `- ${title}\n  ${journal} ${date} | PMID ${uid} | https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
    )
  }
  return lines.join('\n')
}

// ---- Europe PMC（PubMed 超集，带摘要正文） ----

/** Europe PMC 检索：标题/期刊/年份/DOI/PMCID + 摘要摘录（resultType=core） */
export async function europepmcSearch(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<string> {
  const n = resultCount(query, maxResults)
  const url =
    `${EPMC_BASE}?query=${encodeURIComponent(query)}` + `&format=json&resultType=core&pageSize=${n}`
  const data = await getJson(url, { signal })
  if (!Array.isArray(data?.resultList?.result))
    throw new Error('Invalid Europe PMC search response')
  const hits: any[] = data.resultList.result
  if (hits.length === 0) return `No Europe PMC results for "${query}".`

  const lines = [`total_hits: ${data.hitCount ?? hits.length}`]
  for (const r of hits) {
    const title = cleanTitle(r.title)
    const journal = r.journalInfo?.journal?.title ?? ''
    const year = r.pubYear ?? r.journalInfo?.yearOfPublication ?? ''
    const ids = [
      r.pmid || r.source === 'MED' ? `PMID ${r.pmid ?? r.id}` : '',
      r.pmcid ? `PMCID ${r.pmcid}` : '',
      r.doi ? `doi:${r.doi}` : '',
    ]
      .filter(Boolean)
      .join(' | ')
    lines.push(`- ${title}\n  ${journal} ${year}${ids ? ` | ${ids}` : ''}`)
    const abs = r.abstractText
    if (abs) lines.push(`  abstract: ${excerpt(String(abs).replace(/<[^>]*>/g, ' '), 600)}`)
    if (r.isOpenAccess === 'Y' && r.pmcid) {
      lines.push(`  fulltext: https://europepmc.org/articles/${r.pmcid}`)
    }
  }
  return lines.join('\n')
}

// ---- OpenAlex（综述检索 / DOI 元数据 / 被引） ----

/** OpenAlex 检索：标题/年份/期刊/DOI/被引次数/OA 链接 */
export async function openalexSearch(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<string> {
  const n = resultCount(query, maxResults)
  const url = `${OPENALEX_BASE}?search=${encodeURIComponent(query)}&per-page=${n}`
  const data = await getJson(url, { signal })
  if (!Array.isArray(data?.results)) throw new Error('Invalid OpenAlex search response')
  const works: any[] = data.results
  if (works.length === 0) return `No OpenAlex results for "${query}".`

  const lines = [`total_hits: ${data.meta?.count ?? works.length}`]
  for (const w of works) {
    const title = cleanTitle(w.display_name)
    const venue = w.primary_location?.source?.display_name ?? ''
    const year = w.publication_year ?? ''
    const cited = w.cited_by_count ?? 0
    const doi = typeof w.doi === 'string' ? w.doi.replace('https://doi.org/', '') : ''
    const type = w.type ?? ''
    lines.push(
      `- ${title}\n  ${venue} ${year} | ${type}${doi ? ` | doi:${doi}` : ''} | cited by ${cited}`,
    )
    const oa = w.open_access?.oa_url ?? w.primary_location?.landing_page_url
    if (oa) lines.push(`  link: ${oa}`)
  }
  return lines.join('\n')
}

// ---- 插件 ----

/**
 * 选型指引（也写给模型）：
 * - 只要 PubMed 索引内命中（快速核对"有没有文献"）→ pubmed_search
 * - 需要摘要正文支撑结论 → europepmc_search（首选）
 * - 找综述/看影响力/要 DOI → openalex_search
 */
export const name = 'tool-literature'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(
    defineTool({
      name: 'pubmed_search',
      category: 'literature',
      description:
        'Search PubMed literature. Returns title/journal/year/PMID/link (no abstract text — ' +
        'use europepmc_search when you need the abstract). Use to ground biological ' +
        'interpretation in published evidence (e.g. "{molecule} mass spectrometry imaging {tissue}").',
      parameters: {
        query: {
          type: 'string',
          required: true,
          description: 'PubMed search query (English works best)',
        },
        maxResults: { type: 'integer', description: 'Max papers (default 5, max 10)' },
      },
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      async execute(args, exec) {
        return pubmedSearch(args.query!, args.maxResults ?? 5, exec.signal)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'europepmc_search',
      category: 'literature',
      description:
        'Search Europe PMC (a PubMed superset including preprints and PMC full texts). ' +
        'Returns title/journal/year/DOI plus the ABSTRACT TEXT excerpt — the first choice ' +
        'when you need published evidence to support or challenge an interpretation.',
      parameters: {
        query: { type: 'string', required: true, description: 'Search query (English works best)' },
        maxResults: { type: 'integer', description: 'Max papers (default 5, max 10)' },
      },
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      async execute(args, exec) {
        return europepmcSearch(args.query!, args.maxResults ?? 5, exec.signal)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'openalex_search',
      category: 'literature',
      description:
        'Search OpenAlex scholarly works (all disciplines, incl. reviews/preprints): title, venue, ' +
        'year, DOI, citation count, open-access link. Use to find review articles or gauge how much ' +
        'published work supports a topic.',
      parameters: {
        query: { type: 'string', required: true, description: 'Search query' },
        maxResults: { type: 'integer', description: 'Max works (default 5, max 10)' },
      },
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      async execute(args, exec) {
        return openalexSearch(args.query!, args.maxResults ?? 5, exec.signal)
      },
    }),
  )
}

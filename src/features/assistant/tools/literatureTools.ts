/**
 * 文献检索工具集：PubMed / Europe PMC / OpenAlex（全部只读、CORS 友好）。
 *
 * - PubMed E-utilities https://eutils.ncbi.nlm.nih.gov/entrez/eutils/
 *   （无鉴权，CORS 友好；仅标题/期刊/PMID，无摘要正文）
 * - Europe PMC REST https://www.ebi.ac.uk/europepmc/webservices/rest/
 *   （PubMed 超集：resultType=core 直接带回摘要正文，CORS ✓）
 * - OpenAlex https://api.openalex.org/works（综述/DOI 元数据/被引，CORS ✓）
 *
 * 设计约束（同 knowledgeTools）：结果摘要化紧凑文本；E-utilities 无 key
 * 限 ~3 req/s，每次调用只发 1-2 个请求。
 */

import type { Context, Plugin } from '@deepseek-ai/cordis'
import { defineTool } from './defineTool'
import { getJson, excerpt } from './httpJson'

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const EPMC_BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search'
const OPENALEX_BASE = 'https://api.openalex.org/works'

// ---- PubMed（自 knowledgeTools 迁入，逻辑不变） ----

/** PubMed 文献检索：esearch + esummary 两跳，返回标题/期刊/年份/PMID/链接 */
export async function pubmedSearch(query: string, maxResults: number): Promise<string> {
  const n = Math.min(Math.max(maxResults, 1), 10)
  const searchUrl =
    `${EUTILS_BASE}/esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retmax=${n}` +
    `&term=${encodeURIComponent(query)}`
  const ids: string[] = (await getJson(searchUrl))?.esearchresult?.idlist ?? []
  if (ids.length === 0) return `No PubMed results for "${query}".`

  const sumUrl = `${EUTILS_BASE}/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`
  const result = (await getJson(sumUrl))?.result ?? {}

  const lines = [`total_hits: ${result?.count ?? ids.length}`]
  for (const uid of (result?.uids ?? ids) as string[]) {
    const r = result[uid]
    if (!r) continue
    const title = String(r.title ?? '').replace(/\s*\.\s*$/, '')
    const journal = r.fulljournalname ?? r.source ?? ''
    const date = String(r.pubdate ?? '').split(' ')[0]
    lines.push(`- ${title}\n  ${journal} ${date} | PMID ${uid} | https://pubmed.ncbi.nlm.nih.gov/${uid}/`)
  }
  return lines.join('\n')
}

// ---- Europe PMC（PubMed 超集，带摘要正文） ----

/** Europe PMC 检索：标题/期刊/年份/DOI/PMCID + 摘要摘录（resultType=core） */
export async function europepmcSearch(query: string, maxResults: number): Promise<string> {
  const n = Math.min(Math.max(maxResults, 1), 10)
  const url =
    `${EPMC_BASE}?query=${encodeURIComponent(query)}` +
    `&format=json&resultType=core&pageSize=${n}`
  const data = await getJson(url)
  const hits: any[] = data?.responseData?.results ?? []
  if (hits.length === 0) return `No Europe PMC results for "${query}".`

  const lines = [`total_hits: ${data?.responseData?.hitCount ?? hits.length}`]
  for (const r of hits) {
    const title = String(r.title ?? '').replace(/\s*\.\s*$/, '')
    const journal = r.journalInfo?.journal?.title ?? ''
    const year = r.pubYear ?? r.journalInfo?.yearOfPublication ?? ''
    const ids = [
      r.pmid ? `PMID ${r.pmid}` : '',
      r.pmcid ? `PMCID ${r.pmcid}` : '',
      r.doi ? `doi:${r.doi}` : '',
    ]
      .filter(Boolean)
      .join(' | ')
    lines.push(`- ${title}\n  ${journal} ${year}${ids ? ` | ${ids}` : ''}`)
    const abs = r.abstractText
    if (abs) lines.push(`  abstract: ${excerpt(abs, 600)}`)
    if (r.isOpenAccess === 'Y' && r.pmcid) {
      lines.push(`  fulltext: https://europepmc.org/article/${r.pmcid}`)
    }
  }
  return lines.join('\n')
}

// ---- OpenAlex（综述检索 / DOI 元数据 / 被引） ----

/** OpenAlex 检索：标题/年份/期刊/DOI/被引次数/OA 链接 */
export async function openalexSearch(query: string, maxResults: number): Promise<string> {
  const n = Math.min(Math.max(maxResults, 1), 10)
  const url = `${OPENALEX_BASE}?search=${encodeURIComponent(query)}&per-page=${n}`
  const data = await getJson(url)
  const works: any[] = data?.results ?? []
  if (works.length === 0) return `No OpenAlex results for "${query}".`

  const lines = [`total_hits: ${data?.meta?.count ?? works.length}`]
  for (const w of works) {
    const title = String(w.display_name ?? '').replace(/\s*\.\s*$/, '')
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
 * 文献工具插件。在 bootstrap 中：ctx.plugin(literatureTools)
 *
 * 选型指引（也写给模型）：
 * - 只要 PubMed 索引内命中（快速核对"有没有文献"）→ pubmed_search
 * - 需要摘要正文支撑结论 → europepmc_search（首选）
 * - 找综述/看影响力/要 DOI → openalex_search
 */
export const literatureTools: Plugin.Function<void> = (ctx: Context) => {
  ctx.tools.register(
    defineTool({
      name: 'pubmed_search',
      category: 'literature',
      description:
        'Search PubMed literature. Returns title/journal/year/PMID/link (no abstract text — ' +
        'use europepmc_search when you need the abstract). Use to ground biological ' +
        'interpretation in published evidence (e.g. "{molecule} mass spectrometry imaging {tissue}").',
      parameters: {
        query: { type: 'string', required: true, description: 'PubMed search query (English works best)' },
        maxResults: { type: 'integer', description: 'Max papers (default 5, max 10)' },
      },
      async execute(args) {
        return pubmedSearch(args.query!, args.maxResults ?? 5)
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
      async execute(args) {
        return europepmcSearch(args.query!, args.maxResults ?? 5)
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
      async execute(args) {
        return openalexSearch(args.query!, args.maxResults ?? 5)
      },
    }),
  )
}

// cordis 4：fiber 内访问兄弟服务（ctx.tools）必须声明 inject。
literatureTools.inject = ['tools']

/**
 * 文献检索工具集：Europe PMC / PubMed（全部只读、CORS 友好）。
 *
 * 检索目的：为**当前的状况或论断**找可引用的支撑/反驳文本，而不是泛搜分子名。
 * 关键词由调用方按待验证的论断自行设定（分子 + 组织 + 模态 + 结局等限定词）。
 *
 * 固定降级链（也写给模型）：europepmc_search → pubmed_search → web_search。
 * 上一档报错或零命中才走下一档；两档文献工具都零命中 = 没找到文献，都报错 = 覆盖缺口，
 * 两者都不等于"该论断没有文献支持"。两档都返回摘要正文；再降级到 web_search 时拿到的是
 * 网页摘录而非同行评议摘要，必须声明证据类型下降。
 *
 * - Europe PMC REST https://www.ebi.ac.uk/europepmc/webservices/rest/
 *   （PubMed 超集：resultType=core 直接带回摘要正文，CORS ✓）
 * - PubMed E-utilities https://eutils.ncbi.nlm.nih.gov/entrez/eutils/
 *   （无鉴权，CORS 友好；esearch + esummary + efetch 三跳，efetch 取摘要正文）
 *
 * 设计约束（同 tool-knowledge）：结果摘要化紧凑文本；E-utilities 无 key
 * 限 ~3 req/s，每次调用只发 2-3 个请求。
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, getJson, getText, excerpt, TOOL_RESULT_CHARS_EVIDENCE } from '../tools'

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const EPMC_BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search'

/** 校验查询词，返回限制后的结果数 */
function resultCount(query: string, maxResults: number): number {
  if (!query.trim()) throw new Error('Provide a nonempty search query')
  return Math.min(Math.max(maxResults, 1), 10)
}

const cleanTitle = (title: unknown) => String(title ?? '').replace(/\s*\.\s*$/, '')

// ---- PubMed ----

/**
 * efetch 取摘要正文（第三跳）。结构化摘要的 AbstractText 带 Label，拼成
 * "BACKGROUND: … METHODS: …"。失败不致命——标题/PMID 仍可用于"有没有文献"。
 */
async function pubmedAbstracts(
  ids: string[],
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const url = `${EUTILS_BASE}/efetch.fcgi?db=pubmed&retmode=xml&id=${ids.join(',')}`
  const doc = new DOMParser().parseFromString(await getText(url, { signal }), 'application/xml')
  const out = new Map<string, string>()
  for (const article of Array.from(doc.getElementsByTagName('PubmedArticle'))) {
    const pmid = article.getElementsByTagName('PMID')[0]?.textContent?.trim()
    if (!pmid) continue
    const parts = Array.from(article.getElementsByTagName('AbstractText'))
      .map((node) => {
        const text = (node.textContent ?? '').trim()
        const label = node.getAttribute('Label')
        return label && text ? `${label}: ${text}` : text
      })
      .filter(Boolean)
    if (parts.length) out.set(pmid, excerpt(parts.join(' '), 600))
  }
  return out
}

/** PubMed 文献检索：esearch + esummary + efetch 三跳，返回标题/期刊/年份/PMID/摘要 */
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

  let abstracts = new Map<string, string>()
  try {
    abstracts = await pubmedAbstracts(ids, signal)
  } catch {
    signal?.throwIfAborted() // Cancellation must not become a successful partial result.
  }

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
    const abs = abstracts.get(uid)
    if (abs) lines.push(`  abstract: ${abs}`)
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

// ---- 插件 ----

/**
 * 选型指引（也写给模型）：固定降级链 europepmc → pubmed → web_search。
 * 上一档报错或零命中才走下一档，并在结论里说明实际用了哪一档、前面为什么没用上。
 * 两档文献工具都零命中 = 没找到文献；都报错 = 覆盖缺口。两者都不是"该论断无文献支持"。
 * 关键词由模型按当前待验证的状况/论断自行设定，不是固定模板。
 */
export const name = 'tool-literature'
export const inject = ['tools']

export function apply(ctx: Context) {
  /**
   * pubmed_search —— PubMed 文献检索（E-utilities esearch + esummary + efetch 三跳）。
   *
   * 作用：降级链第 2 档，仅在 europepmc_search 报错或零命中时使用。返回 total_hits
   * 与标题/期刊/年份/PMID/链接 + 摘要正文摘录（efetch，≤600 字符；结构化摘要保留
   * Label）。efetch 失败不致命，此时退化为仅元数据，必须声明不能据此下结论。
   * 再失败或零命中才降到 web_search（网页摘录，证据类型下降）。
   *
   * 参数：
   * - query (string, 必填)：按待验证论断自拟的检索词（英文效果最好）
   * - maxResults (integer, 可选)：返回篇数，默认 5、cap 10
   */
  ctx.tools.register(
    defineTool({
      name: 'pubmed_search',
      timeoutMs: 30000,
      category: 'literature',
      description:
        'LITERATURE TIER 2 — use only after europepmc_search has errored or returned no hits. Searches ' +
        'PubMed for evidence about the specific claim or observation you are checking; choose the keywords ' +
        'yourself from that claim (molecule, tissue, modality, outcome). Returns the total hit count plus ' +
        'title, journal, date, PMID, PubMed link and an abstract excerpt of up to 600 characters ' +
        '(structured abstracts keep their section labels). If the abstract fetch fails you get metadata ' +
        'only — say so and do not infer conclusions from a title. If this tier also fails or returns ' +
        'nothing, fall back to web_search and state that the evidence is then a web excerpt, not a ' +
        'peer-reviewed abstract. English queries work best.',
      parameters: {
        query: {
          type: 'string',
          required: true,
          description:
            'PubMed search expression built from the claim being checked; English keywords/phrases work best; must be non-empty.',
        },
        maxResults: {
          type: 'integer',
          description: 'Max papers returned, default 5, clamped 1–10.',
        },
      },
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      async execute(args, exec) {
        return pubmedSearch(args.query!, args.maxResults ?? 5, exec.signal)
      },
    }),
  )

  /**
   * europepmc_search —— Europe PMC 检索（PubMed 超集，含预印本与 PMC 全文）。
   *
   * 作用：降级链第 1 档（首选）。返回标题/期刊/年份/DOI/PMID/PMCID + 摘要正文摘录
   * （resultType=core，≤600 字符）；OA 且有 PMCID 的条目附 europepmc 全文链接。
   * 报错或零命中才降到 pubmed_search，再不行才 web_search。
   *
   * 参数：
   * - query (string, 必填)：按待验证论断自拟的检索词（英文效果最好）
   * - maxResults (integer, 可选)：返回篇数，默认 5、cap 10
   */
  ctx.tools.register(
    defineTool({
      name: 'europepmc_search',
      timeoutMs: 30000,
      category: 'literature',
      description:
        'LITERATURE TIER 1 (first choice) — search Europe PMC, a PubMed superset including preprints and ' +
        'PMC full texts, for retrievable evidence that supports or challenges the specific claim or ' +
        'observation you are assessing. You choose the keywords from that claim (molecule, tissue, modality, ' +
        'outcome, method) rather than searching a bare molecule name. Returns title, journal, year, ' +
        'identifiers (PMID/PMCID/DOI), an abstract excerpt of up to 600 characters, and a full-text link for ' +
        'open-access entries with a PMCID. If this call errors or returns no hits, fall back to ' +
        'pubmed_search, then web_search. Both literature tiers returning nothing means no literature was ' +
        'found; both erroring is a coverage gap — neither means the claim is wrong. Verify the excerpt ' +
        'actually supports any claim you cite; abstracts may be truncated.',
      parameters: {
        query: {
          type: 'string',
          required: true,
          description:
            'Europe PMC search expression built from the claim being checked; English works best; must be non-empty.',
        },
        maxResults: {
          type: 'integer',
          description: 'Max papers returned, default 5, clamped 1–10.',
        },
      },
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      async execute(args, exec) {
        return europepmcSearch(args.query!, args.maxResults ?? 5, exec.signal)
      },
    }),
  )
}

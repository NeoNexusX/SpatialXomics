/**
 * 文献检索工具集：PubMed / Europe PMC（全部只读、CORS 友好）。
 *
 * 检索目的：为**当前的状况或论断**找可引用的支撑/反驳文本，而不是泛搜分子名。
 * 关键词由调用方按待验证的论断自行设定（分子 + 组织 + 模态 + 结局等限定词）。
 *
 * 固定回退链（也写给模型）：pubmed_search → europepmc_search → web_search。
 * 上一个来源报错或零命中才走下一个来源；两个文献来源都零命中 = 没找到文献，都报错 = 覆盖缺口，
 * 两者都不等于"该论断没有文献支持"。两个来源都返回摘要正文；再回退到 web_search 时拿到的是
 * 网页摘录而非同行评议摘要，必须声明证据类型下降。
 *
 * - PubMed E-utilities https://eutils.ncbi.nlm.nih.gov/entrez/eutils/
 *   （无鉴权，CORS 友好；esearch + esummary + efetch 三跳，efetch 取摘要正文）
 * - Europe PMC REST https://www.ebi.ac.uk/europepmc/webservices/rest/
 *   （PubMed 超集：resultType=core 直接带回摘要正文，CORS ✓）
 *
 * 设计约束（同 tool-knowledge）：结果摘要化紧凑文本；E-utilities 无 key
 * 限 ~3 req/s，每次调用只发 2-3 个请求。
 *
 * 超时 60 s，与 PubChem/HMDB 同档（不是 30 s）：两家上游延迟长尾明显——实测中位
 * ~3 s、尾部 8 s+，偶发超过 30 s。卡太紧会把一次慢响应判成永久失败，逼模型降级到
 * web_search，白白损失证据等级。PubMed 一侧还要在同一个预算里跑完三跳。
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
const MAX_EXCLUSION_OVERFETCH = 50

type PaperIds = { pmid?: string; pmcid?: string; doi?: string; provider?: string }

function normalizePaperId(value: string): string {
  // formatPaperIds 输出的是 `Provider:PPR:PPR3`，模型被要求原样回传给 excludeIds，
  // 所以这里必须先脱掉这层包装，否则只有 provider id 的条目（预印本等）永远排不掉。
  const raw = value.trim().replace(/^provider\s*:\s*/i, '')
  if (!raw) return ''
  const doi = raw.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi\s*:\s*/i, '')
  if (/^10\.\d{4,9}\/\S+$/i.test(doi)) return `doi:${doi.toLowerCase()}`
  const pmcid = /^(?:pmcid\s*:\s*)?(PMC\d+)$/i.exec(raw)
  if (pmcid) return `pmcid:${pmcid[1]!.toUpperCase()}`
  const pmid = /^(?:pmid\s*:\s*)?(\d+)$/i.exec(raw)
  if (pmid) return `pmid:${pmid[1]}`
  return raw.toLowerCase()
}

function paperIdSet(ids: PaperIds): Set<string> {
  return new Set(
    [
      ids.pmid ? normalizePaperId(`PMID:${ids.pmid}`) : '',
      ids.pmcid ? normalizePaperId(`PMCID:${ids.pmcid}`) : '',
      ids.doi ? normalizePaperId(`DOI:${ids.doi}`) : '',
      ids.provider ? normalizePaperId(ids.provider) : '',
    ].filter(Boolean),
  )
}

function parseExcludedIds(values: string[] = []): Set<string> {
  return new Set(values.map(normalizePaperId).filter(Boolean))
}

function isExcluded(ids: PaperIds, excluded: Set<string>): boolean {
  return [...paperIdSet(ids)].some((id) => excluded.has(id))
}

function formatPaperIds(ids: PaperIds): string {
  return [
    ids.pmid ? `PMID:${ids.pmid}` : '',
    ids.pmcid ? `PMCID:${ids.pmcid}` : '',
    ids.doi ? `DOI:${ids.doi}` : '',
    ids.provider ? `Provider:${ids.provider}` : '',
  ]
    .filter(Boolean)
    .join(' | ')
}

function searchCount(maxResults: number, exclusions: Set<string>): number {
  return Math.min(maxResults + exclusions.size, MAX_EXCLUSION_OVERFETCH)
}

// ---- PubMed ----

/**
 * efetch 取摘要正文（第三跳）。结构化摘要的 AbstractText 带 Label，拼成
 * "BACKGROUND: … METHODS: …"。失败不致命——标题/PMID 仍可用于"有没有文献"。
 */
async function pubmedAbstracts(ids: string[], signal?: AbortSignal): Promise<Map<string, string>> {
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
  excludeIds: string[] = [],
): Promise<string> {
  const n = resultCount(query, maxResults)
  const excluded = parseExcludedIds(excludeIds)
  const retmax = searchCount(n, excluded)
  const searchUrl =
    `${EUTILS_BASE}/esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retmax=${retmax}` +
    `&term=${encodeURIComponent(query)}`
  const search = (await getJson(searchUrl, { signal }))?.esearchresult
  if (!search || search.ERROR) throw new Error(search?.ERROR ?? 'Invalid PubMed search response')
  const ids: string[] = search.idlist ?? []
  const eligibleIds = ids.filter((pmid) => !isExcluded({ pmid }, excluded)).slice(0, n)
  if (eligibleIds.length === 0) {
    return excluded.size
      ? `No non-excluded PubMed results for "${query}" (excluded ${excluded.size} supplied identifiers).`
      : `No PubMed results for "${query}".`
  }

  const sumUrl = `${EUTILS_BASE}/esummary.fcgi?db=pubmed&retmode=json&id=${eligibleIds.join(',')}`
  const result = (await getJson(sumUrl, { signal }))?.result
  if (!result) throw new Error('Invalid PubMed summary response')

  let abstracts = new Map<string, string>()
  try {
    abstracts = await pubmedAbstracts(eligibleIds, signal)
  } catch {
    signal?.throwIfAborted() // Cancellation must not become a successful partial result.
  }

  const lines = [`total_hits: ${search.count ?? ids.length}`]
  for (const uid of (result?.uids ?? eligibleIds) as string[]) {
    const r = result[uid]
    if (!r) continue
    const title = cleanTitle(r.title)
    const journal = r.fulljournalname ?? r.source ?? ''
    const date = String(r.pubdate ?? '').split(' ')[0]
    lines.push(
      `- ${title}\n  ${journal} ${date} | PMID ${uid} | https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
      `  paper_ids: ${formatPaperIds({ pmid: uid })}`,
    )
    const abs = abstracts.get(uid)
    if (abs) lines.push(`  abstract: ${abs}`)
  }
  if (
    eligibleIds.length < n &&
    Number(search.count ?? ids.length) > eligibleIds.length &&
    ids.length >= retmax
  ) {
    lines.push(
      `  note: returned ${eligibleIds.length} non-excluded results; the bounded search window could not fill maxResults=${n}.`,
    )
  }
  return lines.join('\n')
}

// ---- Europe PMC（PubMed 超集，带摘要正文） ----

/** Europe PMC 检索：标题/期刊/年份/DOI/PMCID + 摘要摘录（resultType=core） */
type EuropePmcRecord = {
  id?: string
  source?: string
  pmid?: string
  pmcid?: string
  doi?: string
  title?: string
  journalInfo?: { journal?: { title?: string }; yearOfPublication?: string }
  pubYear?: string
  abstractText?: string
  isOpenAccess?: string
}

export async function europepmcSearch(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
  excludeIds: string[] = [],
): Promise<string> {
  const n = resultCount(query, maxResults)
  const excluded = parseExcludedIds(excludeIds)
  const retmax = searchCount(n, excluded)
  const url =
    `${EPMC_BASE}?query=${encodeURIComponent(query)}` +
    `&format=json&resultType=core&pageSize=${retmax}`
  const data = await getJson(url, { signal })
  if (!Array.isArray(data?.resultList?.result))
    throw new Error('Invalid Europe PMC search response')
  const hits: EuropePmcRecord[] = data.resultList.result
  const eligible = hits
    .map((r) => {
      const ids: PaperIds = {
        pmid: r.pmid || (r.source === 'MED' ? r.id : undefined),
        pmcid: r.pmcid,
        doi: r.doi,
        provider: r.source && r.id ? `${r.source}:${r.id}` : undefined,
      }
      return { record: r, ids }
    })
    .filter(({ ids }) => !isExcluded(ids, excluded))
    .slice(0, n)
  if (eligible.length === 0) {
    return excluded.size
      ? `No non-excluded Europe PMC results for "${query}" (excluded ${excluded.size} supplied identifiers).`
      : `No Europe PMC results for "${query}".`
  }

  const lines = [`total_hits: ${data.hitCount ?? hits.length}`]
  for (const { record: r, ids: paperIds } of eligible) {
    const title = cleanTitle(r.title)
    const journal = r.journalInfo?.journal?.title ?? ''
    const year = r.pubYear ?? r.journalInfo?.yearOfPublication ?? ''
    const idText = [
      paperIds.pmid ? `PMID ${paperIds.pmid}` : '',
      paperIds.pmcid ? `PMCID ${paperIds.pmcid}` : '',
      paperIds.doi ? `doi:${paperIds.doi}` : '',
    ]
      .filter(Boolean)
      .join(' | ')
    lines.push(`- ${title}\n  ${journal} ${year}${idText ? ` | ${idText}` : ''}`)
    lines.push(`  paper_ids: ${formatPaperIds(paperIds)}`)
    const abs = r.abstractText
    if (abs) lines.push(`  abstract: ${excerpt(String(abs).replace(/<[^>]*>/g, ' '), 600)}`)
    if (r.isOpenAccess === 'Y' && paperIds.pmcid) {
      lines.push(`  fulltext: https://europepmc.org/articles/${paperIds.pmcid}`)
    }
  }
  if (
    eligible.length < n &&
    Number(data.hitCount ?? hits.length) > eligible.length &&
    hits.length >= retmax
  ) {
    lines.push(
      `  note: returned ${eligible.length} non-excluded results; the bounded search window could not fill maxResults=${n}.`,
    )
  }
  return lines.join('\n')
}

// ---- 插件 ----

/**
 * 选型指引（也写给模型）：固定降级链 pubmed → europepmc → web_search。
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
   * 作用：降级链第 1 档（首选）。返回 total_hits 与标题/期刊/年份/PMID/链接 + 摘要
   * 正文摘录（efetch，≤600 字符；结构化摘要保留 Label）。efetch 失败不致命，此时
   * 退化为仅元数据，必须声明不能据此下结论。报错或零命中才降到 europepmc_search
   * （PubMed 超集，含预印本与 PMC 全文），再不行才 web_search（网页摘录，证据类型下降）。
   *
   * 参数：
   * - query (string, 必填)：按待验证论断自拟的检索词（英文效果最好）
   * - maxResults (integer, 可选)：返回篇数，默认 5、cap 10
   */
  ctx.tools.register(
    defineTool({
      name: 'pubmed_search',
      timeoutMs: 60000,
      category: 'literature',
      description:
        'Search PubMed first for retrievable evidence that supports or challenges the specific claim or ' +
        'observation you are assessing. Choose keywords from the claim (molecule/synonyms, tissue, modality, ' +
        'outcome), but do not over-constrain the first query: for a common molecule, start with broader ' +
        'tissue/biology terms and synonyms before adding imaging-method terms. Returns the total hit count ' +
        'plus title, journal, date, PMID, PubMed link, stable paper_ids and an abstract excerpt of up to 600 ' +
        'characters (structured abstracts keep their section labels). If the abstract fetch fails you get ' +
        'metadata only — say so and do not infer conclusions from a title. If this call errors or returns no ' +
        'hits, fall back to europepmc_search, then web_search. Both literature sources returning nothing means ' +
        'no literature was found; both erroring is a coverage gap — neither means the claim is wrong. Verify ' +
        'the abstract supports any claim you cite; title-only or irrelevant abstracts do not count. If a ' +
        'successful discovery search has no supporting abstract, make one complementary second search: drop ' +
        'the narrowest terms (modality and outcome first, keep molecule + tissue) and pass all first-pass ' +
        'paper_ids in excludeIds, then stop. Re-running the same over-constrained terms with exclusions only ' +
        'returns more of the same off-target set. Broaden on off-claim hits too, not only on zero hits. ' +
        'English queries work best.',
      parameters: {
        query: {
          type: 'string',
          required: true,
          description:
            'PubMed search expression built from the claim being checked; English keywords/phrases work best; must be non-empty.',
        },
        maxResults: {
          type: 'integer',
          description: 'Max non-excluded papers returned, default 5, clamped 1–10.',
        },
        excludeIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional PMID, PMCID, DOI, or Provider:SOURCE:ID identifiers to exclude from a complementary second search.',
        },
      },
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      async execute(args, exec) {
        return pubmedSearch(args.query!, args.maxResults ?? 5, exec.signal, args.excludeIds ?? [])
      },
    }),
  )

  /**
   * europepmc_search —— Europe PMC 检索（PubMed 超集，含预印本与 PMC 全文）。
   *
   * 作用：降级链第 2 档，仅在 pubmed_search 报错或零命中时使用。返回标题/期刊/年份/
   * DOI/PMID/PMCID + 摘要正文摘录（resultType=core，≤600 字符）；OA 且有 PMCID 的条目
   * 附 europepmc 全文链接。报错或零命中才降到 web_search。
   *
   * 查询语法与 PubMed 不通用：EPMC 不认 `[tiab]`/`[MeSH Terms]`，且**不报错**——直接当
   * 噪声词处理，命中集塌缩成几条不相关的文章。模型沿用上一档的查询串就会踩到，所以
   * description 里明写要改写成纯关键词或 `TITLE_ABS:`。
   *
   * 参数：
   * - query (string, 必填)：按待验证论断自拟的检索词（英文效果最好；用纯关键词或
   *   EPMC 字段如 TITLE_ABS:，不要带 PubMed 的 [tiab]/[MeSH Terms]）
   * - maxResults (integer, 可选)：返回篇数，默认 5、cap 10
   */
  ctx.tools.register(
    defineTool({
      name: 'europepmc_search',
      timeoutMs: 60000,
      category: 'literature',
      description:
        'Use only after pubmed_search has errored or returned no hits. Searches Europe PMC, a PubMed ' +
        'superset including preprints and PMC full texts, for retrievable evidence that supports or ' +
        'challenges the specific claim or observation you are assessing. Choose keywords from the claim ' +
        '(molecule/synonyms, tissue, modality, outcome); broaden an over-constrained query before giving up. ' +
        'Do not carry PubMed field syntax over: Europe PMC does not understand [tiab] or [MeSH Terms] and ' +
        'silently treats them as noise words instead of erroring, which collapses the hit set and returns ' +
        'irrelevant papers. Rewrite the query as plain keywords, or use Europe PMC fields such as TITLE_ABS:. ' +
        'Returns title, journal, year, identifiers (PMID/PMCID/DOI), an abstract excerpt of up to 600 ' +
        'characters, and a full-text link for open-access entries with a PMCID. Each result exposes ' +
        'paper_ids (PMID, PMCID, DOI, provider id) for cross-provider exclusion. If this call errors or ' +
        'returns no hits, fall back to web_search. Both literature sources returning nothing means no ' +
        'literature was found; both erroring is a coverage gap — neither means the claim is wrong. Verify ' +
        'the abstract supports any claim you cite; title-only or irrelevant abstracts do not count. If a ' +
        'successful discovery search has no supporting abstract, make one complementary second search: drop ' +
        'the narrowest terms (modality and outcome first, keep molecule + tissue) and pass all first-pass ' +
        'paper_ids in excludeIds, then stop. Re-running the same over-constrained terms with exclusions only ' +
        'returns more of the same off-target set. Broaden on off-claim hits too, not only on zero hits.',
      parameters: {
        query: {
          type: 'string',
          required: true,
          description:
            'Europe PMC search expression built from the claim being checked; plain keywords or Europe PMC fields (TITLE_ABS:), never PubMed [tiab]/[MeSH Terms] tags; English works best; must be non-empty.',
        },
        maxResults: {
          type: 'integer',
          description: 'Max non-excluded papers returned, default 5, clamped 1–10.',
        },
        excludeIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional PMID, PMCID, DOI, or Provider:SOURCE:ID identifiers to exclude from a complementary second search.',
        },
      },
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      async execute(args, exec) {
        return europepmcSearch(
          args.query!,
          args.maxResults ?? 5,
          exec.signal,
          args.excludeIds ?? [],
        )
      },
    }),
  )
}

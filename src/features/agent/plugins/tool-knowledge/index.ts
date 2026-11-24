/**
 * 化学与代谢物信息只读工具集：PubChem、ChEBI 与 HMDB Wayback 档案查询。
 * 文献工具见 tool-literature；KEGG 系列见 tool-kegg。
 * 结果按预算分页，完整证据可从会话存档取回；上游错误由 ToolRuntime 回喂模型。
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  defineTool,
  renderBatch,
  batchPageParameters,
  excerpt,
  getJson,
  isPng,
  pngDataUrl,
  pngDimensions,
  take,
  MAX_BATCH_QUERIES,
  EVIDENCE_BATCH_BUDGET,
  TOOL_RESULT_CHARS_EVIDENCE,
} from '../tools'
import type { ToolImage } from '../llm'
import { hmdbLookupById } from './hmdb'

const PUBCHEM_BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug'
const PUBCHEM_VIEW_BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug_view'
const OLS4_BASE = 'https://www.ebi.ac.uk/ols4/api'

/** 附件管线一次最多 4 张图，结构图每个名字一张，所以 withImage 的批量上限就是 4。 */
const MAX_STRUCTURE_IMAGES = 4

interface PubChemFormulaProperty {
  CID?: string | number
  MolecularFormula?: string
  MonoisotopicMass?: number | string
  InChIKey?: string
}

interface OlsChebiDoc {
  iri?: string
  short_form?: string
  label?: string
  obo_id?: string
  synonym?: unknown[]
  description?: string | string[]
}

// ---- PubChem ----

/**
 * PUG-View 的 Record Description：PubChem 唯一的叙述性生物学摘要（来源如 DrugBank、
 * HMDB、E. coli/酵母代谢物注释）。属性端点只给分子式与标识符，答不了"这是什么、
 * 在生物体里干什么"。递归找 TOCHeading 命中即可，不依赖固定嵌套层数。
 */
interface PugViewSection {
  TOCHeading?: string
  Section?: PugViewSection[]
  Information?: { Name?: string; Value?: { StringWithMarkup?: { String?: string }[] } }[]
}

function recordDescription(view: unknown): string {
  const strings: string[] = []
  const collect = (node: PugViewSection) => {
    for (const info of node.Information ?? []) {
      // "See Also" 是导航项（"annotation moved to … View More"），不是描述正文
      if (info?.Name === 'See Also') continue
      for (const item of info?.Value?.StringWithMarkup ?? []) {
        if (typeof item?.String === 'string') strings.push(item.String)
      }
    }
    for (const section of node.Section ?? []) collect(section)
  }
  const find = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const section = node as PugViewSection
    if (section.TOCHeading === 'Record Description') {
      collect(section)
      return
    }
    for (const value of Object.values(node)) find(value)
  }
  find(view)
  return excerpt(strings.join(' '), 2000)
}

/** 按名称查询化合物：属性 + 生物学描述 + 同义词摘要。CID 一并回传，供结构图使用。 */
async function pubchemLookupRecord(
  name: string,
  signal?: AbortSignal,
): Promise<{ text: string; cid: number }> {
  if (!name.trim()) throw new Error('Provide a nonempty compound name')
  const enc = encodeURIComponent(name.trim())
  const propsUrl = `${PUBCHEM_BASE}/compound/name/${enc}/property/MolecularFormula,InChIKey/JSON`
  const props = (await getJson(propsUrl, { signal }))?.PropertyTable?.Properties?.[0]
  if (!props) throw new Error(`No compound found for name "${name}"`)

  const lines = [
    `name: ${name}`,
    `cid: ${props.CID}`,
    `formula: ${props.MolecularFormula}`,
    `inchikey: ${props.InChIKey}`,
  ]

  // 描述与同义词各走一个端点；失败不致命（属性已足够），但取消必须冒泡
  try {
    const view = await getJson(
      `${PUBCHEM_VIEW_BASE}/data/compound/${props.CID}/JSON?heading=Record%20Description`,
      { signal },
    )
    const description = recordDescription(view)
    if (description) lines.push(`description: ${description}`)
  } catch {
    signal?.throwIfAborted() // Cancellation must not become a successful partial result.
  }

  try {
    const syn = (
      await getJson(`${PUBCHEM_BASE}/compound/cid/${props.CID}/synonyms/JSON`, { signal })
    )?.InformationList?.Information?.[0]?.Synonym
    const top = take(syn ?? [], 10) as string[]
    if (top.length > 0) lines.push(`synonyms: ${top.join('; ')}`)
  } catch {
    signal?.throwIfAborted() // Cancellation must not become a successful partial result.
  }

  lines.push(`page: https://pubchem.ncbi.nlm.nih.gov/compound/${props.CID}`)
  lines.push(`source: https://pubchem.ncbi.nlm.nih.gov/compound/${props.CID}`)
  return { text: lines.join('\n'), cid: Number(props.CID) }
}

/** 按名称查询化合物：属性 + 生物学描述 + 同义词摘要 */
export async function pubchemLookupCompound(name: string, signal?: AbortSignal): Promise<string> {
  return (await pubchemLookupRecord(name, signal)).text
}

/**
 * 官方 PUG REST `compound/cid/<CID>/PNG`：该 CID 的二维结构图，与文本记录同源同 CID，
 * 所以图与分子式/InChIKey 天然对得上。UI 的 PubChem 对话框用的是同一个端点。
 * 显式要 500×500：默认与 `image_size=large` 都只给 300×300，键长与立体标记会看不清。
 */
export async function pubchemStructureImage(
  cid: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(cid) || cid <= 0) throw new Error('Provide a PubChem CID')
  const url = `${PUBCHEM_BASE}/compound/cid/${cid}/PNG?image_size=500x500`
  const timeout = AbortSignal.timeout(20_000)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  let response: Response
  let bytes: Uint8Array
  try {
    response = await fetch(url, { signal: combined, headers: { Accept: 'image/png' } })
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    signal?.throwIfAborted()
    throw new Error(`structure image request failed (network/timeout): ${(error as Error).message}`)
  }
  signal?.throwIfAborted()
  if (!response.ok) throw new Error(`structure image HTTP ${response.status}`)
  if (!isPng(bytes)) throw new Error('structure image response was not a PNG')
  // Same decoded-size ceiling the attachment pipeline enforces; fail with a readable reason.
  if (bytes.length > 2 * 1024 * 1024)
    throw new Error('structure image exceeds the 2 MB image limit')
  return bytes
}

/** 按分子式检索化合物：返回公式匹配的候选列表（含精确质量） */
export async function pubchemSearchFormula(
  formula: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<string> {
  if (!formula.trim()) throw new Error('Provide a nonempty molecular formula')
  const enc = encodeURIComponent(formula.trim())
  const url = `${PUBCHEM_BASE}/compound/fastformula/${enc}/property/MolecularFormula,MonoisotopicMass,InChIKey/JSON`
  const props = (await getJson(url, { signal }))?.PropertyTable?.Properties
  const items: PubChemFormulaProperty[] = Array.isArray(props) ? props : []
  if (items.length === 0) throw new Error(`No compound found for formula "${formula}"`)

  const lines = [
    `total_matches: ${items.length}`,
    'top matches (cid | formula | monoisotopic_mass | inchikey):',
  ]
  for (const p of items.slice(0, maxResults)) {
    lines.push(
      `- ${p.CID} | ${p.MolecularFormula} | ${p.MonoisotopicMass} | ${p.InChIKey} | page: https://pubchem.ncbi.nlm.nih.gov/compound/${p.CID}`,
    )
  }
  if (items.length > maxResults) lines.push(`(…and ${items.length - maxResults} more)`)
  lines.push(`source: https://pubchem.ncbi.nlm.nih.gov/#query=${enc}`)
  return lines.join('\n')
}

// ---- ChEBI（生物角色，在线 OLS4） ----

// OLS4 may return the OBO identifier as CHEBI_123 or CHEBI:123. Keep the
// canonical ChEBI form used elsewhere in the app and by searchId.do links.
function normalizeChebiId(value: unknown): string | undefined {
  const match = /^CHEBI[:_](\d+)$/i.exec(String(value ?? '').trim())
  return match ? `CHEBI:${match[1]}` : undefined
}

/** ChEBI 检索：标签/CHEBI id/描述/同义词摘要（化学本体的"这是什么功能的分子"） */
export async function chebiLookup(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<string> {
  if (!query.trim()) throw new Error('Provide a nonempty ChEBI query')
  const n = Math.min(Math.max(maxResults, 1), 10)
  const url = `${OLS4_BASE}/search?q=${encodeURIComponent(query)}&ontology=chebi&rows=${n}`
  const data = await getJson(url, { signal })
  const rawDocs = data?.response?.docs
  const docs: OlsChebiDoc[] = Array.isArray(rawDocs) ? rawDocs : []
  if (docs.length === 0) return `No ChEBI terms match "${query}".`

  const lines = docs.map((d) => {
    const iri = String(d.iri ?? '')
    const id =
      [d.short_form, d.obo_id, iri.split('/').pop()]
        .map(normalizeChebiId)
        .find((candidate): candidate is string => candidate !== undefined) ?? ''
    const label = d.label ?? (id || d.obo_id || '')
    const parts = [`- ${label}${id ? ` (${id})` : ''}`]
    if (id) parts.push(`| page: https://www.ebi.ac.uk/chebi/searchId.do?chebiId=${id}`)
    const syn = take(d.synonym ?? [], 4)
    if (syn.length > 0) parts.push(`| syn: ${syn.join('; ')}`)
    const def = Array.isArray(d.description) ? d.description[0] : d.description
    if (def) parts.push(`\n  ${String(def).slice(0, 220)}`)
    return parts.join(' ')
  })
  lines.push('source: ChEBI via EBI OLS4 (https://www.ebi.ac.uk/chebi, Hastings et al. NAR)')
  return lines.join('\n')
}

// ---- 插件 ----

/**
 * 工具面向注释验证与文献佐证：模型在写生物学解读/报告时用它们核对分子身份
 * 与检索文献，避免凭记忆编造（hallucination）。
 */
export const name = 'tool-knowledge'
export const inject = ['tools']

export function apply(ctx: Context) {
  /**
   * pubchem_compound_lookup —— 按名称查 PubChem 化合物。
   *
   * 作用：分子式、InChIKey、**Record Description 生物学摘要**（PUG-View，≤2000 字符）、
   * 同义词摘要（≤10）与官方 PubChem 页面链接。描述与同义词各走独立端点、失败不致命。
   * 用于综合核对候选注释或获取分子事实。批量：多个名称一次传 names，单个失败不拖垮整批。
   * 每个名字最多 3 个上游请求（属性 + 描述 + 同义词），PubChem 限 5 req/s；
   * withImage 时再加一个结构图请求。
   *
   * 参数：
   * - names (string[], 必填)：批量形式（≤25）
   * - withImage (boolean, 可选)：附该 CID 的二维结构图 PNG；开启时 names 只能 1–4 个、
   *   且不接受 offset/limit（附件管线一次最多 4 张图）。图取不到不影响文本。
   * - offset / limit (integer, 可选)：批量输入分页（Evidence 语义：默认 5、cap 8）
   */
  ctx.tools.register(
    defineTool({
      name: 'pubchem_compound_lookup',
      timeoutMs: 60000,
      category: 'chemistry',
      description:
        'Look up named chemical compounds on PubChem when candidate identity or biological context is needed. ' +
        'Returns the queried name, CID, formula, InChIKey, a narrative Record Description (up to 2000 characters), ' +
        'up to 10 synonyms and the official CID page. Judge identity from the returned record as a whole: ' +
        'whether the name/synonyms actually denote the intended candidate, formula consistency, structural ' +
        'identifier and narrative context. Formula alone is not identity proof, and a name hit alone does not ' +
        'establish identity. Library masses are not returned because they derive from the same formula and add ' +
        'no independent evidence. Batch with "names"; one failed name does not block the rest. ' +
        'Add withImage=true to attach the 2D structure of each returned CID as a PNG, so the report can show ' +
        'the molecule instead of only linking its record page; the image comes from the same CID as the text, ' +
        'so it depicts whatever the name actually resolved to — check the identity first. withImage accepts ' +
        '1–4 names and no offset/limit. A missing image never invalidates the text.',
      parameters: {
        ...batchPageParameters,
        offset: {
          type: 'integer',
          description:
            'Zero-based start into the batch name inputs (default 0); continue with nextOffset. Not allowed with withImage.',
        },
        limit: {
          type: 'integer',
          description:
            'Names processed per page, default 5, max 8; this pages inputs, not synonyms. Not allowed with withImage.',
        },
        names: {
          type: 'array',
          items: { type: 'string' },
          maxItems: MAX_BATCH_QUERIES,
          required: true,
          description: 'Batch compound names, each queried independently.',
        },
        withImage: {
          type: 'boolean',
          description:
            'Attach each returned CID’s 2D structure PNG (default false). Requires 1–4 names and no offset/limit.',
        },
      },
      async execute(args, exec) {
        const names = args.names
        if (names.length === 0) throw new Error('Provide "names"')
        if (args.withImage !== true) {
          return renderBatch(
            names,
            (n) => n,
            (n) => pubchemLookupCompound(n, exec.signal),
            { ...args, session: exec.session, signal: exec.signal },
          )
        }
        if (names.length > MAX_STRUCTURE_IMAGES) {
          throw new Error(
            `withImage accepts 1–${MAX_STRUCTURE_IMAGES} names (one image each); look up the rest without withImage`,
          )
        }
        if (args.offset !== undefined || args.limit !== undefined) {
          throw new Error('withImage does not paginate; pass 1–4 names without offset/limit')
        }
        // renderBatch keeps the per-name error handling and archive behaviour; the CID
        // of each successful lookup is captured so the image matches the returned record.
        const cids = new Map<string, number>()
        const text = await renderBatch(
          names,
          (n) => n,
          async (n) => {
            const record = await pubchemLookupRecord(n, exec.signal)
            cids.set(n, record.cid)
            return record.text
          },
          { session: exec.session, signal: exec.signal },
        )
        const images: ToolImage[] = []
        const unavailable: string[] = []
        for (const [name, cid] of cids) {
          exec.signal?.throwIfAborted()
          try {
            const bytes = await pubchemStructureImage(cid, exec.signal)
            const { width, height } = pngDimensions(bytes)
            images.push({
              dataUrl: pngDataUrl(bytes),
              mime: 'image/png',
              width,
              height,
              label: `${name} (PubChem CID ${cid})`,
            })
          } catch (error) {
            exec.signal?.throwIfAborted()
            unavailable.push(
              `- ${name} (CID ${cid}): ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
        const body = unavailable.length
          ? `${text}\n\nstructure images unavailable (text above is unaffected; link the CID page instead):\n${unavailable.join('\n')}`
          : text
        return images.length ? { text: body, images } : body
      },
      output: {
        render: (_args, value) => (typeof value === 'string' ? value : value.text),
        images: (_args, value) => (typeof value === 'string' ? undefined : value.images),
      },
    }),
  )

  /**
   * pubchem_formula_search —— 按分子式检索 PubChem 候选化合物。
   *
   * 作用：列出分子式匹配的候选（CID、分子式、单同位素质量、InChIKey），每条带自身
   * CID 的官方页面链接；报告 total_matches 与窗口外剩余数。用于 m/z 注释中在加合物
   * 匹配前枚举分子式候选。
   *
   * 参数：
   * - formula (string, 必填)：分子式，如 "C18H36O2"
   * - maxResults (integer, 可选)：返回候选数，默认 15、cap 25
   */
  ctx.tools.register(
    defineTool({
      name: 'pubchem_formula_search',
      category: 'chemistry',
      description:
        'Search PubChem by molecular formula when enumerating candidate compounds, especially before ' +
        'adduct matching in m/z annotation. Returns the total match count and up to maxResults candidates ' +
        'with CID, formula, monoisotopic mass, InChIKey and per-CID official page links. Treat the list as ' +
        'candidates: one formula may match multiple structures; a miss raises a query error.',
      parameters: {
        formula: {
          type: 'string',
          required: true,
          description: 'Molecular formula to search, e.g. "C18H36O2".',
        },
        maxResults: {
          type: 'integer',
          description: 'Max candidates returned, default 15, clamped 1–25.',
        },
      },
      async execute(args, exec) {
        return pubchemSearchFormula(
          args.formula!,
          Math.min(Math.max(args.maxResults ?? 15, 1), 25),
          exec.signal,
        )
      },
    }),
  )

  /**
   * chebi_lookup —— ChEBI 本体检索（在线 EBI OLS4）。
   *
   * 作用：回答“这个分子在生物角色上是什么”（如 antioxidant / xenobiotic
   * metabolite）：标签、同义词（≤4）、定义摘录（≤220 字符）、CHEBI 编号与官方页面
   * 链接（ID 优先取 short_form，缺失回退 IRI 末段）。结果按 OLS4 相关性排序、不是
   * 身份验证——第一条不保证是查询分子（可能是衍生物），需自行核对返回标签；身份
   * 核验综合 kegg_compound 或 pubchem_compound_lookup 的返回记录，不只比对分子式。
   * 批量：多个查询一次传 queries。
   *
   * 参数：
   * - queries (string[], 必填)：批量名称或 CHEBI 编号片段（≤25）
   * - maxResults (integer, 可选)：每查询返回词条数，默认 5、cap 10
   * - offset / limit (integer, 可选)：批量输入分页
   */
  ctx.tools.register(
    defineTool({
      name: 'chebi_lookup',
      timeoutMs: 60000,
      category: 'chemistry',
      description:
        "Search the ChEBI ontology (online, EBI OLS4) when a compound's ontology label, biological role, " +
        'definition or related terms are needed. Returns relevance-ranked terms with labels, synonyms, ' +
        'definition excerpts, CHEBI ids and official page links. Review the returned labels: relevance ' +
        'ranking is not identity verification, and the first hit may be a derivative or related compound. ' +
        'For identity checks synthesize the returned record from kegg_compound or pubchem_compound_lookup, not formula alone.',
      parameters: {
        ...batchPageParameters,
        offset: {
          type: 'integer',
          description:
            'Zero-based start into the batch query inputs (default 0); continue with nextOffset.',
        },
        limit: {
          type: 'integer',
          description: 'Queries processed per page, default 5, max 8; pages inputs.',
        },
        queries: {
          type: 'array',
          items: { type: 'string' },
          maxItems: MAX_BATCH_QUERIES,
          required: true,
          description: 'Batch names or CHEBI id fragments, each searched independently.',
        },
        maxResults: {
          type: 'integer',
          description: 'Max ChEBI terms per query, default 5, clamped 1–10.',
        },
      },
      async execute(args, exec) {
        const queries = args.queries
        if (queries.length === 0) throw new Error('Provide "queries"')
        const max = Math.min(Math.max(args.maxResults ?? 5, 1), 10)
        return renderBatch(
          queries,
          (q) => q,
          (q) => chebiLookup(q, max, exec.signal),
          { ...args, session: exec.session, signal: exec.signal },
        )
      },
    }),
  )

  /**
   * hmdb_lookup —— HMDB 代谢物查询（Internet Archive Wayback 官方 XML 档案）。
   *
   * 作用：ID 模式按 accession 读归档 XML 的完整档案：update_date、主名/同义词、
   * IUPAC 与传统 IUPAC 名、分子式与精确/平均质量、SMILES/InChI/InChIKey、
   * description（≤1000 字符、按句界截断）、chemical taxonomy（界>超类>类>子类>直接
   * 父类、分子骨架、替代父类/取代基）、Role 树的叶子术语、组织/细胞定位/生物标本/
   * 通路（名称 + KEGG map id，便于接着查成员或通路图）、normal concentrations
   * （生物流体、数值、单位、年龄/性别/状态、首条文献），
   * 以及 External Links 的全部 `*_id`；输出行统一使用 HMDB 代谢物页面的字段标签
   * （Common Name / Traditional Name / InChI Identifier / KEGG Compound ID 等），
   * 附规范 page 与快照时间；档案 XML 经同源中继
   * /hmdb-archive/<id>.xml 取回（服务端跟随 Wayback 2id_ 重定向），绕开归档站
   * 缺失的 CORS 头；网络/中继失败固定降级为链接模式（给 page+archive 链接，不脑补）。
   * m/z 检索改用 kegg_mass_search。批量：一次传 ids。
   *
   * 参数：
   * - ids (string[], 必填)：HMDB accession（如 "HMDB0003502"），逐个串行取（≤25）
   * - offset / limit (integer, 可选)：批量输入分页
   */
  ctx.tools.register(
    defineTool({
      name: 'hmdb_lookup',
      timeoutMs: 120_000,
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      category: 'biology',
      description:
        'Look up HMDB metabolites by accession in archived official XML via the Internet Archive Wayback ' +
        'Machine. Returns the recorded profile — Record Information, Metabolite Identification, chemical ' +
        'taxonomy, Role terms, biological properties, normal concentrations and external links — with the ' +
        'canonical HMDB page and archive snapshot time. Pathway lines carry the KEGG map id, so membership ' +
        'can be checked with kegg_pathway(membersOf=[...]) and the map image fetched with ' +
        'kegg_pathway(ids=[...], withImage=true) without guessing a map from its name. Lines carry the HMDB ' +
        'metabolite page labels so they map straight to the page. Query by accession only; name-based candidate ' +
        'discovery is not part of this tool. Archive XML is fetched through the application same-origin relay ' +
        '(the archive sends no browser CORS headers); on network/relay failure the tool degrades to link-only ' +
        'output and never invents HMDB data. For m/z candidate search use kegg_mass_search instead. BATCHING: ' +
        'use "ids" in ONE call; send only 2–3 accessions per call because each archive fetch can take up to ' +
        '20 s (a transient gateway error retries once, so one accession can take ~42 s) under a 70 s soft deadline.',
      parameters: {
        ...batchPageParameters,
        offset: {
          type: 'integer',
          description:
            'Zero-based start into the batch id inputs (default 0); continue with nextOffset.',
        },
        limit: {
          type: 'integer',
          description: 'Inputs processed per page, default 5, max 8; pages the id batch.',
        },
        ids: {
          type: 'array',
          items: { type: 'string' },
          maxItems: MAX_BATCH_QUERIES,
          required: true,
          description: 'Up to 25 accessions, fetched sequentially; send 2–3 per call in practice.',
        },
      },
      async execute(args, exec) {
        // Keep the raw strings: validity is enforced per item inside the render
        // callback (renderBatch isolates a bad id instead of failing the batch).
        const ids = args.ids
        if (ids.length === 0) {
          throw new Error('Provide "ids" (HMDB accession)')
        }
        const items = ids.map((id) => ({ kind: 'id' as const, value: id }))
        // 70s soft budget inside the 120s tool timeout via renderBatch's
        // deadline: items that would start past it are left for the next page
        // (nextOffset footer) instead of being degraded in place — a degraded
        // id rendered as "done" would be skipped forever when the model
        // follows the footer. The 50s margin must cover the WORST single item,
        // which since the bounded retry is pace + 20s + backoff + pace + 20s
        // ≈ 42s (plus queue contention from concurrent calls). At 90s an item
        // starting just under the deadline could run past 120s, and the runtime
        // timeout would discard every profile already rendered in the page.
        const deadline = Date.now() + 70_000
        return renderBatch(
          items,
          (item) => item.value,
          (item) => hmdbLookupById(item.value, exec.signal),
          {
            ...args,
            ...EVIDENCE_BATCH_BUDGET,
            deadline,
            session: exec.session,
            signal: exec.signal,
          },
        )
      },
    }),
  )
}

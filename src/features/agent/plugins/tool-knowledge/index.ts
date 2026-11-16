/**
 * 化学与代谢物信息只读工具集：PubChem、ChEBI 与 HMDB Wayback 档案查询。
 * 文献工具见 tool-literature；KEGG 系列见 tool-kegg。
 * 结果按预算分页，完整证据可从会话存档取回；上游错误由 ToolRuntime 回喂模型。
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  defineTool,
  batchInput,
  renderBatch,
  batchPageParameters,
  getJson,
  take,
  MAX_BATCH_QUERIES,
  EVIDENCE_BATCH_BUDGET,
  TOOL_RESULT_CHARS_EVIDENCE,
} from '../tools'
import { hmdbLookupById, hmdbLookupByName } from './hmdb'

const PUBCHEM_BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug'
const OLS4_BASE = 'https://www.ebi.ac.uk/ols4/api'

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

/** 按名称查询化合物：属性 + 同义词摘要 */
export async function pubchemLookupCompound(name: string, signal?: AbortSignal): Promise<string> {
  if (!name.trim()) throw new Error('Provide a nonempty compound name')
  const enc = encodeURIComponent(name.trim())
  const propsUrl = `${PUBCHEM_BASE}/compound/name/${enc}/property/MolecularFormula,MonoisotopicMass,MolecularWeight,ConnectivitySMILES,InChIKey,IUPACName/JSON`
  const props = (await getJson(propsUrl, { signal }))?.PropertyTable?.Properties?.[0]
  if (!props) throw new Error(`No compound found for name "${name}"`)

  const lines = [
    `name: ${name}`,
    `cid: ${props.CID}`,
    `formula: ${props.MolecularFormula}`,
    `monoisotopic_mass: ${props.MonoisotopicMass}`,
    `average_mass: ${props.MolecularWeight ?? props.AverageMass}`,
    `iupac_name: ${props.IUPACName}`,
    `smiles: ${props.ConnectivitySMILES ?? props.CanonicalSMILES}`,
    `inchikey: ${props.InChIKey}`,
  ]

  // 同义词单独一个端点；失败不致命（属性已足够）
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
  return lines.join('\n')
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
   * 作用：分子式、精确（单同位素）质量、平均质量、IUPAC 名、SMILES/InChIKey、同义词
   * 摘要（≤10，独立端点、失败不致命）与官方 PubChem 页面链接（可直接引用或交给用户）。
   * 用于核对候选注释或获取分子事实。批量：多个名称一次传 names，单个失败不拖垮整批。
   *
   * 参数：
   * - name (string, 可选)：单个名称，如 "PC(16:0/18:1)" 或 "glucose"
   * - names (string[], 可选)：批量形式（≤25）
   * - offset / limit (integer, 可选)：批量输入分页（Evidence 语义：默认 5、cap 8）
   */
  ctx.tools.register(
    defineTool({
      name: 'pubchem_compound_lookup',
      timeoutMs: 60000,
      category: 'chemistry',
      description:
        'Look up a named chemical compound on PubChem when molecular properties are needed or an annotation ' +
        'candidate must be checked. Returns formula, monoisotopic and average mass, IUPAC name, SMILES, ' +
        'InChIKey, up to 10 synonyms and the official CID page. Cross-check the returned properties against ' +
        'the candidate; a name hit alone does not establish identity. Batch with "names"; one failed name ' +
        'does not block the rest.',
      parameters: {
        ...batchPageParameters,
        offset: {
          type: 'integer',
          description:
            'Zero-based start into the batch name inputs (default 0); continue with nextOffset.',
        },
        limit: {
          type: 'integer',
          description:
            'Names processed per page, default 5, max 8; this pages inputs, not synonyms.',
        },
        name: {
          type: 'string',
          description:
            'Single compound name, e.g. "PC(16:0/18:1)" or "glucose"; use "names" for several.',
        },
        names: {
          type: 'array',
          items: 'string',
          maxItems: MAX_BATCH_QUERIES,
          description: 'Batch compound names, each queried independently.',
        },
      },
      async execute(args, exec) {
        const names = batchInput<string>(args.names, args.name)
        if (names.length === 0) throw new Error('Provide "name" or "names"')
        return renderBatch(
          names,
          (n) => n,
          (n) => pubchemLookupCompound(n, exec.signal),
          { ...args, session: exec.session, signal: exec.signal },
        )
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
   * 核验用 kegg_compound（FORMULA/EXACT_MASS）或 pubchem_compound_lookup。
   * 批量：多个查询一次传 queries。
   *
   * 参数：
   * - query (string, 可选)：单个名称或 CHEBI 编号片段
   * - queries (string[], 可选)：批量形式（≤25）
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
        'For identity checks compare formula and exact mass via kegg_compound or pubchem_compound_lookup.',
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
        query: {
          type: 'string',
          description: 'Single compound name or CHEBI id fragment; use "queries" for several.',
        },
        queries: {
          type: 'array',
          items: 'string',
          maxItems: MAX_BATCH_QUERIES,
          description: 'Batch names or id fragments, each searched independently.',
        },
        maxResults: {
          type: 'integer',
          description: 'Max ChEBI terms per query, default 5, clamped 1–10.',
        },
      },
      async execute(args, exec) {
        const queries = batchInput<string>(args.queries, args.query)
        if (queries.length === 0) throw new Error('Provide "query" or "queries"')
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
   * 通路、normal concentrations（生物流体、数值、单位、年龄/性别/状态、首条文献），
   * 以及 External Links 的全部 `*_id`；输出行统一使用 HMDB 代谢物页面的字段标签
   * （Common Name / Traditional Name / InChI Identifier / KEGG Compound ID 等），
   * 附规范 page 与快照时间；档案 XML 经同源中继
   * /hmdb-archive/<id>.xml 取回（服务端跟随 Wayback 2id_ 重定向），绕开归档站
   * 缺失的 CORS 头；网络/中继失败固定降级为链接模式（给 page+archive 链接，不脑补）。
   * 名称模式用 Exa 发现候选 HMDB 编号（调用方核对后再按 id 查详情）。m/z 检索改用
   * kegg_mass_search。批量：一次传 ids 或 queries。
   *
   * 参数：
   * - id / ids (string / string[], 可选)：HMDB accession（如 "HMDB0003502"），
   *   ids 逐个串行取（≤25）
   * - query / queries (string / string[], 可选)：代谢物名称，走 Exa 候选编号发现
   * - offset / limit (integer, 可选)：批量输入分页
   */
  ctx.tools.register(
    defineTool({
      name: 'hmdb_lookup',
      timeoutMs: 120_000,
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      category: 'biology',
      description:
        'Look up an HMDB metabolite by accession in archived official XML via the Internet Archive ' +
        'Wayback Machine. Returns the recorded profile — Record Information (HMDB id, update date), ' +
        'Metabolite Identification (common name, description truncated to 1000 characters, synonyms, ' +
        'formula and masses, IUPAC/traditional name, CAS, SMILES/InChI/InChIKey), chemical taxonomy, ' +
        'Role terms, biological properties, normal concentrations and external links to other databases ' +
        '— with the canonical HMDB page and archive snapshot time. Lines carry the HMDB metabolite page ' +
        'labels (Common Name, Traditional Name, InChI Identifier, KEGG Compound ID, …) so they map ' +
        'straight to the page. Query by accession for the full profile; when only a name is known, a ' +
        'name query discovers candidate HMDB ids — review the candidates, then query by id. Archive XML ' +
        'is fetched through the application same-origin relay (the archive sends no browser CORS ' +
        'headers); on network/relay failure the tool degrades to link-only output and never invents HMDB ' +
        'data. For m/z candidate search use kegg_mass_search instead. BATCHING: use "ids" or "queries" ' +
        'in ONE call.',
      parameters: {
        ...batchPageParameters,
        offset: {
          type: 'integer',
          description:
            'Zero-based start into the batch id/name inputs (default 0); continue with nextOffset.',
        },
        limit: {
          type: 'integer',
          description:
            'Inputs processed per page, default 5, max 8; pages the combined id+name batch.',
        },
        id: {
          type: 'string',
          description: 'Single HMDB accession, e.g. "HMDB0003502"; use "ids" for several.',
        },
        ids: {
          type: 'array',
          items: 'string',
          maxItems: MAX_BATCH_QUERIES,
          description: 'Up to 25 accessions, fetched sequentially; combinable with name queries.',
        },
        query: {
          type: 'string',
          description:
            'Single metabolite name for candidate-id discovery; the result is candidate ids, not confirmed identity.',
        },
        queries: {
          type: 'array',
          items: 'string',
          maxItems: MAX_BATCH_QUERIES,
          description: 'Up to 25 names, each resolved to candidate accessions for review.',
        },
      },
      async execute(args, exec) {
        // Keep the raw strings: validity is enforced per item inside the render
        // callback (renderBatch isolates a bad id instead of failing the batch).
        const ids = batchInput<string>(args.ids, args.id)
        const queries = batchInput<string>(args.queries, args.query)
        if (ids.length === 0 && queries.length === 0) {
          throw new Error('Provide "id"/"ids" (HMDB accession) or "query"/"queries" (name)')
        }
        const items = [
          ...ids.map((id) => ({ kind: 'id' as const, value: id })),
          ...queries.map((query) => ({ kind: 'name' as const, value: query })),
        ]
        // 90s soft budget inside the 120s tool timeout via renderBatch's
        // deadline: items that would start past it are left for the next page
        // (nextOffset footer) instead of being degraded in place — a degraded
        // id rendered as "done" would be skipped forever when the model
        // follows the footer.
        const deadline = Date.now() + 90_000
        return renderBatch(
          items,
          (item) => item.value,
          (item) =>
            item.kind === 'id'
              ? hmdbLookupById(item.value, exec.signal)
              : hmdbLookupByName(item.value, exec.signal),
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

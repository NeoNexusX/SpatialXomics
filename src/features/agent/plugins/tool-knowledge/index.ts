/**
 * 化学信息只读工具集：PubChem 化合物/分子式查询与 ChEBI 本体检索。
 * 文献工具见 tool-literature；HMDB 与 KEGG 通路工具见 tool-bio。
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
} from '../tools'

const PUBCHEM_BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug'
const OLS4_BASE = 'https://www.ebi.ac.uk/ols4/api'

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
  const items: any[] = Array.isArray(props) ? props : []
  if (items.length === 0) throw new Error(`No compound found for formula "${formula}"`)

  const lines = [
    `total_matches: ${items.length}`,
    'top matches (cid | formula | monoisotopic_mass | inchikey):',
  ]
  for (const p of items.slice(0, maxResults)) {
    lines.push(`- ${p.CID} | ${p.MolecularFormula} | ${p.MonoisotopicMass} | ${p.InChIKey}`)
  }
  if (items.length > maxResults) lines.push(`(…and ${items.length - maxResults} more)`)
  lines.push(`source: https://pubchem.ncbi.nlm.nih.gov/#query=${enc}`)
  return lines.join('\n')
}

// ---- ChEBI（生物角色，在线 OLS4） ----

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
  const docs: any[] = data?.response?.docs ?? []
  if (docs.length === 0) return `No ChEBI terms match "${query}".`

  const lines = docs.map((d) => {
    const iri = String(d.iri ?? '')
    const id = iri.split('/').pop() ?? d.short_form ?? ''
    const label = d.label ?? d.obo_id ?? id
    const parts = [`- ${label}${id ? ` (${id})` : ''}`]
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
  ctx.tools.register(
    defineTool({
      name: 'pubchem_compound_lookup',
      timeoutMs: 60000,
      category: 'chemistry',
      description:
        'Look up chemical compounds by name on PubChem: formula, exact (monoisotopic) mass, ' +
        'SMILES/InChIKey, synonyms. Use to verify candidate annotations or get molecule facts. ' +
        'BATCHING: for several compounds pass "names" (array) in ONE call instead of one call per ' +
        'compound; a name that fails does not block the rest.',
      parameters: {
        ...batchPageParameters,
        name: {
          type: 'string',
          description:
            'Single compound name, e.g. "PC(16:0/18:1)" or "glucose"; for multiple use "names"',
        },
        names: {
          type: 'array',
          items: 'string',
          maxItems: MAX_BATCH_QUERIES,
          description: 'Batch form of "name": many compound names in one call',
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

  ctx.tools.register(
    defineTool({
      name: 'pubchem_formula_search',
      category: 'chemistry',
      description:
        'Search PubChem by molecular formula: list candidate compounds with exact masses. ' +
        'Use in m/z annotation to enumerate formula candidates before adduct matching.',
      parameters: {
        formula: {
          type: 'string',
          required: true,
          description: 'Molecular formula, e.g. "C18H36O2"',
        },
        maxResults: {
          type: 'integer',
          description: 'Max candidates to return (default 15, max 25)',
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

  ctx.tools.register(
    defineTool({
      name: 'chebi_lookup',
      timeoutMs: 60000,
      category: 'chemistry',
      description:
        'Look up compounds in the ChEBI ontology (online, EBI OLS4): what a molecule IS in ' +
        'biological role terms (e.g. "antioxidant", "xenobiotic metabolite") — labels, synonyms, ' +
        'definitions, CHEBI ids. Use for the semantic/biological role layer of an identification. ' +
        'BATCHING: for several compounds pass "queries" (array) in ONE call.',
      parameters: {
        ...batchPageParameters,
        query: {
          type: 'string',
          description: 'Single compound name or CHEBI id fragment; for multiple use "queries"',
        },
        queries: {
          type: 'array',
          items: 'string',
          maxItems: MAX_BATCH_QUERIES,
          description: 'Batch form of "query": many names in one call',
        },
        maxResults: { type: 'integer', description: 'Max terms per query (default 5, max 10)' },
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
}

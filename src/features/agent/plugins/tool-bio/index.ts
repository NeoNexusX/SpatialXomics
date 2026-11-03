/**
 * Biological tools: HMDB profiles and live KEGG REST pathway queries.
 * KEGG requests go through /kegg-rest/ (Vite/nginx → rest.kegg.jp).
 * No KEGG files or HMDB index are required for pathway queries.
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  defineTool,
  batchInput,
  EVIDENCE_BATCH_BUDGET,
  renderBatch,
  batchPageParameters,
  TOOL_RESULT_CHARS_EVIDENCE,
  createLazyJsonLoader,
  DEFAULT_TOP_N,
  MAX_TOP_N,
  MAX_BATCH_QUERIES,
} from '../tools'
import { KeggClient, normalizeKeggName, compoundLink, pathwayLink, keggSource } from './kegg'
import { lowerBoundBy } from '@/shared/utils/bisect'
import { adductShiftTable } from '@/shared/chem/adducts'
import type { AnnotationRow } from '../../bridge/analysisTypes'
import { getAnnotationRows, resolveMassPolarity } from '../../bridge/analysisContext'

/** HMDB 质量检索使用的加合物位移，数值由共享元素/加合物质量表计算。 */
export const ADDUCTS: Record<'positive' | 'negative', Record<string, number>> = {
  positive: adductShiftTable(['M+H', 'M+Na', 'M+K', 'M+NH4', 'M+Li']),
  negative: adductShiftTable(['M-H', 'M+Cl', 'M+HCOO', 'M+CH3COO', 'M-2H+Na', 'M-2H+K']),
}

/** HMDB 索引行：[accession, name, formula, monoMass, keggId, tissues[], diseases[], biofunction] */
export type HmdbRow = [
  string,
  string,
  string | null,
  number,
  string | null,
  string[],
  string[],
  string | null,
]

const loadHmdbIndex = createLazyJsonLoader<HmdbRow[]>(
  'hmdb-index.json',
  () => 'HMDB offline index not found in this deployment (needs public/data/hmdb-index.json).',
)

/** 索引缺失时的统一指引文案（拼接在 loadJson 的错误信息后） */
function notBuiltHint(script: string): string {
  return ` Build it with: node scripts/${script} (see the script header for the data source), then redeploy.`
}

// ---- 检索（纯函数，供测试） ----

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s_/(),-]/g, '')
}

const hmdbSearchCache = new WeakMap<
  HmdbRow[],
  {
    names: string[]
    ids: string[]
  }
>()
const hmdbMassCache = new WeakMap<HmdbRow[], HmdbRow[]>()

function hmdbSearchIndex(rows: HmdbRow[]) {
  let cached = hmdbSearchCache.get(rows)
  if (!cached) {
    const names = rows.map((row) => norm(row[1]))
    cached = {
      names,
      ids: rows.map((row) => row[0].toLowerCase()),
    }
    hmdbSearchCache.set(rows, cached)
  }
  return cached
}

/** 一条注释的可用名（候选按来源排过序，内源在前；跳过外源候选——它们通常不进代谢通路；过滤空名） */
function annotationRowNames(row: AnnotationRow): string[] {
  const raw =
    row.candidates.length > 0
      ? row.candidates.map((c) => (/^(?:cpd:)?C\d{5}$/i.test(c.id) ? c.id : (c.name ?? '')))
      : [row.name ?? '']
  const keep = raw.filter((n, i) => {
    if (!n || !n.trim()) return false
    const o = row.candidates[i]?.origin
    return o == null || o === 'endogenous' || o === 'unknown' || o === 'expected'
  })
  const usable = keep.length > 0 ? keep : raw.filter((n) => n && n.trim())
  return [...new Set(usable)]
}

export interface PathwayHit {
  mapId: string
  name: string
  /** 命中分子式组（折叠加合离子，保留异构体不确定性） */
  formulas: string[]
}

export interface PathwayRollup {
  hits: PathwayHit[]
  mappedFormulas: number
  totalFormulas: number
  unmapped: string[]
  ambiguous: { query: string; ids: string[] }[]
  deferred: string[]
}

/** Query exact compound identities, then batch official compound→pathway links. */
export async function pathwayEnrichment(
  rows: AnnotationRow[],
  topN: number,
  signal?: AbortSignal,
): Promise<PathwayRollup> {
  const byFormula = new Map<string, AnnotationRow>()
  for (const row of [...rows].sort((a, b) => a.rank - b.rank).slice(0, topN)) {
    if (!byFormula.has(row.formula)) byFormula.set(row.formula, row)
  }
  const groups = [...byFormula.values()].map((row) => ({ row, queries: annotationRowNames(row) }))
  // Give each formula's leading candidate a turn before querying further alternatives.
  const unique = new Map<string, string>()
  const depth = Math.max(0, ...groups.map((group) => group.queries.length))
  for (let i = 0; i < depth; i++) {
    for (const group of groups) {
      const query = group.queries[i]
      if (query && !unique.has(normalizeKeggName(query)))
        unique.set(normalizeKeggName(query), query)
    }
  }
  const queries = [...unique.values()]
  const selected = queries.slice(0, 50)
  const deferred = queries.slice(50)
  const client = new KeggClient(signal)
  const matches = new Map<string, string[]>()
  const ambiguous: PathwayRollup['ambiguous'] = []
  await Promise.all(
    selected.map(async (query) => {
      const compounds = await client.findCompounds(query)
      const directId = query.trim().replace(/^cpd:/i, '').toUpperCase()
      // Do not turn broad search hits (e.g. glucose phosphates) into an identity match.
      const ids = compounds
        .filter(
          (compound) =>
            compound.id === directId ||
            compound.names.some((name) => normalizeKeggName(name) === normalizeKeggName(query)),
        )
        .map((compound) => compound.id)
      matches.set(normalizeKeggName(query), ids)
      if (ids.length > 1) ambiguous.push({ query, ids })
    }),
  )
  const links = await client.compoundPathways([...matches.values()].flat())
  const pathwayToFormulas = new Map<string, Set<string>>()
  const unmapped: string[] = []
  let mapped = 0
  for (const { row, queries } of groups) {
    const paths = new Set(
      queries.flatMap((query) =>
        (matches.get(normalizeKeggName(query)) ?? []).flatMap((id) => links.get(id) ?? []),
      ),
    )
    if (!paths.size) {
      unmapped.push(row.name || row.formula)
      continue
    }
    mapped++
    for (const id of paths) {
      if (!pathwayToFormulas.has(id)) pathwayToFormulas.set(id, new Set())
      pathwayToFormulas.get(id)!.add(row.formula)
    }
  }
  const names = new Map(await client.list([...pathwayToFormulas.keys()]))
  const hits = [...pathwayToFormulas]
    .map(([mapId, formulas]) => ({
      mapId,
      name: names.get(mapId) ?? '(name not returned by KEGG)',
      formulas: [...formulas],
    }))
    .sort((a, b) => b.formulas.length - a.formulas.length || a.name.localeCompare(b.name))
  ambiguous.sort((a, b) => a.query.localeCompare(b.query))
  return {
    hits,
    mappedFormulas: mapped,
    totalFormulas: byFormula.size,
    unmapped,
    ambiguous,
    deferred,
  }
}

/** 名称/HMDB id 子串检索 */
export function searchHmdbIndex(index: HmdbRow[], query: string, max: number): HmdbRow[] {
  const q = norm(query)
  if (!q) return []
  const { names, ids } = hmdbSearchIndex(index)
  const out: HmdbRow[] = []
  // Exact identities precede substring matches (glucose is not glucose phosphate).
  for (let i = 0; i < index.length; i++) {
    if (names[i] === q || ids[i] === q) {
      out.push(index[i]!)
      if (out.length >= max) return out
    }
  }
  for (let i = 0; i < index.length; i++) {
    if (names[i] !== q && ids[i] !== q && (names[i]!.includes(q) || ids[i]!.includes(q))) {
      out.push(index[i]!)
      if (out.length >= max) break
    }
  }
  return out
}

/** HMDB m/z 检索：按极性扫描常见加合物，返回质量窗口内的候选。 */
export function massSearchHmdbIndex(
  index: HmdbRow[],
  mz: number,
  polarity: 'positive' | 'negative',
  ppm: number,
  max: number,
): { row: HmdbRow; adduct: string; ppm: number }[] {
  const table = ADDUCTS[polarity]
  let sorted = hmdbMassCache.get(index)
  if (!sorted) {
    sorted = index
      .filter((row) => Number.isFinite(row[3]) && row[3] > 0)
      .sort((a, b) => a[3] - b[3])
    hmdbMassCache.set(index, sorted)
  }
  const out: { row: HmdbRow; adduct: string; ppm: number }[] = []
  const window = (mz * ppm) / 1e6
  for (const [name, shift] of Object.entries(table)) {
    const neutral = mz - shift
    for (let i = lowerBoundBy(sorted, (row) => row[3], neutral - window); i < sorted.length; i++) {
      const row = sorted[i]!
      const m = row[3]
      if (m > neutral + window) break
      if (Math.abs(m - neutral) <= window) {
        out.push({ row, adduct: name, ppm: ((m - neutral) / mz) * 1e6 })
      }
    }
  }
  out.sort((a, b) => Math.abs(a.ppm) - Math.abs(b.ppm))
  return out.slice(0, max)
}

function formatHmdbRow(r: HmdbRow, adduct?: string, ppm?: number): string {
  const parts = [`- ${r[1]} (${r[0]})`]
  if (r[2]) parts.push(`| ${r[2]}`)
  if (r[3] > 0) parts.push(`| M ${r[3]}`)
  if (r[4]) parts.push(`| KEGG ${r[4]}`)
  if (adduct) parts.push(`| ${adduct} Δ${ppm!.toFixed(1)} ppm`)
  if (r[5].length > 0) parts.push(`\n  tissues: ${r[5].slice(0, 8).join('; ')}`)
  if (r[6].length > 0) parts.push(`\n  diseases: ${r[6].slice(0, 8).join('; ')}`)
  if (r[7]) parts.push(`\n  biofunction: ${r[7]}`)
  return parts.join(' ')
}

/** HMDB 查询（名称/id 或 m/z 质量模式） */
export async function hmdbLookup(
  query: string | null,
  mz: number | null,
  polarity: 'positive' | 'negative',
  ppm: number,
  max: number,
  signal?: AbortSignal,
): Promise<string> {
  if (mz != null ? !Number.isFinite(mz) || mz <= 0 : !norm(query ?? ''))
    throw new Error('Provide a nonempty metabolite query or a positive m/z')
  let index: HmdbRow[]
  try {
    index = await loadHmdbIndex(signal)
  } catch (err) {
    throw new Error(`${(err as Error).message}${notBuiltHint('build-hmdb-index.mjs')}`)
  }

  if (mz != null) {
    const hits = massSearchHmdbIndex(index, mz, polarity, ppm, max)
    if (hits.length === 0) {
      return `No HMDB metabolites match m/z ${mz} within ${ppm} ppm (${polarity} adducts scanned).`
    }
    const lines = [`m/z ${mz} (${polarity}, ${ppm} ppm) — top HMDB metabolites:`]
    for (const h of hits) lines.push(formatHmdbRow(h.row, h.adduct, h.ppm))
    lines.push('source: HMDB (local offline index; https://hmdb.ca)')
    return lines.join('\n')
  }

  const q = query ?? ''
  const hits = searchHmdbIndex(index, q, max)
  if (hits.length === 0) {
    return `No HMDB entries match "${q}". Try a common metabolite name or an HMDB id (HMDB00001).`
  }
  const lines = hits.map((r) => formatHmdbRow(r))
  lines.push('source: HMDB (local offline index; https://hmdb.ca)')
  return lines.join('\n')
}

/** Live compound/pathway lookup, including reverse pathway membership. */
export async function keggLookup(
  query: string,
  max: number,
  signal?: AbortSignal,
): Promise<string> {
  if (!norm(query)) throw new Error('Provide a nonempty KEGG query')
  const client = new KeggClient(signal)
  const q = query.trim()
  const isCompound = /^(?:cpd:)?C\d{5}$/i.test(q)
  const isPathway = /^(?:path:)?[a-z]{2,4}\d{5}$/i.test(q) && !isCompound
  const [compounds, pathways] = await Promise.all([
    isPathway ? [] : client.findCompounds(q),
    isCompound ? [] : client.findPathways(q),
  ])
  const lines: string[] = []
  for (const [id, name] of pathways.slice(0, 3)) {
    const members = await client.pathwayCompounds(id)
    const names = await client.list(members.slice(0, max))
    lines.push(`pathway ${pathwayLink(id, name)}`)
    lines.push(
      `  compounds (showing ${names.length} of ${members.length}): ${names.map(([cid, label]) => compoundLink(cid, label.split(';')[0]!.trim())).join('; ')}`,
    )
  }
  const ranked = [...compounds].sort(
    (a, b) =>
      Number(b.names.some((n) => normalizeKeggName(n) === normalizeKeggName(q))) -
      Number(a.names.some((n) => normalizeKeggName(n) === normalizeKeggName(q))),
  )
  const selected = ranked.slice(0, 5)
  const links = await client.compoundPathways(selected.map((compound) => compound.id))
  const names = new Map(await client.list([...new Set([...links.values()].flat())]))
  for (const compound of selected) {
    const maps = links.get(compound.id) ?? []
    const exact =
      isCompound || compound.names.some((n) => normalizeKeggName(n) === normalizeKeggName(q))
    lines.push(
      `- ${compoundLink(compound.id, compound.names.slice(0, 2).join(' / '))} (${compound.id}; ${exact ? 'exact identity/synonym match' : 'keyword match only; verify identity'}) — ${maps.length} reference pathway(s)`,
    )
    for (const id of maps.slice(0, max))
      lines.push(`  ${pathwayLink(id, names.get(id) ?? 'KEGG pathway')}`)
    if (!maps.length) lines.push('  No reference pathway links returned by KEGG.')
  }
  if (!lines.length)
    lines.push(
      `No KEGG entries matched "${query}". This is a database search miss, not biological absence.`,
    )
  lines.push(keggSource())
  return lines.join('\n')
}

// ---- 插件 ----

/** 面向"这个分子在这类组织/疾病/通路里意味着什么"的解读。 */
export const name = 'tool-bio'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(
    defineTool({
      name: 'hmdb_lookup',
      category: 'biology',
      description:
        'Look up metabolites in the Human Metabolome Database (offline local index): tissue ' +
        'localization, disease associations, biological function, formula/mass, KEGG id. Query by ' +
        'name / HMDB id, or by observed m/z (+polarity) for adduct-aware mass matching of small ' +
        'molecules (non-lipid). The biology layer behind "what does this molecule do here". ' +
        'BATCHING: when checking several molecules at once, pass "queries" (array of names/ids) ' +
        'or "mzs" (array of m/z) in ONE call instead of one call per molecule.',
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      parameters: {
        ...batchPageParameters,
        query: {
          type: 'string',
          description:
            'Single metabolite name or HMDB id (e.g. "glucose", "HMDB00165"); for multiple use "queries"',
        },
        queries: {
          type: 'array',
          items: 'string',
          maxItems: MAX_BATCH_QUERIES,
          description:
            'Batch form of "query": many names/ids in one call (preferred for multiple molecules)',
        },
        mz: {
          type: 'number',
          description: 'Single observed m/z for mass-based search (needs polarity)',
        },
        mzs: {
          type: 'array',
          items: 'number',
          maxItems: MAX_BATCH_QUERIES,
          description: 'Batch form of "mz": many m/z values in one call (needs polarity)',
        },
        polarity: {
          type: 'string',
          description: 'Ion mode for mz search: "positive" or "negative"',
        },
        ppm: { type: 'integer', description: 'Mass tolerance in ppm (default 10, max 50)' },
        maxResults: { type: 'integer', description: 'Max entries per query (default 10, max 25)' },
      },
      async execute(args, exec) {
        const queries = batchInput<string>(args.queries, args.query)
        const mzs = batchInput<number>(args.mzs, args.mz)
        if (queries.length === 0 && mzs.length === 0) {
          throw new Error('Provide "query"/"queries" (name/id) or "mz"/"mzs" (+ "polarity")')
        }
        const polarity = mzs.length ? resolveMassPolarity(args.polarity) : 'positive'
        const ppm = Math.min(Math.max(args.ppm ?? 10, 1), 50)
        const max = Math.min(Math.max(args.maxResults ?? 10, 1), 25)
        const items = [
          ...queries.map((query) => ({ query, mz: null as number | null })),
          ...mzs.map((mz) => ({ query: null as string | null, mz })),
        ]
        return renderBatch(
          items,
          (item) => item.query ?? `m/z ${item.mz}`,
          (item) => hmdbLookup(item.query, item.mz, polarity, ppm, max, exec.signal),
          {
            ...args,
            ...EVIDENCE_BATCH_BUDGET,
            session: exec.session,
            signal: exec.signal,
          },
        )
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'kegg_pathway_lookup',
      timeoutMs: 120_000,
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      category: 'biology',
      description:
        'Query the official KEGG REST API live for metabolic pathways: query compound names or ' +
        'C numbers to list pathways (e.g. "what pathway is palmitic acid in"), or a pathway name/map ' +
        'id to list member compounds. Keyword matches require identity verification. ' +
        'BATCHING: for several compounds at once pass "queries" (array) in ONE call instead of one ' +
        'call per molecule.',
      parameters: {
        ...batchPageParameters,
        query: {
          type: 'string',
          description:
            'Single compound name / C number / pathway name or map id; for multiple use "queries"',
        },
        queries: {
          type: 'array',
          items: 'string',
          maxItems: MAX_BATCH_QUERIES,
          description: 'Batch form of "query": many compound names / C numbers in one call',
        },
        maxResults: {
          type: 'integer',
          description: 'Max pathways or compounds per query (default 10, max 20)',
        },
      },
      async execute(args, exec) {
        const queries = batchInput<string>(args.queries, args.query)
        if (queries.length === 0) throw new Error('Provide "query" or "queries"')
        const max = Math.min(Math.max(args.maxResults ?? 10, 1), 20)
        return renderBatch(
          queries,
          (q) => q,
          (q) => keggLookup(q, max, exec.signal),
          { ...args, ...EVIDENCE_BATCH_BUDGET, session: exec.session, signal: exec.signal },
        )
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'pathway_enrichment',
      timeoutMs: 120_000,
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      category: 'biology',
      description:
        'Query the official KEGG REST API live for a pathway rollup: batch-map the top N annotation rows ' +
        '(folded into formula groups; adducts and unresolved isomers share a count) onto KEGG pathways and ' +
        'rank pathways by how many annotated formula groups they contain. Use AFTER get_annotation_top ' +
        'to answer "are these annotations concentrated on one pathway" — several high-score ' +
        'annotations on ONE pathway is a candidate descriptive finding; it does not establish pathway activity. ' +
        'Uses exact compound/synonym matches or KEGG C ids; reports ambiguous matches and candidates deferred beyond the 50-query budget. ' +
        'Descriptive counts, not a statistical enrichment test.',
      parameters: {
        topN: {
          type: 'integer',
          description: `Number of top-ranked rows to include (default ${DEFAULT_TOP_N}, max ${MAX_TOP_N})`,
        },
      },
      async execute(args, exec) {
        const signal = exec.signal
        const rows = getAnnotationRows()
        if (!rows || rows.length === 0) {
          return 'No annotations in the current page context. Run the annotation panel first (import a DB and start annotation), then call get_annotation_top before this.'
        }
        const n = Math.min(Math.max(args.topN ?? DEFAULT_TOP_N, 1), MAX_TOP_N)
        const r = await pathwayEnrichment(rows, n, signal)
        const lines = [
          `Pathway rollup over the top ${n} annotation rows (${r.totalFormulas} formula groups after folding adduct ions; isomers remain unresolved; ${r.mappedFormulas} mapped to at least one KEGG pathway).`,
          'Counts are descriptive, not a statistical enrichment test.',
          '',
        ]
        if (r.hits.length === 0) {
          lines.push(
            'No reference pathway links were returned for the exact candidate identities queried. Names without an exact KEGG match remain unresolved; inspect them with kegg_pathway_lookup.',
          )
        } else {
          lines.push('| Pathway | Formula groups | Annotated formulas |')
          lines.push('|---|---|---|')
          for (const h of r.hits) {
            lines.push(
              `| ${pathwayLink(h.mapId, h.name)} | ${h.formulas.length} | ${h.formulas.join(', ')} |`,
            )
          }
          const top = r.hits[0]!
          if (top.formulas.length >= 2) {
            lines.push('')
            lines.push(
              `Largest mapped group: ${top.name} — ${top.formulas.length} annotated formula groups have candidates in this pathway. This is descriptive membership; candidate ambiguity remains and pathway activity is not measured.`,
            )
          }
        }
        if (r.unmapped.length > 0) {
          lines.push('')
          lines.push(
            `Unmapped in queried candidates: ${r.unmapped.slice(0, 15).join(', ')}${r.unmapped.length > 15 ? ` … +${r.unmapped.length - 15} more` : ''}`,
          )
        }
        if (r.ambiguous.length) {
          lines.push(
            `Ambiguous exact KEGG matches (all retained as alternatives): ${r.ambiguous.map((hit) => `${hit.query}: ${hit.ids.map((id) => compoundLink(id)).join(', ')}`).join('; ')}`,
          )
        }
        if (r.deferred.length) {
          lines.push(
            `Incomplete candidate coverage: ${r.deferred.length} alternative names were not queried after the 50-query budget: ${r.deferred.join('; ')}. Unmapped groups may include unqueried alternatives.`,
          )
        }
        lines.push(keggSource())
        return lines.join('\n')
      },
    }),
  )
}

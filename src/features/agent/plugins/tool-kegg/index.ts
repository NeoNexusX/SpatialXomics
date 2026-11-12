/** Live KEGG search, compound, pathway, and mass evidence tools. */
import type { Context } from '@deepseek-ai/cordis'
import {
  defineTool,
  batchInput,
  EVIDENCE_BATCH_BUDGET,
  renderBatch,
  MAX_BATCH_QUERIES,
  TOOL_RESULT_CHARS_EVIDENCE,
} from '../tools'
import { rankWindowMeta, resolveRankWindow } from '../../bridge/analysisTypes'
import { resolveMassPolarity } from '../../bridge/analysisContext'
import { adductShiftTable } from '@/shared/chem/adducts'
import { KeggClient, compoundLink, keggSource, pathwayLink, type KeggEntry } from './kegg'

export const ADDUCTS: Record<'positive' | 'negative', Record<string, number>> = {
  positive: adductShiftTable(['M+H', 'M+Na', 'M+K', 'M+NH4', 'M+Li']),
  negative: adductShiftTable(['M-H', 'M+Cl', 'M+HCOO', 'M+CH3COO', 'M-2H+Na', 'M-2H+K']),
}

export type KeggFindDatabase = 'compound' | 'pathway'

/** Return a complete-result window for one keyword query; limit is only the page size. */
export async function keggFind(
  query: string,
  db: KeggFindDatabase,
  offset: number,
  limit: number,
  signal?: AbortSignal,
  client = new KeggClient(signal),
): Promise<string> {
  if (!query.trim()) throw new Error('Provide a nonempty KEGG query')
  const entries =
    db === 'compound'
      ? (await client.findCompounds(query)).map((entry) => ({
          id: entry.id,
          name: entry.names.join('; '),
        }))
      : (await client.findPathways(query)).map(([id, name]) => ({ id, name }))
  const selected = entries.slice(offset, offset + limit)
  const window = rankWindowMeta(entries.length, offset, limit, selected.length)
  // rn/hsa-style ids returned by find/pathway are species/reaction variants
  // of the same map; say so instead of silently dropping them from the list.
  const variantNote =
    db === 'pathway' && entries.length === 0 && /^[a-z]{2,4}\d{5}$/i.test(query.trim())
      ? `\n"${query.trim()}" is an organism- or reference-specific pathway code; only map codes (e.g. map00010) are listed. Try the map form or a keyword.`
      : ''
  const missNote =
    entries.length === 0 && !variantNote
      ? `\nNo KEGG entries matched "${query}". This is a database search miss, not biological absence.`
      : ''
  return `${JSON.stringify({ query, window, entries: selected }, null, 2)}${variantNote}${missNote}\n${keggSource()}`
}

export interface KeggMassMatch {
  id: string
  name: string
  adduct: string
  exactMass: number
  deltaPpm: number
}

/** Adduct-aware neutral-mass search, verified against the compound entries' exact masses. */
export async function keggMassSearch(
  mz: number,
  polarity: 'positive' | 'negative',
  ppm: number,
  offset: number,
  limit: number,
  signal?: AbortSignal,
  client = new KeggClient(signal),
): Promise<string> {
  if (!Number.isFinite(mz) || mz <= 0) throw new Error('Provide a positive m/z')
  if (!Number.isFinite(ppm) || ppm <= 0) throw new Error('Provide a positive ppm tolerance')
  const tolerance = (mz * ppm) / 1e6
  const hits = new Map<string, Map<string, number>>()
  // Dispatch all adduct ranges in parallel — the shared 350ms scheduler still
  // caps actual upstream traffic at 3 req/s; serial awaits would stack a full
  // round trip on every adduct slot and push real batches past the timeout.
  await Promise.all(
    Object.entries(ADDUCTS[polarity]).map(async ([adduct, shift]) => {
      const neutralMass = mz - shift
      const lo = neutralMass - tolerance
      const hi = neutralMass + tolerance
      if (hi <= 0) return
      const pairs = await client.findExactMass(Math.max(lo, 1e-6), hi)
      // KEGG find returns an identifier and name; get below supplies the actual EXACT_MASS.
      for (const [id] of pairs) {
        if (!hits.has(id)) hits.set(id, new Map())
        hits.get(id)!.set(adduct, neutralMass)
      }
    }),
  )

  const entries = await client.getEntries([...hits.keys()])
  const matches: KeggMassMatch[] = []
  for (const entry of entries) {
    if (entry.exactMass == null) continue
    for (const [adduct, neutralMass] of hits.get(entry.id) ?? []) {
      const deltaPpm = ((entry.exactMass - neutralMass) / mz) * 1e6
      if (Math.abs(deltaPpm) > ppm) continue
      matches.push({
        id: entry.id,
        name: entry.names.join('; '),
        adduct,
        exactMass: entry.exactMass,
        deltaPpm,
      })
    }
  }
  matches.sort(
    (a, b) =>
      Math.abs(a.deltaPpm) - Math.abs(b.deltaPpm) ||
      a.id.localeCompare(b.id) ||
      a.adduct.localeCompare(b.adduct),
  )
  const selected = matches.slice(offset, offset + limit)
  const window = rankWindowMeta(matches.length, offset, limit, selected.length)
  const missNote =
    matches.length === 0
      ? `\nNo KEGG compounds matched m/z ${mz} (${polarity}, ${ppm} ppm). This is a database search miss, not biological absence.`
      : ''
  return `${JSON.stringify({ queryMz: mz, polarity, window, matches: selected }, null, 2)}${missNote}\n${keggSource()}`
}

export function formatKeggCompound(entry: KeggEntry): string {
  const lines = [
    `entry: ${compoundLink(entry.id)}`,
    `names: ${entry.names.length ? entry.names.join('; ') : '(no name returned by KEGG)'}`,
  ]
  if (entry.formula) lines.push(`formula: ${entry.formula}`)
  if (entry.exactMass != null) lines.push(`exact_mass: ${entry.exactMass}`)
  if (entry.molecularWeight != null) lines.push(`mol_weight: ${entry.molecularWeight}`)
  if (entry.pathways.length) {
    lines.push('pathways:')
    for (const pathway of entry.pathways) {
      lines.push(`- ${pathwayLink(pathway.id, pathway.name)}`)
    }
  }
  if (entry.dblinks.length) {
    lines.push('dblinks:')
    for (const link of entry.dblinks) {
      const database = link.database === 'PubChem' ? 'PubChem SID' : link.database
      lines.push(`- ${database}: ${link.values.join(', ')}`)
    }
  }
  lines.push(keggSource())
  return lines.join('\n')
}

/** Normalize and dedupe compound ids; validity is enforced per item inside renderBatch. */
function normalizeCompoundIds(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().replace(/^cpd:/i, '').toUpperCase()))]
}

const COMPOUND_ID = /^C\d{5}$/

export async function formatKeggPathway(
  entry: KeggEntry,
  members: string[],
  offset: number,
  limit: number,
  client: KeggClient,
): Promise<string> {
  const selected = members.slice(offset, offset + limit)
  const names = new Map(await client.list(selected))
  const window = rankWindowMeta(members.length, offset, limit, selected.length)
  const lines = [
    `entry: [${entry.id}](https://www.kegg.jp/pathway/${entry.id})`,
    `name: ${entry.names.length ? entry.names.join('; ') : '(no name returned by KEGG)'}`,
  ]
  if (entry.class) lines.push(`class: ${entry.class}`)
  if (entry.description) {
    lines.push(
      `description: ${entry.description.slice(0, 400)}${entry.description.length > 400 ? '…' : ''}`,
    )
  }
  lines.push(`window: ${JSON.stringify(window)}`, 'compounds:')
  if (selected.length === 0) {
    lines.push(
      members.length
        ? '- No compounds in this window; use nextOffset from a preceding page or a smaller offset.'
        : '- No member compounds returned by KEGG.',
    )
  }
  for (const id of selected) {
    const label = names.get(id)?.split(';')[0]?.trim() || id
    lines.push(`- ${compoundLink(id, label)}`)
  }
  lines.push(keggSource())
  return lines.join('\n')
}

function normalizePathwayIds(values: string[]): string[] {
  return [
    ...new Set(
      values.map((value) =>
        value
          .trim()
          .replace(/^path:/i, '')
          .toLowerCase(),
      ),
    ),
  ]
}

const PATHWAY_ID = /^map\d{5}$/

export const name = 'tool-kegg'
export const inject = ['tools']

export function apply(ctx: Context) {
  /**
   * kegg_find —— KEGG REST 关键词检索（compound / pathway 库）。
   *
   * 作用：每个查询完整取回结果后按零基 offset/limit 切窗——limit 只是页大小，不是
   * 结果总量上限（默认 0/10、页 cap 25）；返回 {query, window, entries:[{id,name}]}
   * 与实时来源行。DBGET 多关键词为 AND 语义；关键词命中≠身份匹配，身份核验用
   * kegg_compound / pubchem_compound_lookup。批量：多个关键词一次传 queries。
   *
   * 参数：
   * - query (string, 可选)：单关键词；多个独立查询用 queries
   * - queries (string[], 可选)：批量形式（≤25）；offset/limit 对每个查询独立生效
   * - db (string, 可选)：compound | pathway，默认 compound
   * - offset (integer, 可选)：每查询结果的零基偏移，默认 0
   * - limit (integer, 可选)：每查询的页大小，默认 10、cap 25
   */
  ctx.tools.register(
    defineTool({
      name: 'kegg_find',
      timeoutMs: 120_000,
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      category: 'biology',
      description:
        'Search KEGG by keyword to locate compound or pathway entries. Each query returns entry ids/names ' +
        'and a result window over the fully retrieved result set; continue with nextOffset. Multi-word ' +
        'queries use DBGET AND semantics. Keyword hits are search candidates, not identity: verify ' +
        'compounds with kegg_compound or pubchem_compound_lookup. Use db="pathway" for pathway keywords ' +
        'and kegg_pathway for details by map id.',
      parameters: {
        query: {
          type: 'string',
          description:
            'Single KEGG keyword; for several independent searches use "queries". Provide query or queries.',
        },
        queries: {
          type: 'array',
          items: 'string',
          maxItems: MAX_BATCH_QUERIES,
          description:
            "Independent keywords (≤25); offset/limit apply to each query's own result window.",
        },
        db: {
          type: 'string',
          enum: ['compound', 'pathway'],
          description: 'Database to search: compound | pathway; default compound.',
        },
        offset: {
          type: 'integer',
          description:
            'Zero-based result offset within each query (default 0); pages results, never the input array.',
        },
        limit: {
          type: 'integer',
          description:
            'Result page size per query, default 10, max 25 — page size, not a total cap.',
        },
      },
      async execute(args, exec) {
        const queries = batchInput<string>(args.queries, args.query)
        if (queries.length === 0) throw new Error('Provide "query" or "queries"')
        const { offset, limit } = resolveRankWindow(args.offset, args.limit)
        // One client per invocation: duplicate keywords in a batch dedupe onto
        // the same in-flight request instead of spending rate-limit slots twice.
        const client = new KeggClient(exec.signal)
        return renderBatch(
          queries,
          (query) => query,
          (query) => keggFind(query, args.db ?? 'compound', offset, limit, exec.signal, client),
          {
            ...EVIDENCE_BATCH_BUDGET,
            paginateInputs: false,
            session: exec.session,
            signal: exec.signal,
          },
        )
      },
    }),
  )

  /**
   * kegg_compound —— 按 C 编号取 KEGG 化合物官方条目。
   *
   * 作用：names、FORMULA、EXACT_MASS、MOL_WEIGHT、PATHWAY 链接与 DBLINKS（PubChem
   * 值为 SID 非 CID）。首选的 KEGG 身份核验工具：对照分子式与精确质量，而非信任
   * 关键词排名。请求按 KEGG 每次 10 条上限自动分块；上游请求成功但未返回该 id 时
   * 明确报告，不伪装成空详情。批量：一次传 ids（≤25，自动去重并校验编号格式）。
   *
   * 参数：
   * - id (string, 可选)：单个 C 编号，如 "C00162" 或 "cpd:C00162"
   * - ids (string[], 可选)：批量形式，≤25 个 C 编号
   */
  ctx.tools.register(
    defineTool({
      name: 'kegg_compound',
      timeoutMs: 120_000,
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      category: 'biology',
      description:
        'Retrieve official KEGG compound entries by C id when a candidate id is known or a keyword hit ' +
        'needs identity checking. Returns names, FORMULA, EXACT_MASS, MOL_WEIGHT, PATHWAY links, DBLINKS ' +
        'and the official entry link. Compare formula and exact mass against the annotation rather than ' +
        'trusting keyword rank. PubChem cross-references are SIDs, not CIDs. Batch up to 25 ids; requests ' +
        "are chunked to KEGG's 10-entries-per-request limit; invalid ids are reported per item.",
      parameters: {
        id: {
          type: 'string',
          description:
            'Single KEGG compound id — C plus five digits, "cpd:" prefix accepted. Provide id or ids.',
        },
        ids: {
          type: 'array',
          items: 'string',
          maxItems: MAX_BATCH_QUERIES,
          description: 'Up to 25 compound ids; deduplicated and chunked 10 per upstream request.',
        },
      },
      async execute(args, exec) {
        const input = batchInput<string>(args.ids, args.id)
        if (input.length === 0) throw new Error('Provide "id" or "ids"')
        const ids = normalizeCompoundIds(input)
        const validIds = ids.filter((id) => COMPOUND_ID.test(id))
        const entries = validIds.length
          ? await new KeggClient(exec.signal).getEntries(validIds)
          : []
        const byId = new Map(entries.map((entry) => [entry.id, entry]))
        return renderBatch(
          ids,
          (id) => id,
          (id) => {
            // Throw inside render: single-item calls still fail loudly, batches
            // isolate the bad id as its own error section (renderBatch semantics).
            if (!COMPOUND_ID.test(id)) {
              throw new Error(
                `Invalid KEGG compound id "${id}"; expected C followed by five digits`,
              )
            }
            const entry = byId.get(id)
            return entry
              ? formatKeggCompound(entry)
              : `No KEGG compound entry was returned for ${id}; the request succeeded but this id was absent.`
          },
          {
            ...EVIDENCE_BATCH_BUDGET,
            paginateInputs: false,
            session: exec.session,
            signal: exec.signal,
          },
        )
      },
    }),
  )

  /**
   * kegg_pathway —— 按 map 编号取 KEGG 通路官方条目。
   *
   * 作用：NAME、CLASS、DESCRIPTION 摘录（≤400 字符）与成员化合物链接。成员完整取回
   * 后按该通路的零基 offset/limit 切窗（limit 是页大小不是成员总量上限；默认 0/10、
   * 页 cap 25，rank 10–20 = offset 9 + limit 11）；只为当前窗口成员补名称并生成官方
   * 化合物链接，上游未给名称时保留 ID 链接。区分空成员/越界窗口/上游缺详情三种情形。
   * 批量：一次传 ids（≤25）。通路关键词检索用 kegg_find。
   *
   * 参数：
   * - id (string, 可选)：单个 map 编号，如 "map00010" 或 "path:map00010"
   * - ids (string[], 可选)：批量形式，≤25 个 map 编号
   * - offset (integer, 可选)：每通路成员化合物的零基偏移，默认 0
   * - limit (integer, 可选)：成员页大小，默认 10、cap 25
   */
  ctx.tools.register(
    defineTool({
      name: 'kegg_pathway',
      timeoutMs: 120_000,
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      category: 'biology',
      description:
        "Retrieve an official KEGG pathway entry by map id when the pathway's details or member " +
        'compounds are needed. Returns NAME, CLASS, a DESCRIPTION excerpt and a member-compound list ' +
        'paged by a per-pathway window (default 0/10, cap 25; rank 10–20 = offset 9 + limit 11); ' +
        'continue with nextOffset. Accepts map ids only — organism-specific codes like hsa00010 are ' +
        'rejected; discover pathway ids by keyword with kegg_find. Each pathway in a batch gets its own ' +
        'member window.',
      parameters: {
        id: {
          type: 'string',
          description:
            'Single KEGG map id, e.g. "map00010"; "path:" prefix accepted; no organism-specific codes.',
        },
        ids: {
          type: 'array',
          items: 'string',
          maxItems: MAX_BATCH_QUERIES,
          description: 'Up to 25 map ids; details and member windows are fetched per pathway.',
        },
        offset: {
          type: 'integer',
          description: 'Zero-based member-compound offset within each pathway (default 0).',
        },
        limit: {
          type: 'integer',
          description:
            'Member page size per pathway, default 10, max 25 — page size, not a member-total cap.',
        },
      },
      async execute(args, exec) {
        const input = batchInput<string>(args.ids, args.id)
        if (input.length === 0) throw new Error('Provide "id" or "ids"')
        const ids = normalizePathwayIds(input)
        const validIds = ids.filter((id) => PATHWAY_ID.test(id))
        const client = new KeggClient(exec.signal)
        const entries = validIds.length ? await client.getEntries(validIds) : []
        const byId = new Map(entries.map((entry) => [entry.id, entry]))
        // Prefetch member lists for pathways that actually resolved, in
        // parallel: the shared 350ms scheduler caps upstream traffic at 3
        // req/s, so a full 25-pathway batch stays inside the tool timeout
        // instead of stacking round trips serially per rendered item (R2-3).
        // Absent ids never reach link/compound — they render the absent
        // message instead (matching getEntries' 404 tolerance).
        const membersById = new Map<string, string[]>(
          await Promise.all(
            entries.map(
              async (entry) => [entry.id, await client.pathwayCompounds(entry.id)] as const,
            ),
          ),
        )
        const { offset, limit } = resolveRankWindow(args.offset, args.limit)
        return renderBatch(
          ids,
          (id) => id,
          async (id) => {
            if (!PATHWAY_ID.test(id)) {
              throw new Error(
                `Invalid KEGG pathway id "${id}"; expected map followed by five digits (organism-specific codes like hsa00010 are not accepted — use the map number, e.g. map00010)`,
              )
            }
            const entry = byId.get(id)
            return entry
              ? formatKeggPathway(entry, membersById.get(id) ?? [], offset, limit, client)
              : `No KEGG pathway entry was returned for ${id}; the request succeeded but this id was absent.`
          },
          {
            ...EVIDENCE_BATCH_BUDGET,
            paginateInputs: false,
            session: exec.session,
            signal: exec.signal,
          },
        )
      },
    }),
  )

  /**
   * kegg_mass_search —— 按观察 m/z 检索 KEGG 化合物（加合物感知）。
   *
   * 作用：按极性展开正/负加合物表（ADDUCTS），逐加合物做 exact_mass 范围查询（固定
   * 6 位小数）；find 结果只供候选 ID，真实质量由 get 的 EXACT_MASS 复核并重算 Δppm、
   * 过滤超差项；全部加合物命中合并按 |Δppm| 排序后，对每个 m/z 独立 offset/limit 切窗
   * （默认 0/10、页 cap 25）。覆盖约 1.9 万小分子、不含脂质（脂质走注释库或 PubChem）；
   * KEGG 限速下查询可能慢。批量：一次传 mzs（≤10）。
   *
   * 参数：
   * - mz (number, 可选)：单个观察 m/z；多个用 mzs
   * - mzs (number[], 可选)：批量形式，≤10 个
   * - polarity (string, 可选)：positive | negative；缺省由当前数据集极性解析
   * - ppm (integer, 可选)：质量容差（ppm），默认 10、cap 50
   * - offset / limit (integer, 可选)：每 m/z 排序结果的零基窗口，默认 0/10、cap 25
   */
  ctx.tools.register(
    defineTool({
      name: 'kegg_mass_search',
      timeoutMs: 120_000,
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      category: 'biology',
      description:
        'Search KEGG for small-molecule candidates by observed m/z when a polarity-aware mass lookup is ' +
        'needed. Expands the supported adduct table per polarity, queries exact-mass ranges, then verifies ' +
        "each candidate's EXACT_MASS from its entry and recalculates Δppm; matches from all adducts are " +
        'merged and sorted by absolute Δppm, and offset/limit page the window for EACH m/z. Continue with ' +
        'nextOffset. Coverage is roughly 19,000 small molecules and excludes lipids — use the annotation ' +
        'library or PubChem for lipids. KEGG rate limits can make batches slow.',
      parameters: {
        mz: {
          type: 'number',
          description: 'Single positive observed m/z; use "mzs" for several. Provide mz or mzs.',
        },
        mzs: {
          type: 'array',
          items: 'number',
          maxItems: 10,
          description: 'Up to 10 observed m/z values; each returns its own match window.',
        },
        polarity: {
          type: 'string',
          description:
            'Ion mode "positive" or "negative"; defaults to the current dataset polarity ("+"/"pos" and "-"/"neg" also accepted).',
        },
        ppm: {
          type: 'integer',
          description: 'Mass tolerance in ppm, default 10, clamped 1–50.',
        },
        offset: {
          type: 'integer',
          description: "Zero-based offset into each m/z's Δppm-sorted matches (default 0).",
        },
        limit: {
          type: 'integer',
          description: 'Match page size per m/z, default 10, max 25.',
        },
      },
      async execute(args, exec) {
        const mzs = batchInput<number>(args.mzs, args.mz)
        if (mzs.length === 0) throw new Error('Provide "mz" or "mzs"')
        const polarity = resolveMassPolarity(args.polarity)
        const ppm = Math.min(Math.max(args.ppm ?? 10, 1), 50)
        const { offset, limit } = resolveRankWindow(args.offset, args.limit)
        // One client per invocation so the dedup cache covers repeated ids
        // across adduct ranges and m/z items; and a 90s soft budget like
        // hmdb_lookup so slow KEGG responses leave the rest for the next call
        // instead of dying at the 120s tool timeout with zero results.
        const client = new KeggClient(exec.signal)
        return renderBatch(
          mzs,
          (mz) => `m/z ${mz}`,
          (mz) => keggMassSearch(mz, polarity, ppm, offset, limit, exec.signal, client),
          {
            ...EVIDENCE_BATCH_BUDGET,
            paginateInputs: false,
            deadline: Date.now() + 90_000,
            session: exec.session,
            signal: exec.signal,
          },
        )
      },
    }),
  )
}

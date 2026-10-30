/**
 * 生物信息工具集（离线索引，只读）：HMDB 代谢物档案 + KEGG 通路 + 通路富集。
 *
 * 数据源（均由 scripts/build-*-index.mjs 预构建为同源静态资源）：
 * - HMDB（hmdb.ca）：组织定位/疾病关联/生物功能是 MSI 生物学解读的关键
 *   语义层。hmdb.ca 对程序化下载返回 403，索引脚本消费**手动下载**的
 *   `hmdb_metabolites.xml`（或按体液的子集 XML）生成
 *   public/data/hmdb-index.json。未构建时工具返回可读指引而不是报错。
 * - KEGG REST（rest.kegg.jp，Node 侧可直连但无 CORS 头）：
 *   list/compound + link/pathway/compound + list/pathway/hsa →
 *   public/data/kegg-pathway-index.json（化合物 → 参考通路）。
 *
 * pathway_enrichment 把两者接起来：HMDB 名称 → KEGG C-id → 通路，对 top 注释
 * 批量聚合出富集表（描述性计数，支撑"多个高分注释同属一条通路"的新发现）。
 *
 * 设计约束同 knowledgeTools：懒加载 + 模块级缓存；结果摘要化；
 * 索引缺失/未构建 → 可读错误（isError 回喂模型）。
 */

import type { Context, Plugin } from 'cordis'
import { defineTool, renderBatch } from './defineTool'
import { createLazyJsonLoader } from './httpJson'
import { ADDUCTS } from './knowledgeTools'
import type { AnnotationRow } from '../agenttypes/assistant'
import { getAnnotationRows } from '../providers/analysisContext'
import { DEFAULT_TOP_N, MAX_TOP_N, MAX_BATCH_QUERIES } from '../agentconfig/defaults'

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

/** KEGG 索引（build-kegg-index.mjs 生成）：id/名称 归一小写 */
export interface KeggIndex {
  /** map 编号 → 通路名 */
  pathways: Record<string, string>
  /** 小写归一 C-id → [C-id, ...names] */
  compounds: Record<string, string[]>
  /** 小写 C-id → [map 编号, ...] */
  links: Record<string, string[]>
}

// ---- 懒加载（共享工厂，见 httpJson.createLazyJsonLoader） ----

const loadHmdbIndex = createLazyJsonLoader<HmdbRow[]>(
  'hmdb-index.json',
  () => 'HMDB offline index not found in this deployment (needs public/data/hmdb-index.json).',
)

const loadKeggIndex = createLazyJsonLoader<KeggIndex>(
  'kegg-pathway-index.json',
  () => 'KEGG offline index not found in this deployment (needs public/data/kegg-pathway-index.json).',
)

/** 索引缺失时的统一指引文案（拼接在 loadJson 的错误信息后） */
function notBuiltHint(script: string): string {
  return ` Build it with: node scripts/${script} (see the script header for the data source), then redeploy.`
}

// ---- 检索（纯函数，供测试） ----

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s_/(),-]/g, '')
}

/** 在 HMDB 里找名称完全归一相等的行，取其 KEGG C-id（注释名 → 通路的桥） */
function keggIdByExactName(hmdbIndex: HmdbRow[], name: string): string | null {
  const q = norm(name)
  for (const row of hmdbIndex) {
    if (norm(row[1]) === q && row[4]) return row[4]
  }
  return null
}

/** 名称 → 规范 C-id 的倒排索引（按 KeggIndex 对象缓存）。
 *  keggIdByKeggName 的热路径：pathway_enrichment 一次调用要查几十个候选名，
 *  脂质缩写必然 miss——线性全扫 19k 化合物 × 5.3 万别名逐个 norm() 是
 *  数百万次正则操作，主线程卡死秒级。建一次 Map 后单次查询 O(1)。 */
const keggNameIndexCache = new WeakMap<KeggIndex, Map<string, string>>()

function buildKeggNameIndex(kegg: KeggIndex): Map<string, string> {
  const map = new Map<string, string>()
  for (const [key, names] of Object.entries(kegg.compounds)) {
    const canonical = names[0] ?? key.toUpperCase()
    // key 是归一小写 C-id（norm 对 "c00031" 原样）；names[1..] 是名称别名
    map.set(key, canonical)
    for (let i = 1; i < names.length; i++) {
      const n = norm(names[i] ?? '')
      if (n && !map.has(n)) map.set(n, canonical)
    }
  }
  return map
}

/** 在 KEGG 索引里按名称反查 C-id（compounds 的 names 数组含常用名，可无 HMDB 独立工作） */
function keggIdByKeggName(kegg: KeggIndex, name: string): string | null {
  const q = norm(name)
  if (!q) return null
  let index = keggNameIndexCache.get(kegg)
  if (!index) {
    index = buildKeggNameIndex(kegg)
    keggNameIndexCache.set(kegg, index)
  }
  return index.get(q) ?? null
}

/** 一条注释的可用名（候选按来源排过序，内源在前；跳过外源候选——它们通常不进代谢通路；过滤空名） */
function annotationRowNames(row: AnnotationRow): string[] {
  const raw =
    row.candidates.length > 0 ? row.candidates.map((c) => c.name ?? '') : [row.name ?? '']
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
  /** 命中分子式（同分子式的多个加合离子折叠为一个分子） */
  formulas: string[]
}

/**
 * 通路富集（描述性计数，非统计检验）：把 top 注释行按分子式折叠后，
 * 经 KEGG 索引自反查（必要时再用 HMDB 补 KEGG id），聚合到通路。
 * 返回按命中数降序的通路表 + 未能映射到任何通路的分子名（供模型如实说明覆盖面）。
 *
 * hmdbIndex 可选：部署未构建 HMDB 索引时传 null，富集仍可用 KEGG 索引独立完成。
 */
export function pathwayEnrichment(
  rows: AnnotationRow[],
  hmdbIndex: HmdbRow[] | null,
  kegg: KeggIndex,
  topN: number,
): { hits: PathwayHit[]; mappedFormulas: number; totalFormulas: number; unmapped: string[] } {
  // 1) 按分子式折叠（同分子的 [M+H]+/[M+Na]+ 是同一个分子，只计一次），保留最高排名
  const byFormula = new Map<string, AnnotationRow>()
  for (const r of [...rows].sort((a, b) => a.rank - b.rank).slice(0, topN)) {
    if (!byFormula.has(r.formula)) byFormula.set(r.formula, r)
  }

  // 2) 每个分子式 → 一组 KEGG 通路 map 编号
  const unmapped: string[] = []
  const pathwayToFormulas = new Map<string, Set<string>>()
  let mapped = 0
  for (const [formula, row] of byFormula) {
    const mapIds = new Set<string>()
    for (const name of annotationRowNames(row)) {
      // 先 KEGG 自反查；查不到且 HMDB 可用时再用 HMDB 取 KEGG id
      const cid = keggIdByKeggName(kegg, name) ?? (hmdbIndex ? keggIdByExactName(hmdbIndex, name) : null)
      if (!cid) continue
      for (const m of kegg.links[cid.toLowerCase()] ?? []) mapIds.add(m)
    }
    if (mapIds.size === 0) {
      unmapped.push(row.name)
      continue
    }
    mapped++
    for (const m of mapIds) {
      if (!pathwayToFormulas.has(m)) pathwayToFormulas.set(m, new Set())
      pathwayToFormulas.get(m)!.add(formula)
    }
  }

  // 3) 聚合成通路表（命中数降序，再按通路名稳定排序）
  const hits: PathwayHit[] = [...pathwayToFormulas.entries()]
    .map(([mapId, formulas]) => ({
      mapId,
      name: kegg.pathways[mapId] ?? '(reference pathway)',
      formulas: [...formulas],
    }))
    .sort((a, b) => b.formulas.length - a.formulas.length || a.name.localeCompare(b.name))

  return { hits, mappedFormulas: mapped, totalFormulas: byFormula.size, unmapped }
}

/** 名称/HMDB id 子串检索 */
export function searchHmdbIndex(index: HmdbRow[], query: string, max: number): HmdbRow[] {
  const q = norm(query)
  const out: HmdbRow[] = []
  for (const row of index) {
    if (norm(row[1]).includes(q) || row[0].toLowerCase().includes(q)) {
      out.push(row)
      if (out.length >= max) break
    }
  }
  return out
}

/** m/z ± 加合物质量检索（与 library_mass_search 同表） */
export function massSearchHmdbIndex(
  index: HmdbRow[],
  mz: number,
  polarity: 'positive' | 'negative',
  ppm: number,
  max: number,
): { row: HmdbRow; adduct: string; ppm: number }[] {
  const table = ADDUCTS[polarity]
  const out: { row: HmdbRow; adduct: string; ppm: number }[] = []
  const window = (mz * ppm) / 1e6
  for (const [name, shift] of Object.entries(table)) {
    const neutral = mz - shift
    for (const row of index) {
      const m = row[3]
      if (!Number.isFinite(m) || m === 0) continue
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
): Promise<string> {
  let index: HmdbRow[]
  try {
    index = await loadHmdbIndex()
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

/** 化合物/通路名 → KEGG 通路（正反向） */
export async function keggLookup(query: string, max: number): Promise<string> {
  let index: KeggIndex
  try {
    index = await loadKeggIndex()
  } catch (err) {
    throw new Error(`${(err as Error).message}${notBuiltHint('build-kegg-index.mjs')}`)
  }

  const q = norm(query)
  const lines: string[] = []

  // 1) 通路名/编号查询 → 通路下的化合物
  const pathwayIds = Object.entries(index.pathways)
    .filter(([id, name]) => norm(name).includes(q) || id.includes(q.replace(/^path:/, '')))
    .slice(0, 3)
  for (const [pid, pname] of pathwayIds) {
    const comps = Object.entries(index.links)
      .filter(([, maps]) => maps.includes(pid))
      .slice(0, max)
      .map(([cid]) => (index.compounds[cid]?.[0] ?? cid) + ' ' + (index.compounds[cid]?.[1] ?? ''))
    lines.push(`pathway ${pid} ${pname}`)
    lines.push(`  compounds (${comps.length >= max ? `${max}+` : comps.length}): ${comps.join('; ')}`)
  }

  // 2) 化合物名/C-id 查询 → 所属通路
  const cidMatches = Object.entries(index.compounds)
    .filter(([key, names]) => key === q || names.some((n) => norm(n).includes(q)))
    .slice(0, 5)
  for (const [key, names] of cidMatches) {
    const cid = names[0]
    const maps = index.links[key] ?? []
    if (maps.length === 0) {
      lines.push(`- ${names.slice(1, 3).join(' / ')} (${cid}): no pathway links`)
      continue
    }
    lines.push(`- ${names.slice(1, 3).join(' / ')} (${cid}) — ${maps.length} pathway(s):`)
    for (const m of maps.slice(0, max)) {
      lines.push(`  ${m} ${index.pathways[m] ?? '(reference pathway)'}`)
    }
  }

  if (lines.length === 0) {
    return (
      `No KEGG entries match "${query}". Try a compound name ("glucose", "palmitic acid"), ` +
      `a C number ("C00031"), or a pathway ("glycolysis", "map00010").`
    )
  }
  lines.push('source: KEGG (local offline index; https://www.kegg.jp, Kanehisa et al. NAR)')
  return lines.join('\n')
}

// ---- 插件 ----

/**
 * 生物信息工具插件。在 bootstrap 中：ctx.plugin(bioTools)
 * 面向"这个分子在这类组织/疾病/通路里意味着什么"的解读。
 */
export const bioTools: Plugin.Function<void> = (ctx: Context) => {
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
      parameters: {
        query: {
          type: 'string',
          description: 'Single metabolite name or HMDB id (e.g. "glucose", "HMDB00165"); for multiple use "queries"',
        },
        queries: {
          type: 'array',
          items: 'string',
          maxItems: MAX_BATCH_QUERIES,
          description: 'Batch form of "query": many names/ids in one call (preferred for multiple molecules)',
        },
        mz: { type: 'number', description: 'Single observed m/z for mass-based search (needs polarity)' },
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
      async execute(args) {
        const queries = args.queries ?? (args.query != null ? [args.query] : [])
        const mzs = args.mzs ?? (args.mz != null ? [args.mz] : [])
        if (queries.length === 0 && mzs.length === 0) {
          throw new Error('Provide "query"/"queries" (name/id) or "mz"/"mzs" (+ "polarity")')
        }
        const polarity = args.polarity === 'negative' ? 'negative' : 'positive'
        const ppm = Math.min(Math.max(args.ppm ?? 10, 1), 50)
        const max = Math.min(Math.max(args.maxResults ?? 10, 1), 25)
        const namePart =
          queries.length > 0
            ? await renderBatch(
                queries,
                (q) => q,
                (q) => hmdbLookup(q, null, polarity, ppm, max),
              )
            : ''
        const mzPart =
          mzs.length > 0
            ? await renderBatch(
                mzs,
                (mz) => `m/z ${mz}`,
                (mz) => hmdbLookup(null, mz, polarity, ppm, max),
              )
            : ''
        return [namePart, mzPart].filter(Boolean).join('\n\n')
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'kegg_pathway_lookup',
      category: 'biology',
      description:
        'Map metabolites to KEGG metabolic pathways (offline index): query compound names or ' +
        'C numbers to list pathways (e.g. "what pathway is palmitic acid in"), or a pathway name/map ' +
        'id to list member compounds — supports "which pathways are enriched in this annotation set". ' +
        'BATCHING: for several compounds at once pass "queries" (array) in ONE call instead of one ' +
        'call per molecule.',
      parameters: {
        query: {
          type: 'string',
          description: 'Single compound name / C number / pathway name or map id; for multiple use "queries"',
        },
        queries: {
          type: 'array',
          items: 'string',
          maxItems: MAX_BATCH_QUERIES,
          description: 'Batch form of "query": many compound names / C numbers in one call',
        },
        maxResults: { type: 'integer', description: 'Max pathways or compounds per query (default 10, max 20)' },
      },
      async execute(args) {
        const queries = args.queries ?? (args.query != null ? [args.query] : [])
        if (queries.length === 0) throw new Error('Provide "query" or "queries"')
        const max = Math.min(Math.max(args.maxResults ?? 10, 1), 20)
        return renderBatch(queries, (q) => q, (q) => keggLookup(q, max))
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'pathway_enrichment',
      category: 'biology',
      description:
        'Pathway rollup for the top-ranked annotations: batch-map the top N annotation rows ' +
        '(folded by formula, so the adduct ions of one molecule count once) onto KEGG pathways and ' +
        'rank pathways by how many annotated molecules they contain. Use AFTER get_annotation_top ' +
        'to answer "are these annotations concentrated on one pathway" — several high-score ' +
        'annotations on ONE pathway is independent coherence evidence, report it as a NEW finding. ' +
        'Descriptive counts, not a statistical enrichment test.',
      parameters: {
        topN: {
          type: 'integer',
          description: `Number of top-ranked rows to include (default ${DEFAULT_TOP_N}, max ${MAX_TOP_N})`,
        },
      },
      async execute(args) {
        const rows = getAnnotationRows()
        if (!rows || rows.length === 0) {
          return 'No annotations in the current page context. Run the annotation panel first (import a DB and start annotation), then call get_annotation_top before this.'
        }
        const n = Math.min(Math.max(args.topN ?? DEFAULT_TOP_N, 1), MAX_TOP_N)
        // KEGG 索引必需（富集的本体）；HMDB 可选——缺失时用 KEGG 索引自反查名称即可
        let kegg: KeggIndex
        try {
          kegg = await loadKeggIndex()
        } catch (err) {
          throw new Error(`${(err as Error).message}${notBuiltHint('build-kegg-index.mjs')}`)
        }
        let hmdb: HmdbRow[] | null = null
        try {
          hmdb = await loadHmdbIndex()
        } catch {
          hmdb = null // 无 HMDB 也能跑：KEGG compounds 的 names 已含常用名可反查
        }
        const r = pathwayEnrichment(rows, hmdb, kegg, n)
        const lines = [
          `Pathway rollup over the top ${n} annotation rows (${r.totalFormulas} distinct molecules after folding adduct ions by formula; ${r.mappedFormulas} mapped to at least one KEGG pathway).`,
          'Counts are descriptive, not a statistical enrichment test.',
          '',
        ]
        if (r.hits.length === 0) {
          lines.push(
            'No KEGG pathway could be assigned to any annotated molecule (names may be lipid shorthand, which KEGG reference pathways do not cover; try interpreting per-molecule with kegg_pathway_lookup).',
          )
        } else {
          lines.push('| Pathway | Molecules | Annotated formulas |')
          lines.push('|---|---|---|')
          for (const h of r.hits) {
            lines.push(`| ${h.name} (${h.mapId}) | ${h.formulas.length} | ${h.formulas.join(', ')} |`)
          }
          const top = r.hits[0]!
          if (top.formulas.length >= 2) {
            lines.push('')
            lines.push(
              `Strongest signal: ${top.name} — ${top.formulas.length} annotated molecules share this pathway. Treat as independent coherence evidence and report it as a candidate finding.`,
            )
          }
        }
        if (r.unmapped.length > 0) {
          lines.push('')
          lines.push(
            `Unmapped (no KEGG pathway): ${r.unmapped.slice(0, 15).join(', ')}${r.unmapped.length > 15 ? ` … +${r.unmapped.length - 15} more` : ''}`,
          )
        }
        lines.push(hmdb ? 'source: KEGG + HMDB (local offline indexes)' : 'source: KEGG (local offline index; HMDB index not built, names resolved via KEGG)')
        return lines.join('\n')
      },
    }),
  )
}

// cordis 4：fiber 内访问兄弟服务（ctx.tools）必须声明 inject。
bioTools.inject = ['tools']

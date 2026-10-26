/**
 * 化学信息只读工具集：PubChem（在线）+ 离线注释库检索（当前为 LIPID MAPS
 * LMSD 索引，多源可扩展）+ ChEBI 生物角色（在线，经 EBI OLS4）。
 *
 * - PubChem PUG REST  https://pubchem.ncbi.nlm.nih.gov/rest/pug/（无鉴权，CORS 友好）
 * - 离线库：LIPID MAPS LMSD 的 REST API 不带 CORS 头，浏览器无法直连，故
 *   离线化——由 scripts/build-lipid-index.mjs 从官方 SDF 生成
 *   public/data/lipidmaps-index.json（~5 万条，gzip 后 <1MB），首次调用时
 *   同源 fetch 拉取缓存，之后纯本地检索。数据 © LIPID MAPS（Conroy et al.,
 *   NAR 2024, doi:10.1093/nar/gkad896）。
 *   工具名刻意叫 library_*（"当前库"）而非 lipidmaps_*：索引按库打包，
 *   后续 HMDB/ChEBI 等多源小分子库可挂进同一命名。
 * - ChEBI：OLS4 搜索接口 https://www.ebi.ac.uk/ols4/api（CORS ✓）。
 *
 * （文献类工具 pubmed/europepmc/openalex 见 literatureTools.ts；
 *   生物信息 hmdb/kegg 见 bioTools.ts；谱库搜索见 spectralTools.ts。）
 *
 * 设计约束：
 * - 结果一律摘要化成紧凑文本（ToolRuntime 统一截断到 TOOL_RESULT_CHARS=2000）；
 * - 无 key、无写操作；网络/上游错误抛 Error → ToolRuntime 转 isError 结果回喂模型，不中断 turn。
 */

import type { Context, Plugin } from 'cordis'
import { defineTool } from './defineTool'
import { getJson, take, createLazyJsonLoader } from './httpJson'
import { adductShiftTable } from '@/shared/chem/adducts'

const PUBCHEM_BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug'
const OLS4_BASE = 'https://www.ebi.ac.uk/ols4/api'

// ---- PubChem ----

/** 按名称查询化合物：属性 + 同义词摘要 */
export async function pubchemLookupCompound(name: string): Promise<string> {
  const enc = encodeURIComponent(name.trim())
  const propsUrl = `${PUBCHEM_BASE}/compound/name/${enc}/property/MolecularFormula,MonoisotopicMass,AverageMass,CanonicalSMILES,InChIKey,IUPACName/JSON`
  const props = (await getJson(propsUrl))?.PropertyTable?.Properties?.[0]
  if (!props) throw new Error(`No compound found for name "${name}"`)

  const lines = [
    `name: ${name}`,
    `cid: ${props.CID}`,
    `formula: ${props.MolecularFormula}`,
    `monoisotopic_mass: ${props.MonoisotopicMass}`,
    `average_mass: ${props.AverageMass}`,
    `iupac_name: ${props.IUPACName}`,
    `smiles: ${props.CanonicalSMILES}`,
    `inchikey: ${props.InChIKey}`,
  ]

  // 同义词单独一个端点；失败不致命（属性已足够）
  try {
    const syn = (await getJson(`${PUBCHEM_BASE}/compound/name/${enc}/synonyms/JSON`))
      ?.InformationList?.Information?.[0]?.Synonym
    const top = take(syn ?? [], 10) as string[]
    if (top.length > 0) lines.push(`synonyms: ${top.join('; ')}`)
  } catch {
    /* 同义词拿不到就算了 */
  }

  lines.push(`source: https://pubchem.ncbi.nlm.nih.gov/compound/${props.CID}`)
  return lines.join('\n')
}

/** 按分子式检索化合物：返回公式匹配的候选列表（含精确质量） */
export async function pubchemSearchFormula(formula: string, maxResults: number): Promise<string> {
  const enc = encodeURIComponent(formula.trim())
  const url = `${PUBCHEM_BASE}/compound/fastformula/${enc}/property/MolecularFormula,MonoisotopicMass,InChIKey/JSON`
  const props = (await getJson(url))?.PropertyTable?.Properties
  const items: any[] = Array.isArray(props) ? props : []
  if (items.length === 0) throw new Error(`No compound found for formula "${formula}"`)

  const lines = [`total_matches: ${items.length}`, 'top matches (cid | formula | monoisotopic_mass | inchikey):']
  for (const p of items.slice(0, maxResults)) {
    lines.push(`- ${p.CID} | ${p.MolecularFormula} | ${p.MonoisotopicMass} | ${p.InChIKey}`)
  }
  if (items.length > maxResults) lines.push(`(…and ${items.length - maxResults} more)`)
  lines.push(`source: https://pubchem.ncbi.nlm.nih.gov/#query=${enc}`)
  return lines.join('\n')
}

// ---- ChEBI（生物角色，在线 OLS4） ----

/** ChEBI 检索：标签/CHEBI id/描述/同义词摘要（化学本体的"这是什么功能的分子"） */
export async function chebiLookup(query: string, maxResults: number): Promise<string> {
  const n = Math.min(Math.max(maxResults, 1), 10)
  const url = `${OLS4_BASE}/search?q=${encodeURIComponent(query)}&ontology=chebi&rows=${n}`
  const data = await getJson(url)
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

// ---- LIPID MAPS 本地索引 ----

/** 「当前注释库」清单：library_* 工具的部署身份（单一事实源）。
 *  工具描述、无匹配文案、来源引用行、索引文件名全部由此组合——换部署
 *  索引或增补第二个库时改这里，不再散落多处各写一份 "LIPID MAPS LMSD"
 *  导致描述与实际索引脱节。 */
export interface LibraryManifest {
  /** 对模型展示的库名 */
  label: string
  /** 库内容描述（规模/种类） */
  about: string
  /** 支持的查询写法（无匹配建议 + 工具描述共用） */
  queryKinds: string
  /** 索引静态资源文件名（public/data/ 下） */
  indexFile: string
  /** 结果尾部的来源引用行 */
  sourceLine: string
}

/** 当前部署的离线注释库（scripts/build-lipid-index.mjs 产出的 LMSD 索引） */
export const CURRENT_LIBRARY: LibraryManifest = {
  label: 'LIPID MAPS LMSD',
  about: '~50k lipid entries',
  queryKinds: 'lipid shorthand ("PC 34:1"), common name, or LM_ID',
  indexFile: 'lipidmaps-index.json',
  sourceLine:
    'source: LIPID MAPS LMSD (local offline index; https://www.lipidmaps.org, doi:10.1093/nar/gkad896)',
}

/** LMSD 索引行（scripts/build-lipid-index.mjs 生成，按精确质量升序）：
 * [lmId, abbreviation, name, formula, exactMass, category, mainClass, pubchemCid]
 */
export type LipidRow = [
  string | null,
  string | null,
  string | null,
  string,
  number,
  string | null,
  string | null,
  number | null,
]

/** 常见加合物的单同位素离子质量位移（Da）：neutral = m/z − shift。
 *  数值来自共享加合物表（shared/chem/adducts.ts，按元素质量现算、含电子质量），注释面板
 *  用的是同一张表；这里列出助手检索要扫的子集。bioTools 的 HMDB 质量检索复用同一张表。 */
export const ADDUCTS: Record<'positive' | 'negative', Record<string, number>> = {
  positive: adductShiftTable(['M+H', 'M+Na', 'M+K', 'M+NH4', 'M+Li']),
  negative: adductShiftTable(['M-H', 'M+Cl', 'M+HCOO', 'M+CH3COO', 'M-2H+Na', 'M-2H+K']),
}

/** 懒加载 LMSD 索引（同源静态资源，模块级缓存；首次 ~940KB gzip） */
export const loadLipidIndex = createLazyJsonLoader<LipidRow[]>(
  CURRENT_LIBRARY.indexFile,
  (status) => `Failed to load ${CURRENT_LIBRARY.label} index (HTTP ${status})`,
)

/** 脂质速记名归一化：去掉括号/空格/下划线/斜杠并小写，"PC(34:1)" ≡ "pc 34:1" ≡ "PC34:1" */
export function normalizeLipidQuery(s: string): string {
  return s.toLowerCase().replace(/[()\s_/]/g, '')
}

/** 按名称/缩写/LM_ID 子串检索（归一化匹配），返回前 max 条 */
export function searchLipidIndex(index: LipidRow[], query: string, max: number): LipidRow[] {
  const q = normalizeLipidQuery(query)
  const out: LipidRow[] = []
  for (const row of index) {
    if (
      (row[0] && row[0].toLowerCase().includes(q)) ||
      (row[1] && normalizeLipidQuery(row[1]).includes(q)) ||
      (row[2] && normalizeLipidQuery(row[2]).includes(q))
    ) {
      out.push(row)
      if (out.length >= max) break
    }
  }
  return out
}

/** 质量匹配结果：索引行 + [adduct, Δppm] */
export type LipidMassMatch = [...LipidRow, adduct: string, ppm: number]

/**
 * 按观察 m/z 做加合物感知的脂质质量匹配。
 * adducts 传入 null 时扫描该极性全部常见加合物（[M-H]- / [M+H]+ / [M+Na]+ …）。
 */
export function massSearchLipidIndex(
  index: LipidRow[],
  mz: number,
  polarity: 'positive' | 'negative',
  adducts: Record<string, number> | null,
  ppm: number,
  max: number,
): LipidMassMatch[] {
  const table = adducts ?? ADDUCTS[polarity]
  const out: LipidMassMatch[] = []
  for (const [name, shift] of Object.entries(table)) {
    const neutral = mz - shift
    const window = (mz * ppm) / 1e6
    // index 按质量升序，线性扫描即止（5 万条对 JS 循环 ~ms 级）
    for (const row of index) {
      if (row[4] < neutral - window) continue
      if (row[4] > neutral + window) break
      out.push([...row, name, ((row[4] - neutral) / mz) * 1e6] as LipidMassMatch)
    }
  }
  // 按质量误差绝对值排序，截断
  out.sort((a, b) => Math.abs(a[9]) - Math.abs(b[9]))
  return out.slice(0, max)
}

function formatLipidRow(r: LipidRow): string {
  const parts = [`- ${r[1] ?? r[2] ?? r[0]}`]
  if (r[1] && r[2] && r[1] !== r[2]) parts.push(`(${r[2]})`)
  parts.push(`| ${r[3]} | M ${r[4]} | ${r[0]}`)
  if (r[6]) parts.push(`| ${r[6]}`)
  if (r[7] != null) parts.push(`| PubChem CID ${r[7]}`)
  return parts.join(' ')
}

/** 名称/缩写检索结果摘要（library_lookup 工具的实现体） */
export async function libraryLookup(query: string, max: number): Promise<string> {
  const index = await loadLipidIndex()
  const hits = searchLipidIndex(index, query, max)
  if (hits.length === 0) {
    return (
      `No entries in the current offline library (${CURRENT_LIBRARY.label}) match "${query}". ` +
      `Try ${CURRENT_LIBRARY.queryKinds}.`
    )
  }
  const lines = hits.map(formatLipidRow)
  lines.push(CURRENT_LIBRARY.sourceLine)
  return lines.join('\n')
}

/** m/z + 极性（+ 可选加合物）的库注释匹配（library_mass_search 的实现体） */
export async function libraryMassSearch(
  mz: number,
  polarity: 'positive' | 'negative',
  adduct: string | null,
  ppm: number,
  max: number,
): Promise<string> {
  const index = await loadLipidIndex()

  // 单加合物：在对应极性表里找位移；找不到给出可用列表
  let adducts: Record<string, number> | null = null
  if (adduct) {
    const shift = ADDUCTS[polarity][adduct]
    if (shift == null) {
      throw new Error(
        `Unknown adduct "${adduct}" for ${polarity} mode. Available: ${Object.keys(ADDUCTS[polarity]).join(', ')}`,
      )
    }
    adducts = { [adduct]: shift }
  }

  const hits = massSearchLipidIndex(index, mz, polarity, adducts, ppm, max)
  if (hits.length === 0) {
    return (
      `No matches in the current offline library (${CURRENT_LIBRARY.label}) for m/z ${mz} within ` +
      `${ppm} ppm (${adduct ?? `scanned adducts: ${Object.keys(ADDUCTS[polarity]).join(', ')}`}). ` +
      `Consider widening ppm or checking the adduct/isotope.`
    )
  }

  const lines = [
    `m/z ${mz} (${polarity}, ${ppm} ppm window) — top ${CURRENT_LIBRARY.label} matches:`,
  ]
  for (const h of hits) {
    lines.push(
      `- ${h[8]} → ${h[1] ?? h[2] ?? h[0]}${h[1] && h[2] && h[1] !== h[2] ? ` (${h[2]})` : ''}` +
        ` | ${h[3]} | neutral M ${h[4]} | Δ${h[9].toFixed(1)} ppm | ${h[0]}${h[6] ? ` | ${h[6]}` : ''}`,
    )
  }
  lines.push(CURRENT_LIBRARY.sourceLine)
  return lines.join('\n')
}

// ---- 插件 ----

/**
 * 外部知识源工具插件。
 *
 * 在 bootstrap 中：ctx.plugin(knowledgeTools)
 * 工具面向注释验证与文献佐证：模型在写生物学解读/报告时用它们核对分子身份
 * 与检索文献，避免凭记忆编造（hallucination）。
 */
export const knowledgeTools: Plugin.Function<void> = (ctx: Context) => {
  ctx.tools.register(
    defineTool({
      name: 'pubchem_compound_lookup',
      category: 'chemistry',
      description:
        'Look up a chemical compound by name on PubChem: formula, exact (monoisotopic) mass, ' +
        'SMILES/InChIKey, synonyms. Use to verify a candidate annotation or get molecule facts.',
      parameters: {
        name: { type: 'string', required: true, description: 'Compound name, e.g. "PC(16:0/18:1)" or "glucose"' },
      },
      async execute(args) {
        return pubchemLookupCompound(args.name!)
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
        formula: { type: 'string', required: true, description: 'Molecular formula, e.g. "C18H36O2"' },
        maxResults: { type: 'integer', description: 'Max candidates to return (default 15, max 25)' },
      },
      async execute(args) {
        return pubchemSearchFormula(args.formula!, Math.min(Math.max(args.maxResults ?? 15, 1), 25))
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'chebi_lookup',
      category: 'chemistry',
      description:
        'Look up compounds in the ChEBI ontology (online, EBI OLS4): what a molecule IS in ' +
        'biological role terms (e.g. "antioxidant", "xenobiotic metabolite") — labels, synonyms, ' +
        'definitions, CHEBI ids. Use for the semantic/biological role layer of an identification.',
      parameters: {
        query: { type: 'string', required: true, description: 'Compound name or CHEBI id fragment' },
        maxResults: { type: 'integer', description: 'Max terms (default 5, max 10)' },
      },
      async execute(args) {
        return chebiLookup(args.query!, args.maxResults ?? 5)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'library_lookup',
      category: 'chemistry',
      description:
        'Look up compounds in the CURRENT offline annotation library (deployed index: ' +
        `${CURRENT_LIBRARY.label}, ${CURRENT_LIBRARY.about}). Search by ${CURRENT_LIBRARY.queryKinds}. ` +
        'Returns formula, exact mass, classification, PubChem CID. First call loads the index ' +
        '(~1MB, cached afterwards). Small-molecule libraries (HMDB/KEGG) live in the biology tools.',
      parameters: {
        query: { type: 'string', required: true, description: 'Shorthand / name / id fragment' },
        maxResults: { type: 'integer', description: 'Max entries (default 10, max 25)' },
      },
      async execute(args) {
        return libraryLookup(args.query!, Math.min(Math.max(args.maxResults ?? 10, 1), 25))
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'library_mass_search',
      category: 'chemistry',
      description:
        'Annotate an m/z value against the CURRENT offline annotation library (deployed index: ' +
        `${CURRENT_LIBRARY.label}) with adduct-aware matching: give observed m/z and polarity ` +
        '(optionally a specific adduct, else all common ones are scanned). Returns candidate ' +
        'compounds with neutral mass, Δppm, and class. First call loads the index (~1MB, cached).',
      parameters: {
        mz: { type: 'number', required: true, description: 'Observed m/z value' },
        polarity: {
          type: 'string',
          required: true,
          description: 'Ion mode: "positive" or "negative"',
        },
        adduct: {
          type: 'string',
          description:
            'Specific adduct, e.g. "[M+H]+", "[M+Na]+", "[M-H]-", "[M+HCOO]-"; omit to scan all common adducts',
        },
        ppm: { type: 'integer', description: 'Mass tolerance in ppm (default 10, max 50)' },
        maxResults: { type: 'integer', description: 'Max candidates (default 15, max 25)' },
      },
      async execute(args) {
        const polarity = args.polarity === 'negative' ? 'negative' : 'positive'
        return libraryMassSearch(
          args.mz!,
          polarity,
          args.adduct ?? null,
          Math.min(Math.max(args.ppm ?? 10, 1), 50),
          Math.min(Math.max(args.maxResults ?? 15, 1), 25),
        )
      },
    }),
  )
}

// cordis 4：fiber 内访问兄弟服务（ctx.tools）必须声明 inject，
// 否则 fiber 静默失败、工具一个都注册不上（机制同 agentLoopProvider 的 ctx.inject 包裹）。
knowledgeTools.inject = ['tools']

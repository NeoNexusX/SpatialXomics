/**
 * 给注释库按化合物来源重排：同一分子式的候选里，内源性物质排在前面。
 *
 * 应用按库文件里的先后排列同一分子式的候选，第一个候选就是显示名和导出的 Name。本脚本从
 * HMDB 官方 XML 读出每个化合物的来源信息，给库的每一行加一列 Origin，再按「来源等级 →
 * 编号数字升序」重排整个文件；应用不用改动。
 *
 * 来源等级（从前到后）：
 *  - endogenous：本体 Disposition → Source 含 Endogenous，且在人体样本中检出 / 定量过，或属于
 *    非药物通路；不含 Endogenous、但来源含 Animal / Microbe、检出过且有非药物通路的也算（如维生素 C）
 *  - expected：含 Endogenous，没检出过也没有通路，但有 KEGG / ChEBI 编号或组织 / 体液定位
 *  - unknown：其余；包括只有 Endogenous 标签而没有佐证的、没有来源信息的、XML 里查不到的
 *  - exogenous：不含 Endogenous，且有 DrugBank 编号、植物 / 真菌 / 食物 / 合成 / 环境来源之一，
 *    或分子式含卤素、硼、硅、砷等元素
 * 同一等级内按编号里的数字升序（HMDB 早期编号多为经典代谢物）。
 *
 * HMDB 的来源标注有错（个别药物也标了 Endogenous），可用 --overrides 指定一个 CSV
 * （两列 ID,Origin）逐条改写等级。
 *
 * 数据来源：Human Metabolome Database (HMDB)，https://hmdb.ca/downloads 的 All Metabolites XML
 * （需浏览器手动下载）。XML 版本应与库一致：库来自 HMDB 4.0 就用 4.0 的 XML。
 *
 * 用法：
 *   node scripts/rank-annotation-db.mjs <库.csv> <hmdb_metabolites.xml> [--overrides 改写.csv] [--out 输出.csv]
 * 默认输出到库文件旁边，文件名加 _rank 后缀；原有的列、BOM 和换行符保持不变。
 */

import { createReadStream } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import readline from 'node:readline'
import path from 'node:path'

/** 来源等级，按排序先后 */
const ORIGINS = ['endogenous', 'expected', 'unknown', 'exogenous']

/** SMPDB 的药物作用 / 药物代谢通路，不算内源证据 */
const DRUG_PATHWAY = /(Action Pathway|Antihistamine Action|Metabolism Pathway)$/
/** 卤素；后面不能紧跟小写字母（排除 Fe、In 等） */
const HALOGEN = /(?:F|Cl|Br|I)(?![a-z])/
/** 内源代谢物里基本不出现的元素 */
const EXOTIC = /(?:B|Si|As|Se|Sn|Pt|Hg|Pb|Al|Ti|Bi|Sb|Te|Ge|Au|Ag|Gd|Tc)(?![a-z])/

const ID_ALIASES = ['id', 'hmdb id', 'hmdb_id', 'accession', 'compound id', 'compound_id']
const FORMULA_ALIASES = ['formula', 'neutral formula', 'molecular formula']

/** 一个代谢物的来源等级（规则见文件头） */
function originOf(m) {
  const endo = m.source.has('Endogenous')
  const host = m.source.has('Biological > Animal') || m.source.has('Biological > Microbe')
  const observed = m.status === 'quantified' || m.status === 'detected'
  if (endo && (observed || m.pathways > 0)) return 'endogenous'
  if (!endo && host && observed && m.pathways > 0) return 'endogenous'
  if (endo) return m.kegg || m.chebi || m.located ? 'expected' : 'unknown'
  const sources = [...m.source]
  const natural = sources.some(
    (s) => s.startsWith('Biological > Plant') || s.startsWith('Biological > Fungi'),
  )
  const manMade = sources.some((s) => s.startsWith('Synthetic') || s.startsWith('Environmental'))
  const foreignElement = HALOGEN.test(m.formula) || EXOTIC.test(m.formula)
  if (m.drugbank || natural || m.source.has('Food') || manMade || foreignElement) {
    return 'exogenous'
  }
  return 'unknown'
}

/**
 * 流式读 HMDB XML（逐行看标签，与 build-hmdb-index 同法），返回 主编号 → 来源等级，
 * 以及 次要编号 → 主编号
 */
async function readHmdbOrigins(xmlPath) {
  const origins = new Map()
  const primaryOf = new Map()
  const rl = readline.createInterface({
    input: createReadStream(xmlPath, 'utf8'),
    crlfDelay: Infinity,
  })
  let m = null
  let inSecondary = false
  let inOntology = false
  let inPathways = false
  let inLocations = false
  /** 本体里从 root 到当前 descendant 的 term 链 */
  let terms = []

  for await (const raw of rl) {
    const line = raw.trim()
    if (line === '<metabolite>') {
      m = {
        acc: '',
        secondary: [],
        status: '',
        formula: '',
        kegg: '',
        chebi: '',
        drugbank: '',
        source: new Set(),
        pathways: 0,
        located: false,
      }
      continue
    }
    if (!m) continue
    if (line === '</metabolite>') {
      if (m.acc) {
        origins.set(m.acc, originOf(m))
        for (const s of m.secondary) primaryOf.set(s, m.acc)
      }
      m = null
      continue
    }

    // 本体：只收 Disposition → Source 下的 term，按路径记，如 'Biological > Animal'
    if (inOntology) {
      if (line === '</ontology>') inOntology = false
      else if (line === '<root>' || line === '<descendant>') terms.push('')
      else if (line === '</root>' || line === '</descendant>') terms.pop()
      else {
        const t = line.match(/^<term>(.*)<\/term>$/)
        if (t && terms.length > 0 && !terms[terms.length - 1]) {
          terms[terms.length - 1] = t[1]
          if (terms.length >= 3 && terms[0] === 'Disposition' && terms[1] === 'Source') {
            m.source.add(terms.slice(2).join(' > '))
          }
        }
      }
      continue
    }

    switch (line) {
      case '<ontology>':
        inOntology = true
        terms = []
        continue
      case '<secondary_accessions>':
        inSecondary = true
        continue
      case '</secondary_accessions>':
        inSecondary = false
        continue
      case '<pathways>':
        inPathways = true
        continue
      case '</pathways>':
        inPathways = false
        continue
      case '<biospecimen_locations>':
      case '<tissue_locations>':
        inLocations = true
        continue
      case '</biospecimen_locations>':
      case '</tissue_locations>':
        inLocations = false
        continue
    }

    const tag = line.match(/^<([a-z_]+)>(.*)<\/\1>$/)
    if (!tag) continue
    const [, name, value] = tag
    if (inSecondary) {
      if (name === 'accession') m.secondary.push(value)
      continue
    }
    if (inPathways) {
      if (name === 'name' && !DRUG_PATHWAY.test(value)) m.pathways++
      continue
    }
    if (inLocations) {
      if (value) m.located = true
      continue
    }
    // 顶层单值标签，只取第一次出现
    switch (name) {
      case 'accession':
        m.acc ||= value
        break
      case 'status':
        m.status ||= value
        break
      case 'chemical_formula':
        m.formula ||= value
        break
      case 'kegg_id':
        m.kegg ||= value
        break
      case 'chebi_id':
        m.chebi ||= value
        break
      case 'drugbank_id':
        m.drugbank ||= value
        break
    }
  }
  return { origins, primaryOf }
}

/** 拆一行 CSV，支持引号字段和 "" 转义 */
function splitCsvLine(line) {
  const fields = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') inQuotes = false
      else cur += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') {
      fields.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  fields.push(cur.trim())
  return fields
}

function findColumn(headers, aliases) {
  const normalized = headers.map((h) => h.trim().toLowerCase())
  for (const alias of aliases) {
    const i = normalized.indexOf(alias)
    if (i >= 0) return i
  }
  return -1
}

/** 改写表：ID,Origin 两列 */
async function readOverrides(file) {
  const out = new Map()
  const lines = (await readFile(file, 'utf8')).replace(/^﻿/, '').split(/\r?\n/)
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue
    const [id, origin] = splitCsvLine(line)
    const value = origin?.toLowerCase()
    if (id && ORIGINS.includes(value)) out.set(id, value)
    else console.warn(`overrides: skipped "${line}"`)
  }
  return out
}

/** 编号里的数字；没有数字的排在同级最后 */
function accessionNumber(id) {
  const digits = id.replace(/\D/g, '')
  return digits ? Number(digits) : Infinity
}

async function main() {
  const args = process.argv.slice(2)
  const option = (flag) => {
    const i = args.indexOf(flag)
    if (i < 0) return null
    const value = args[i + 1]
    args.splice(i, 2)
    return value
  }
  const overridesPath = option('--overrides')
  const outArg = option('--out')
  const [dbPath, xmlPath] = args
  if (!dbPath || !xmlPath) {
    console.error(
      'usage: node scripts/rank-annotation-db.mjs <annotation-db.csv> <hmdb_metabolites.xml> ' +
        '[--overrides overrides.csv] [--out output.csv]',
    )
    process.exit(1)
  }
  const parsed = path.parse(dbPath)
  const outPath = outArg ?? path.join(parsed.dir, `${parsed.name}_rank${parsed.ext}`)

  const text = await readFile(dbPath, 'utf8')
  const bom = text.charCodeAt(0) === 0xfeff ? '﻿' : ''
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.slice(bom.length).split(/\r?\n/)
  const trailingEol = lines[lines.length - 1] === ''
  let header = lines[0]
  let body = lines.slice(1).filter((l) => l.trim())
  // 输入已经是本脚本的输出：去掉旧的 Origin 列重新排
  if (/,\s*Origin\s*$/i.test(header)) {
    header = header.replace(/,\s*Origin\s*$/i, '')
    body = body.map((l) => l.replace(/,[^,]*$/, ''))
  }
  const headers = splitCsvLine(header)
  const idCol = findColumn(headers, ID_ALIASES)
  const formulaCol = findColumn(headers, FORMULA_ALIASES)
  if (idCol < 0 || formulaCol < 0) {
    console.error('annotation database CSV needs an ID column and a formula column')
    process.exit(1)
  }

  const { origins, primaryOf } = await readHmdbOrigins(xmlPath)
  const overrides = overridesPath ? await readOverrides(overridesPath) : new Map()

  const found = { primary: 0, secondary: 0, missing: 0 }
  const rows = body.map((line, index) => {
    const fields = splitCsvLine(line)
    const id = fields[idCol] ?? ''
    let origin = origins.get(id)
    if (origin) found.primary++
    else if (primaryOf.has(id)) {
      origin = origins.get(primaryOf.get(id))
      found.secondary++
    } else found.missing++
    origin = overrides.get(id) ?? origin ?? 'unknown'
    const formula = (fields[formulaCol] ?? '').replace(/\s+/g, '')
    return { line, index, id, formula, origin, num: accessionNumber(id) }
  })

  const firstBefore = new Map()
  for (const r of rows) if (!firstBefore.has(r.formula)) firstBefore.set(r.formula, r.id)

  rows.sort(
    (a, b) =>
      ORIGINS.indexOf(a.origin) - ORIGINS.indexOf(b.origin) || a.num - b.num || a.index - b.index,
  )

  const out = [`${header},Origin`, ...rows.map((r) => `${r.line},${r.origin}`)].join(eol)
  await writeFile(outPath, bom + out + (trailingEol ? eol : ''))

  const perFormula = new Map()
  for (const r of rows) perFormula.set(r.formula, (perFormula.get(r.formula) ?? 0) + 1)
  const firstAfter = new Map()
  for (const r of rows) if (!firstAfter.has(r.formula)) firstAfter.set(r.formula, r.id)
  const multi = [...perFormula].filter(([, n]) => n > 1).map(([f]) => f)
  const changed = multi.filter((f) => firstBefore.get(f) !== firstAfter.get(f)).length

  console.log(`rows: ${rows.length}`)
  console.log(
    `  found in XML: ${found.primary} by accession, ${found.secondary} by secondary accession, ` +
      `${found.missing} missing`,
  )
  if (overrides.size) console.log(`  overrides applied: ${overrides.size}`)
  for (const o of ORIGINS) console.log(`  ${o}: ${rows.filter((r) => r.origin === o).length}`)
  console.log(`formulas: ${perFormula.size}, with more than one candidate: ${multi.length}`)
  console.log(`  first candidate changed: ${changed}`)
  console.log(`wrote ${outPath}`)
}

main()

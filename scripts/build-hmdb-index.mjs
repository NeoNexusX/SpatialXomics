/**
 * 从 HMDB 官方 XML 构建代谢物生物学档案离线索引（public/data/hmdb-index.json）。
 *
 * 用途：SXO-Harness hmdb_lookup 工具（bioTools.ts）的离线数据源——
 * 代谢物 → 组织定位 / 疾病关联 / 生物功能，MSI 生物学解读的关键语义层。
 *
 * 数据来源与许可：Human Metabolome Database (HMDB)，David Wishart 组，
 * https://hmdb.ca（引用 Wishart et al., Nucleic Acids Research）。
 *
 * ⚠ hmdb.ca 对程序化下载返回 403（2026-10 实测）——需要**浏览器手动下载**：
 *   https://hmdb.ca/downloads → 「HMDB Metabolites」全量 XML
 *   （或按体液的子集：serum/urine/CSF/… XML 均可，脚本可多次传入合并构建）
 *
 * 用法：node scripts/build-hmdb-index.mjs <path/to/hmdb_metabolites.xml> [more.xml ...]
 * 输出格式（JSON 数组的数组）：
 *   [accession, name, formula, monoMass, keggId, tissues[], diseases[], biofunction]
 *   ~11 万条全量 ≈ 15-25MB；子集 XML 构建则随子集规模（推荐先建子集）。
 */

import { createReadStream, statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import readline from 'node:readline'
import path from 'node:path'

const OUT_DIR = path.resolve('public/data')
const OUT_FILE = path.join(OUT_DIR, 'hmdb-index.json')

/** 流式解析 HMDB XML（SAX 式：逐行看开/闭标签，只关心浅层字段） */
async function main() {
  const files = process.argv.slice(2)
  if (files.length === 0) {
    console.error(
      'usage: node scripts/build-hmdb-index.mjs <hmdb_metabolites.xml> [more_subset.xml ...]\n' +
        '       download the XML manually from https://hmdb.ca/downloads (server blocks scripts)',
    )
    process.exit(1)
  }

  const rows = []
  const seen = new Set()

  for (const file of files) {
    const rl = readline.createInterface({
      input: createReadStream(file, 'utf8'),
      crlfDelay: Infinity,
    })
    /** 当前 <metabolite> 的收集状态 */
    let cur = null
    let tag = null // 当前正在读的浅层标签名
    let text = ''
    let inBiospecimen = false
    let inDisease = false
    let diseaseName = ''

    const flush = () => {
      if (cur && cur.accession && cur.name) {
        if (!seen.has(cur.accession)) {
          seen.add(cur.accession)
          rows.push([
            cur.accession,
            cur.name,
            cur.formula ?? null,
            Number(cur.monoMass) || 0,
            cur.keggId ?? null,
            [...new Set(cur.tissues)],
            [...new Set(cur.diseases)],
            cur.biofunction ?? null,
          ])
        }
      }
      cur = null
    }

    for await (const raw of rl) {
      const line = raw.trim()
      if (line.startsWith('<metabolite>')) {
        flush()
        cur = { accession: null, name: null, formula: null, monoMass: null, keggId: null, tissues: [], diseases: [], biofunction: null }
        continue
      }
      if (line.startsWith('</metabolite>')) {
        flush()
        continue
      }
      if (!cur) continue

      // 深一层的结构：tissues → biospecimen/tissue；diseases → disease → name
      if (line.startsWith('<tissues>')) { inBiospecimen = true; continue }
      if (line.startsWith('</tissues>')) { inBiospecimen = false; continue }
      if (line.startsWith('<disease>')) { inDisease = true; diseaseName = ''; continue }
      if (line.startsWith('</disease>')) {
        if (diseaseName) cur.diseases.push(diseaseName.trim())
        inDisease = false
        continue
      }
      if (inBiospecimen) {
        const m = line.match(/^<tissue>(.*)<\/tissue>/)
        if (m && m[1]) cur.tissues.push(m[1].trim())
        continue
      }
      if (inDisease) {
        const m = line.match(/^<name>(.*)<\/name>/)
        if (m && m[1]) diseaseName = m[1]
        continue
      }

      // 浅层单值标签
      const open = line.match(/^<([a-zA-Z_]+)>(.*)$/)
      if (open && !open[0].startsWith('</')) {
        const name = open[1]
        const rest = open[2] ?? ''
        const selfClose = rest.match(/^(.*?)<\/([a-zA-Z_]+)>$/)
        if (selfClose && selfClose[2] === name) {
          const value = selfClose[1].trim()
          switch (name) {
            case 'accession': cur.accession = value; break
            case 'name': if (!cur.name) cur.name = value; break // 只留主名
            case 'chemical_formula': cur.formula = value; break
            case 'monisotopic_molecular_weight': cur.monoMass = value; break
            case 'kegg_id': cur.keggId = value || null; break
          }
          continue
        }
        // 多值标签：只取 description 里的生物功能句（"Biosynthesis of X."）
        if (name === 'description') { tag = 'description'; text = '' }
        continue
      }
      if (line.startsWith('</description>') && tag === 'description') {
        // HMDB description 常为一段功能描述；截首句作 biofunction
        if (!cur.biofunction && text.trim()) {
          cur.biofunction = text.replace(/\s+/g, ' ').trim().slice(0, 200)
        }
        tag = null
        continue
      }
      if (tag === 'description') text += raw
    }
    flush()
  }

  rows.sort((a, b) => a[1].localeCompare(b[1]))
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(OUT_FILE, JSON.stringify(rows))

  const withTissue = rows.filter((r) => r[5].length > 0).length
  const withDisease = rows.filter((r) => r[6].length > 0).length
  console.log(`entries: ${rows.length}`)
  console.log(`  with tissue localization: ${withTissue}`)
  console.log(`  with disease association: ${withDisease}`)
  console.log(`wrote ${OUT_FILE} (${(statSync(OUT_FILE).size / 1e6).toFixed(1)} MB)`)
}

main()

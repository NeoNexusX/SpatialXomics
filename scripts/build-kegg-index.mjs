/**
 * 从 KEGG REST 构建化合物→代谢通路离线索引（public/data/kegg-pathway-index.json）。
 *
 * 用途：SXO-Harness kegg_pathway_lookup 工具（bioTools.ts）的离线数据源。
 * rest.kegg.jp 无 CORS 头（浏览器无法直连），故构建期由 Node 拉取、
 * 打包为同源静态资源。
 *
 * 数据来源与许可：KEGG (Kanehisa Laboratories)，https://www.kegg.jp
 * （引用 Kanehisa et al., Nucleic Acids Research，需遵守 KEGG 学术使用条款）。
 *
 * 拉取（共 ~1.5MB 文本）：
 *   list/compound               ~1MB   cpd:C00001\tWater; H2O
 *   link/pathway/compound      ~490KB  cpd:C00022\tpath:map00010
 *   list/pathway/hsa             22KB  hsa00010\tGlycolysis / Gluconeogenesis
 *                                     （参考通路 map 编号 ↔ 各物种编号共数字段）
 *
 * 用法：node scripts/build-kegg-index.mjs
 * 输出格式：
 *   {
 *     pathways: { "map00010": "Glycolysis / Gluconeogenesis", ... },
 *     compounds: { "c00031": ["C00031", "D-Glucose", "Glucose"], ... },  // 键为小写 C-id
 *     links:     { "c00031": ["map00010", ...], ... }
 *   }
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { statSync } from 'node:fs'
import path from 'node:path'

const OUT_DIR = path.resolve('public/data')
const OUT_FILE = path.join(OUT_DIR, 'kegg-pathway-index.json')
const BASE = 'https://rest.kegg.jp'

async function fetchText(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`)
  return res.text()
}

async function main() {
  console.log('downloading KEGG lists (list/compound, link/pathway/compound, list/pathway/hsa)…')
  const [compoundsText, linksText, hsaPathwaysText] = await Promise.all([
    fetchText(`${BASE}/list/compound`),
    fetchText(`${BASE}/link/pathway/compound`),
    fetchText(`${BASE}/list/pathway/hsa`),
  ])

  // 参考通路名：hsa00010 → "Glycolysis / Gluconeogenesis"（map 编号共数字段）
  const pathways = {}
  for (const line of hsaPathwaysText.split('\n')) {
    const [id, name] = line.split('\t')
    if (!id || !name) continue
    const mapId = id.replace(/^hsa/, 'map')
    if (!pathways[mapId]) pathways[mapId] = name.trim()
  }

  // 化合物：c00031 → [C00031, ...names]（名称按 "; " 拆分为常用名/同义词）
  const compounds = {}
  for (const line of compoundsText.split('\n')) {
    const [id, namesRaw] = line.split('\t')
    if (!id || !namesRaw) continue
    const cid = id.replace(/^cpd:/, '')
    if (!compounds[cid.toLowerCase()]) {
      compounds[cid.toLowerCase()] = [cid, ...namesRaw.split(';').map((s) => s.trim()).filter(Boolean)]
    }
  }

  // 化合物 → 参考通路
  const links = {}
  for (const line of linksText.split('\n')) {
    const [cidRaw, pidRaw] = line.split('\t')
    if (!cidRaw || !pidRaw) continue
    const key = cidRaw.replace(/^cpd:/, '').toLowerCase()
    const mapId = pidRaw.replace(/^path:/, '').replace(/^hsa/, 'map')
    if (!mapId.startsWith('map')) continue
    ;(links[key] ??= []).push(mapId)
  }

  const index = { pathways, compounds, links }
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(OUT_FILE, JSON.stringify(index))

  const linked = Object.keys(links).length
  console.log(`compounds: ${Object.keys(compounds).length} (with pathway links: ${linked})`)
  console.log(`reference pathways (named via hsa): ${Object.keys(pathways).length}`)
  console.log(`wrote ${OUT_FILE} (${(statSync(OUT_FILE).size / 1e6).toFixed(2)} MB)`)
}

main()

/**
 * 从 LIPID MAPS 官方 LMSD SDF 构建前端本地脂质索引（public/data/lipidmaps-index.json）。
 *
 * 用途：SXO-Harness lipidmaps_* 工具的离线数据源（LIPID MAPS REST API 不带 CORS 头，
 * 浏览器无法直连；改为打包成同源静态资源，fetch 无跨域问题且完全离线可用）。
 *
 * 数据来源与许可：LIPID MAPS Structure Database (LMSD)，LIPID MAPS / UCSD-Babraham-
 * Swansea 联盟，https://www.lipidmaps.org（引用见 Conroy et al., Nucleic Acids Research
 * 2024, 52(D1):D1677, doi:10.1093/nar/gkad896）。免费使用，需署名。
 *
 * 下载源（约 22MB zip / 292MB 解压后）：
 *   https://www.lipidmaps.org/files/?file=LMSD&ext=sdf.zip
 *
 * 用法：node scripts/build-lipid-index.mjs <path/to/structures.sdf>
 * 输出格式（JSON 数组的数组，逐条为）：
 *   [lmId, abbreviation, name, formula, exactMass, category, mainClass, pubchemCid]
 *   缺失字段为 null；~5 万条 ≈ 5MB，静态资源 gzip 后 ~1.5MB，首次工具调用时拉取。
 */

import { createReadStream, statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import readline from 'node:readline'
import path from 'node:path'

const OUT_DIR = path.resolve('public/data')
const OUT_FILE = path.join(OUT_DIR, 'lipidmaps-index.json')

// 需要抽取的 SDF 属性字段
const FIELDS = [
  'LM_ID',
  'ABBREVIATION',
  'NAME',
  'FORMULA',
  'EXACT_MASS',
  'CATEGORY',
  'MAIN_CLASS',
  'PUBCHEM_CID',
]

async function main() {
  const sdfPath = process.argv[2]
  if (!sdfPath) {
    console.error('usage: node scripts/build-lipid-index.mjs <structures.sdf>')
    process.exit(1)
  }

  const rl = readline.createInterface({
    input: createReadStream(sdfPath, 'utf8'),
    crlfDelay: Infinity,
  })

  const rows = []
  let props = {} // 当前记录的属性
  let currentTag = null // 正在读取的 > <TAG>
  let recordCount = 0

  for await (const line of rl) {
    if (line.startsWith('$$$$')) {
      // 记录结束：只保留有分子式与精确质量的（可参与质量检索）
      if (props.FORMULA && props.EXACT_MASS) {
        rows.push([
          props.LM_ID ?? null,
          props.ABBREVIATION ?? null,
          props.NAME ?? null,
          props.FORMULA,
          Number(props.EXACT_MASS),
          props.CATEGORY ?? null,
          props.MAIN_CLASS ?? null,
          props.PUBCHEM_CID ? Number(props.PUBCHEM_CID) : null,
        ])
      }
      recordCount++
      props = {}
      currentTag = null
      continue
    }

    const m = line.match(/^> <([A-Za-z_0-9]+)>/)
    if (m) {
      currentTag = FIELDS.includes(m[1]) ? m[1] : null
      props[m[1]] = ''
    } else if (currentTag !== null && props[currentTag] === '') {
      // 属性值可能多行（如 SYNONYMS），只留首行
      props[currentTag] = line.trim()
    }
  }

  // 按精确质量排序，质量窗口检索可顺序扫描即止
  rows.sort((a, b) => a[4] - b[4])

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(OUT_FILE, JSON.stringify(rows))

  const withAbbrev = rows.filter((r) => r[1] !== null).length
  const withName = rows.filter((r) => r[2] !== null).length
  const categories = new Map()
  for (const r of rows) categories.set(r[5], (categories.get(r[5]) ?? 0) + 1)

  console.log(`records in SDF: ${recordCount}`)
  console.log(`index entries (formula+mass): ${rows.length}`)
  console.log(`  with abbreviation: ${withAbbrev}, with name: ${withName}`)
  console.log('by category:', JSON.stringify(Object.fromEntries(categories)))
  console.log(`wrote ${OUT_FILE} (${(statSync(OUT_FILE).size / 1e6).toFixed(1)} MB)`)
}

main()

/**
 * SI_DB 注释接口的本地 mock 后端（联调用，部署真后端后删除即可）。
 *
 * 按后端对接说明（public/说明 (2).md）实现三个路由，跑在 vite 代理的默认目标
 * http://localhost:8000：
 *   POST /annotations/si-db/list          分页查询（需 Authorization: Bearer xxx）
 *   GET  /annotations/si-db/download      两步下载第一步：返回直链
 *   GET  /annotations/si-db/relay/download?token=...  第二步：CSV 本体
 *
 * 用法：node scripts/mock-si-db.mjs
 */
import { createServer } from 'node:http'

const PORT = 8000
// 5 行样本，字段/信封与真后端一致（entry_key 而非 id）
const ROWS = [
  { entry_key: 'HMDB0000001', name: '1-Methylhistidine', formula: 'C7H11N3O2', mass: 169.0851266, origin: 'endogenous', inchi: 'InChI=1S/C7H11N3O2/x' },
  { entry_key: 'HMDB0000002', name: '1,3-Diaminopropane', formula: 'C3H10N2', mass: 74.08439833, origin: 'endogenous', inchi: 'InChI=1S/C3H10N2/x' },
  { entry_key: 'HMDB0000005', name: '2-Ketobutyric acid', formula: 'C4H6O3', mass: 102.0316941, origin: 'exogenous', inchi: 'InChI=1S/C4H6O3/x' },
  { entry_key: 'HMDB0000008', name: '2-Hydroxyphenylacetic acid', formula: 'C8H8O3', mass: 152.0473441, origin: 'expected', inchi: 'InChI=1S/C8H8O3/x' },
  { entry_key: 'HMDB0011121', name: 'D-Glucose', formula: 'C6H12O6', mass: 180.0633881, origin: 'unknown', inchi: 'InChI=1S/C6H12O6/x' },
]

const CSV_BODY = [
  'ID,Name,Formula,InChI,Mass,Origin',
  ...ROWS.map((r) => `${r.entry_key},${r.name},${r.formula},"${r.inchi}",${r.mass},${r.origin}`),
  // 造到 38.5MB 量级没意义，联调只验证链路与文件名
].join('\n')

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)

  if (url.pathname === '/annotations/si-db/list' && req.method === 'POST') {
    // 对接说明：所有接口需登录态，未登录一律 401
    if (!/^Bearer /.test(req.headers.authorization ?? '')) {
      return json(res, 401, { detail: 'Not authenticated' })
    }
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const filters = body ? JSON.parse(body) : {}
      const page = Math.max(1, Number(url.searchParams.get('page') ?? 1))
      const size = Math.min(100, Math.max(1, Number(url.searchParams.get('size') ?? 10)))
      const rows = ROWS.filter(
        (r) =>
          (!filters.entry_key || r.entry_key.toLowerCase().includes(filters.entry_key.toLowerCase())) &&
          (!filters.name || r.name.toLowerCase().includes(filters.name.toLowerCase())) &&
          (!filters.formula || r.formula.toLowerCase().includes(filters.formula.toLowerCase())) &&
          (!filters.origin || r.origin === filters.origin) &&
          (filters.mass_min == null || r.mass >= filters.mass_min) &&
          (filters.mass_max == null || r.mass <= filters.mass_max),
      )
      const totalPages = Math.max(1, Math.ceil(rows.length / size))
      const current = Math.min(page, totalPages)
      json(res, 200, {
        meta: {
          current_page: current,
          current_records: Math.min(size, rows.length - (current - 1) * size),
          total_pages: totalPages,
          total_records: rows.length,
        },
        data: rows.slice((current - 1) * size, current * size),
      })
    })
    return
  }

  if (url.pathname === '/annotations/si-db/download' && req.method === 'GET') {
    if (!/^Bearer /.test(req.headers.authorization ?? '')) {
      return json(res, 401, { detail: 'Not authenticated' })
    }
    return json(res, 200, {
      filename: 'SI_DB.csv',
      url: `http://localhost:${PORT}/annotations/si-db/relay/download?token=short-lived-token`,
      size: Buffer.byteLength(CSV_BODY),
    })
  }

  if (url.pathname === '/annotations/si-db/relay/download') {
    // 第二步无需登录头；带 Content-Disposition 触发浏览器下载
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="SI_DB.csv"',
    })
    return res.end(CSV_BODY)
  }

  json(res, 404, { detail: 'Not Found' })
})

server.listen(PORT, () => console.log(`[mock-si-db] listening on http://localhost:${PORT}`))

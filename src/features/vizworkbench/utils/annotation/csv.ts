/**
 * CSV 读取的通用小工具：编码识别、分隔符识别、带引号字段的拆分、表头别名匹配。
 */

/** 先按 UTF-8 严格解码；失败（中文 Excel 导出的 GBK/GB18030）再按 gb18030 解码 */
export function decodeCsvBytes(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('gb18030').decode(buf)
  }
}

/**
 * 拆成行：去 BOM、统一换行、去掉行尾空白、丢掉空行。
 * 行尾空白要去：从表格软件里复制出来的 CSV 常在行尾带一串制表符，留着会让分隔符识别成 Tab。
 */
export function csvLines(text: string): string[] {
  const cleaned = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  return cleaned
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.length > 0)
}

/** 选能把首行拆出最多字段的分隔符 */
export function detectDelimiter(line: string): string {
  let best = ','
  let bestCount = -1
  for (const d of [',', '\t', ';', '|']) {
    let count = 0
    let inQuotes = false
    for (const ch of line) {
      if (ch === '"') inQuotes = !inQuotes
      else if (ch === d && !inQuotes) count++
    }
    if (count > bestCount) {
      bestCount = count
      best = d
    }
  }
  return best
}

/** 拆一行，支持引号字段和 "" 转义 */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      fields.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  fields.push(cur.trim())
  return fields
}

/** 表头归一化：NFKC（全角转半角）、小写、合并空白、去掉末尾句点 */
export function normalizeHeader(h: string): string {
  return h.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.+$/, '')
}

/** 在表头里找第一个命中别名的列；没有返回 -1 */
export function findColumn(headers: string[], aliases: readonly string[]): number {
  const normalized = headers.map(normalizeHeader)
  for (const alias of aliases) {
    const i = normalized.indexOf(alias)
    if (i >= 0) return i
  }
  return -1
}

/** 数值单元格：去掉千分位逗号；非有限数返回 NaN */
export function parseNumberCell(raw: string | undefined): number {
  const s = (raw ?? '').trim().replace(/,/g, '')
  if (!s) return NaN
  const v = Number(s)
  return Number.isFinite(v) ? v : NaN
}

import { t } from '@/i18n'

type ImzMLParam = {
  tagName: 'cvParam' | 'userParam'
  accession?: string
  name: string
  value: string
}

type ImzMLMSSettings = {
  polarity?: 'positive' | 'negative'
  ionSource?: string
  analyzer?: string
  pixelSizeX?: number
  pixelSizeY?: number
  spectrum_mode?: 'profile' | 'centroid'
  storage_mode?: 'continuous' | 'processed'
}

function safeNumber(v: any): number | undefined {
  if (v === undefined || v === null) return undefined
  const n = Number((v as any).toString().trim())
  return Number.isFinite(n) ? n : undefined
}

async function readHeadText(file: File): Promise<string> {
  const sizes = [2 * 1024 * 1024, 5 * 1024 * 1024, 10 * 1024 * 1024]
  for (const size of sizes) {
    if (size >= file.size) return file.text()
    const text = await file.slice(0, size).text()
    if (text.includes('<cvParam') || text.includes('<userParam')) return text
  }
  // Even if tags not found in head, return the 10MB slice — string matching can use it
  return file.slice(0, sizes[sizes.length - 1]).text()
}

export async function parseImzMLMSSettings(file: File): Promise<ImzMLMSSettings> {
  try {
    const text = await readHeadText(file)

    // Validate: check for known imzML structural tags
    const structuralTags = ['<mzML', '<fileDescription', '<run', '<spectrumList']
    const hasStructure = structuralTags.some((tag) => text.includes(tag))
    if (!hasStructure) {
      throw new Error(t('upload.error.invalidImzml'))
    }

    const params = extractParamsFromImzML(text)
    return {
      polarity: parsePolarity(params),
      ionSource: parseIonSource(params),
      analyzer: parseAnalyzer(params),
      ...parsePixelSize(params),
      spectrum_mode: parseSpectrumMode(text),
      storage_mode: parseStorageMode(text),
    }
  } catch {
    return {}
  }
}

function extractParamsFromImzML(xmlText: string): ImzMLParam[] {
  const out: ImzMLParam[] = []
  try {
    // Match cvParam tags: self-closing (<cvParam .../>) or open-close (<cvParam ...></cvParam>)
    const cvRe = /<cvParam\s+([^>]*?)\s*\/?>(?:\s*<\/cvParam>)?/gi
    let m: RegExpExecArray | null
    while ((m = cvRe.exec(xmlText)) !== null) {
      const attrs = m[1]!
      const acc = extractAttr(attrs, 'accession')
      const name = extractAttr(attrs, 'name')
      const value = extractAttr(attrs, 'value')
      if (name) out.push({ tagName: 'cvParam', accession: acc || undefined, name, value })
    }
    // Match userParam tags: self-closing or open-close
    const userRe = /<userParam\s+([^>]*?)\s*\/?>(?:\s*<\/userParam>)?/gi
    while ((m = userRe.exec(xmlText)) !== null) {
      const attrs = m[1]!
      const name = extractAttr(attrs, 'name')
      const value = extractAttr(attrs, 'value')
      if (name) out.push({ tagName: 'userParam', name, value })
    }
  } catch {
    /* ignore */
  }
  return out
}

function extractAttr(attrs: string, name: string): string {
  const re = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i')
  const m = attrs.match(re)
  return m ? m[1]!.trim() : ''
}

/* ---------- field parsers (strict per request) ---------- */

function parsePolarity(params: ImzMLParam[]): 'positive' | 'negative' | undefined {
  // 1) accession priority
  for (const p of params) {
    const acc = (p.accession || '').toUpperCase()
    if (acc === 'MS:1000130') return 'positive'
    if (acc === 'MS:1000129') return 'negative'
  }
  // 2) strict name fallback (case-insensitive exact match)
  for (const p of params) {
    const name = (p.name || '').toString().trim().toLowerCase()
    if (name === 'positive scan') return 'positive'
    if (name === 'negative scan') return 'negative'
  }
  return undefined
}

function parseIonSource(params: ImzMLParam[]): string | undefined {
  const norm = (s: string) =>
    s.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim()

  const allText = params
    .map((p) => norm(`${p.name || ''} ${p.value || ''}`))
    .join(' ')

  // 1) Accession-priority sources — standard MS CV terms
  const accPriority: [string, string][] = [
    ['MS:1000239', 'AP-MALDI'],
    ['MS:1002011', 'DESI'],
    ['MS:1000405', 'SALDI'],
    ['MS:1000075', 'MALDI'],
  ]
  for (const [acc, label] of accPriority) {
    if (params.some((p) => (p.accession || '').toUpperCase() === acc)) return label
  }

  // 2) Text-priority sources — no standard accession, rely on text
  if (/\bap\s+smaldi\s*5\s+af\b/i.test(allText)) return 'AP-SMALDI5 AF'
  if (/\bap\s+smaldi\b/i.test(allText)) return 'AP-SMALDI'
  if (/\bir\s+maldesi\b/i.test(allText)) return 'IR-MALDESI'
  if (/\bmaldi[\s-]+2\b/i.test(allText)) return 'MALDI-2'
  if (/\bnano[\s-]+desi\b/i.test(allText)) return 'nano-DESI'
  if (/\bsims\b/i.test(allText) || /secondary\s+ion\s+mass\s+spectrometry/i.test(allText)) return 'SIMS'
  if (/\bldi\b/i.test(allText)) return 'LDI'

  // 3) Text fallback for accession-priority sources (when accession missing)
  if (/\bap\s+maldi\b/i.test(allText) || /atmospheric\s+pressure\s+matrix/i.test(allText)) return 'AP-MALDI'
  if (/\bdesi\b/i.test(allText) || /desorption\s+electrospray/i.test(allText)) return 'DESI'
  if (/\bsaldi\b/i.test(allText) || /surface.assisted\s+laser/i.test(allText)) return 'SALDI'
  if (/\bmaldi\b/i.test(allText) || /matrix.assisted\s+laser/i.test(allText)) return 'MALDI'

  return undefined
}

function parseAnalyzer(params: ImzMLParam[]): string | undefined {
  const norm = (s: string) =>
    s.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim()

  const allText = params
    .map((p) => norm(`${p.name || ''} ${p.value || ''}`))
    .join(' ')

  // 1) Specific instrument model text recognition
  if (/\borbitrap\s+exploris\s+480\b/i.test(allText) || /\bexploris\s+480\b/i.test(allText)) return 'Orbitrap Exploris 480'
  if (/\borbitrap\s+exploris\s+240\b/i.test(allText) || /\bexploris\s+240\b/i.test(allText)) return 'Orbitrap Exploris 240'
  if (/\borbitrap\s+exploris\s+120\b/i.test(allText) || /\bexploris\s+120\b/i.test(allText)) return 'Orbitrap Exploris 120'
  if (/\bq\s+exactive\s+hf\b/i.test(allText) || /\bq\s+exactive\s+orbitrap\s+hf\b/i.test(allText)) return 'Q Exactive HF'
  if (/\bq\s+exactive\b/i.test(allText)) return 'Q Exactive'
  if (/\btimstof\s+flex\b/i.test(allText)) return 'timsTOF fleX'

  // 2) Accession mapping
  const accMap: Record<string, string> = {
    'MS:1000484': 'Orbitrap',
    'MS:1000079': 'FTICR',
    'MS:1000084': 'TOF',
  }
  for (const p of params) {
    const label = accMap[(p.accession || '').toUpperCase()]
    if (label) return label
  }

  // 3) Generic text fallback
  if (/\borbitrap\b/i.test(allText)) return 'Orbitrap'
  if (/\bfticr\b/i.test(allText) || /\bft[\s-]?icr\b/i.test(allText) || /fourier\s+transform\s+ion\s+cyclotron\s+resonance/i.test(allText)) return 'FTICR'
  if (/\btime[\s-]of[\s-]flight\b/i.test(allText) || /\btof\b/i.test(allText)) return 'TOF'
  if (/\bftms\b/i.test(allText)) return 'FTMS'

  return undefined
}

/* m/z range parsing removed — not needed in current UI */

function parsePixelSize(params: ImzMLParam[]): { pixelSizeX?: number; pixelSizeY?: number } {
  let x: number | undefined
  let y: number | undefined

  // Strict name matching only (case-insensitive exact match after trim)
  for (const p of params) {
    const nameRaw = (p.name || '').toString().trim().toLowerCase()
    if (nameRaw === 'pixel size x') {
      const v = safeNumber(p.value)
      if (v !== undefined) x = v
    } else if (nameRaw === 'pixel size y') {
      const v = safeNumber(p.value)
      if (v !== undefined) y = v
    }
    if (x !== undefined && y !== undefined) break
  }

  return { pixelSizeX: x, pixelSizeY: y }
}

/* helpers */
function parseSpectrumMode(text: string): 'profile' | 'centroid' | undefined {
  if (text.includes('MS:1000127')) return 'centroid'
  if (text.includes('MS:1000128')) return 'profile'
  return undefined
}

function parseStorageMode(text: string): 'continuous' | 'processed' | undefined {
  if (text.includes('IMS:1000030')) return 'continuous'
  if (text.includes('IMS:1000031')) return 'processed'
  return undefined
}

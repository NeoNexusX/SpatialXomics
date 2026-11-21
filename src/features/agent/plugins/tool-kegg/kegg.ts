/** Live KEGG REST access through a fixed same-origin proxy; no downloaded index. */
import { abortable } from '../llm'
import { isPng } from '../tools'

type Pair = [string, string]

/** KEGG get and list accept up to ten explicit entry identifiers per request. */
export const KEGG_ENTRY_LIMIT = 10

function entryIdList(ids: string[]): string {
  if (ids.length === 0 || ids.length > KEGG_ENTRY_LIMIT) {
    throw new Error(
      `KEGG get/list accepts 1–${KEGG_ENTRY_LIMIT} ids per request (received ${ids.length})`,
    )
  }
  if (ids.some((id) => !/^(?:C\d{5}|[a-z]{2,4}\d{5})$/.test(id))) {
    throw new Error('Invalid KEGG entry identifier')
  }
  return [...new Set(ids)].join('+')
}

export interface KeggCompound {
  id: string
  names: string[]
}

export interface KeggEntry {
  id: string
  names: string[]
  formula?: string
  exactMass?: number
  molecularWeight?: number
  pathways: { id: string; name: string }[]
  dblinks: { database: string; values: string[] }[]
  class?: string
  description?: string
}

type AtextRecord = { fields: Map<string, string[]> }

/** Parse KEGG's 12-column a-text format, retaining only fields used by the tools. */
export function parseAtext(text: string): KeggEntry[] {
  const records: AtextRecord[] = []
  let fields = new Map<string, string[]>()
  let lastKey = ''
  let populated = false
  const flush = () => {
    if (populated) records.push({ fields })
    fields = new Map()
    lastKey = ''
    populated = false
  }
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '///') {
      flush()
      continue
    }
    if (!line.trim()) continue
    const continuation = /^\s/.test(line)
    const key = continuation ? lastKey : line.slice(0, 12).trim()
    // Real entries contain bare key-only lines (e.g. pathway "REFERENCE   " padded to
    // column 12 with no value); only a continuation before any key is malformed.
    if (!key) {
      throw new Error('Invalid KEGG a-text response: expected 12-column fields')
    }
    const value = line.slice(12).trim()
    if (!fields.has(key)) fields.set(key, [])
    if (value) fields.get(key)!.push(value)
    lastKey = key
    populated = true
  }
  flush()

  const entries = records.flatMap(({ fields }) => {
    const id = (fields.get('ENTRY')?.[0] ?? '').split(/\s+/)[0]!.replace(/^(?:cpd|path):/i, '')
    // Other records in a multi-entry response can still be valid.
    if (!/^(?:C\d{5}|[a-z]{2,4}\d{5})$/.test(id)) return []
    const numberField = (key: string): number | undefined => {
      const raw = fields.get(key)?.[0]
      if (!raw) return undefined
      const value = Number(raw)
      if (!Number.isFinite(value)) return undefined
      return value
    }
    const pathways = (fields.get('PATHWAY') ?? []).flatMap((value) => {
      const match = /^(map\d{5})\s+(.+)$/.exec(value)
      return match ? [{ id: match[1]!, name: match[2]!.trim() }] : []
    })
    const dblinkMap = new Map<string, string[]>()
    for (const value of fields.get('DBLINKS') ?? []) {
      const match = /^([^:]+):\s*(.*)$/.exec(value)
      if (!match) continue
      const database = match[1]!.trim()
      // KEGG separates multiple values with spaces (live C00031 "CAS: 50-99-7 2280-44-6");
      // commas are accepted too for robustness.
      const values = match[2]!.split(/[\s,]+/).filter(Boolean)
      dblinkMap.set(database, [...new Set([...(dblinkMap.get(database) ?? []), ...values])])
    }
    const names = (fields.get('NAME') ?? [])
      .join(' ')
      .split(';')
      .map((name) => name.trim())
      .filter(Boolean)
    return [
      {
        id,
        names,
        formula: fields.get('FORMULA')?.[0],
        exactMass: numberField('EXACT_MASS'),
        molecularWeight: numberField('MOL_WEIGHT'),
        pathways,
        dblinks: [...dblinkMap].map(([database, values]) => ({ database, values })),
        class: fields.get('CLASS')?.join('; '),
        description: fields.get('DESCRIPTION')?.join(' ').trim(),
      },
    ]
  })
  if (!entries.length && records.length) {
    throw new Error('Invalid KEGG a-text response: missing or invalid ENTRY identifier')
  }
  return entries
}

// KEGG permits at most three requests/second. Share start times across tool calls.
let queue: Promise<void> = Promise.resolve()
let lastStart = 0

async function schedule(signal?: AbortSignal): Promise<void> {
  const ready = queue.then(async () => {
    signal?.throwIfAborted()
    const delay = Math.max(0, lastStart + 350 - Date.now())
    if (delay) {
      const wait = () => new Promise<void>((resolve) => setTimeout(resolve, delay))
      await (signal ? abortable(wait, signal) : wait())
    }
    signal?.throwIfAborted()
    lastStart = Date.now()
  })
  queue = ready.catch(() => {})
  await (signal ? abortable(() => ready, signal) : ready)
}

function pairs(text: string): Pair[] {
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const tab = line.indexOf('\t')
      if (tab <= 0 || !line.slice(tab + 1).trim()) {
        throw new Error('Invalid KEGG REST response: expected a tab-separated identifier and value')
      }
      return [
        line
          .slice(0, tab)
          .trim()
          .replace(/^(?:cpd|path):/, ''),
        line.slice(tab + 1).trim(),
      ]
    })
}

// PNG helpers are shared with the PubChem structure images; re-exported here so
// existing `../kegg` imports (and their tests) keep resolving.
export { isPng, pngDimensions, pngDataUrl } from '../tools'

export class KeggClient {
  constructor(private readonly signal?: AbortSignal) {}

  private async fetchText(path: string, opts: { allow404?: boolean } = {}): Promise<string> {
    await schedule(this.signal)
    const timeout = AbortSignal.timeout(20_000)
    const signal = this.signal ? AbortSignal.any([this.signal, timeout]) : timeout
    let response: Response
    let body: string
    try {
      response = await fetch(`${import.meta.env.BASE_URL}kegg-rest/${path}`, {
        signal,
        headers: { Accept: 'text/plain' },
      })
      body = await response.text()
    } catch (error) {
      this.signal?.throwIfAborted()
      throw new Error(
        `KEGG REST request failed (network/timeout): ${(error as Error).message}. Check the /kegg-rest/ proxy to https://rest.kegg.jp.`,
      )
    }
    this.signal?.throwIfAborted()
    if (response.status === 404 && opts.allow404) return ''
    if (!response.ok)
      throw new Error(
        `KEGG REST HTTP ${response.status} for ${path}; query failed, not evidence of no pathway membership.`,
      )
    if (response.headers.get('content-type')?.includes('text/html') || /^\s*</.test(body)) {
      throw new Error(
        'KEGG REST proxy returned HTML. Configure /kegg-rest/ to forward to https://rest.kegg.jp instead of the SPA fallback.',
      )
    }
    return body
  }

  private async request(path: string): Promise<Pair[]> {
    const rows = pairs(await this.fetchText(path))
    if (rows.some(([id]) => !/^(?:C\d{5}|[a-z]{2,4}\d{5})$/.test(id))) {
      throw new Error('Invalid KEGG REST response: unexpected entry identifiers')
    }
    return rows
  }

  async findCompounds(query: string): Promise<KeggCompound[]> {
    const id = query.trim().replace(/^cpd:/i, '').toUpperCase()
    const rows = /^C\d{5}$/.test(id)
      ? await this.list([id])
      : // No /nop: default DBGET processing ANDs multi-word queries (API manual
        // "find"). /nop would treat the whole string as one substring and return
        // nothing for e.g. "glucose phosphate".
        await this.request(`find/compound/${encodeURIComponent(query.trim())}`)
    return rows
      .filter(([key]) => /^C\d{5}$/.test(key))
      .map(([key, names]) => ({
        id: key,
        names: names
          .split(';')
          .map((name) => name.trim())
          .filter(Boolean),
      }))
  }

  async findExactMass(lo: number, hi: number): Promise<{ id: string; exactMass: number }[]> {
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi < lo) {
      throw new Error('Invalid KEGG exact-mass range')
    }
    const rows = await this.request(`find/compound/${lo.toFixed(6)}-${hi.toFixed(6)}/exact_mass`)
    return rows.map(([id, value]) => {
      const exactMass = Number(value)
      if (!/^C\d{5}$/.test(id) || !Number.isFinite(exactMass) || exactMass <= 0) {
        throw new Error(
          'Invalid KEGG exact_mass response: expected a compound id and a positive mass',
        )
      }
      return { id, exactMass }
    })
  }

  async findPathways(query: string): Promise<Pair[]> {
    const id = query.trim().replace(/^path:/i, '')
    // The map-only filter applies to the id shortcut too: an organism code
    // (hsa/rn/...) resolves via list but is not a map entry, so callers see an
    // empty result and can emit the map-form hint.
    if (/^[a-z]{2,4}\d{5}$/i.test(id))
      return (await this.list([id.toLowerCase()])).filter(([key]) => /^map\d{5}$/.test(key))
    return (await this.request(`find/pathway/${encodeURIComponent(query.trim())}`)).filter(
      ([key]) => /^map\d{5}$/.test(key),
    )
  }

  async list(ids: string[]): Promise<Pair[]> {
    return this.request(`list/${entryIdList(ids)}`)
  }

  async getEntries(ids: string[]): Promise<KeggEntry[]> {
    // An all-unknown get returns 404. A mixed request returns only the records KEGG found.
    const body = await this.fetchText(`get/${entryIdList(ids)}`, { allow404: true })
    return parseAtext(body)
  }

  /**
   * Official REST `get/<map>/image` returns the pathway map as PNG. It goes through
   * the same /kegg-rest/ proxy as the text endpoints (www.kegg.jp is NOT proxied).
   */
  async pathwayImage(id: string): Promise<Uint8Array> {
    if (!/^map\d{5}$/.test(id)) throw new Error('Provide a KEGG map id for the pathway image')
    await schedule(this.signal)
    const timeout = AbortSignal.timeout(20_000)
    const signal = this.signal ? AbortSignal.any([this.signal, timeout]) : timeout
    let response: Response
    let bytes: Uint8Array
    try {
      response = await fetch(`${import.meta.env.BASE_URL}kegg-rest/get/${id}/image`, {
        signal,
        headers: { Accept: 'image/png' },
      })
      bytes = new Uint8Array(await response.arrayBuffer())
    } catch (error) {
      this.signal?.throwIfAborted()
      throw new Error(
        `KEGG pathway image request failed (network/timeout): ${(error as Error).message}. Check the /kegg-rest/ proxy to https://rest.kegg.jp.`,
      )
    }
    this.signal?.throwIfAborted()
    if (!response.ok)
      throw new Error(
        `KEGG REST HTTP ${response.status} for get/${id}/image; the map image is unavailable, not evidence about the pathway.`,
      )
    if (!isPng(bytes))
      throw new Error(
        'KEGG pathway image response was not a PNG. Configure /kegg-rest/ to forward to https://rest.kegg.jp instead of the SPA fallback.',
      )
    return bytes
  }

  async pathwayCompounds(ids: string[]): Promise<Map<string, Set<string>>> {
    if (!ids.length || ids.some((id) => !/^map\d{5}$/.test(id))) {
      throw new Error('Provide KEGG map ids for the compound link query')
    }
    const members = new Map(ids.map((id) => [id, new Set<string>()]))
    const rows = await this.request(`link/compound/${[...members.keys()].join('+')}`)
    for (const [map, target] of rows) {
      const compound = target.replace(/^cpd:/, '')
      const group = members.get(map)
      if (!group || !/^C\d{5}$/.test(compound)) {
        throw new Error(
          'Invalid KEGG link response: expected a requested pathway and a compound id',
        )
      }
      group.add(compound)
    }
    return members
  }
}

export function compoundLink(id: string, label = id): string {
  return `[${label.replace(/[\[\]]/g, '').replace(/\|/g, '\\|')}](https://www.kegg.jp/entry/${id})`
}

export function pathwayLink(id: string, label: string): string {
  return `[${label.replace(/[\[\]]/g, '').replace(/\|/g, '\\|')} (${id})](https://www.kegg.jp/pathway/${id})`
}

export function keggSource(): string {
  return `source: KEGG REST API (live query; retrieved ${new Date().toISOString()}; https://rest.kegg.jp)`
}

/** Live KEGG REST access through a fixed same-origin proxy; no downloaded index. */
import { abortable } from '../llm'

type Pair = [string, string]
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
    // Skip single malformed entries rather than failing the whole 10-id chunk.
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

export function normalizeKeggName(value: string): string {
  return value.toLowerCase().replace(/[\s_/(),-]/g, '')
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
        throw new Error(
          'Invalid KEGG REST response: expected tab-separated identifiers and names/links',
        )
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

/** Responses are deduplicated only within this invocation, never persisted. */
export class KeggClient {
  private responses = new Map<string, Promise<Pair[]>>()
  private textResponses = new Map<string, Promise<string>>()
  private signal: AbortSignal | undefined

  constructor(signal?: AbortSignal) {
    this.signal = signal
  }

  private request(path: string): Promise<Pair[]> {
    this.signal?.throwIfAborted()
    let result = this.responses.get(path)
    if (!result) {
      // No error-cascade abort on purpose: with requests funneled through the
      // shared 350ms limiter, killing the client on the first 429/5xx would
      // poison every queued sibling request (e.g. the other 49 pathway
      // queries). Cancellation is carried by the caller's signal alone.
      result = this.fetchPairs(path)
      this.responses.set(path, result)
    }
    return result
  }

  requestText(path: string): Promise<string> {
    this.signal?.throwIfAborted()
    let result = this.textResponses.get(path)
    if (!result) {
      result = this.fetchText(path)
      this.textResponses.set(path, result)
    }
    return result
  }

  /**
   * Like requestText, but a 404 resolves to '' instead of rejecting: an
   * all-unknown 10-id get chunk answers 404 (live-verified), and that must
   * read as "these entries are absent", never as a failure that poisons the
   * sibling chunks of the same invocation.
   */
  private requestTextAllowMissing(path: string): Promise<string> {
    this.signal?.throwIfAborted()
    const cached = this.textResponses.get(path)
    if (cached) return cached
    const result = this.fetchText(path, { allow404: true })
    this.textResponses.set(path, result)
    return result
  }

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

  private async fetchPairs(path: string): Promise<Pair[]> {
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

  async findExactMass(lo: number, hi: number): Promise<Pair[]> {
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi < lo) {
      throw new Error('Invalid KEGG exact-mass range')
    }
    return this.request(`find/compound/${lo.toFixed(6)}-${hi.toFixed(6)}/exact_mass`)
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
    const unique = [...new Set(ids)]
    const result: Pair[] = []
    // KEGG list accepts at most ten identifiers per request.
    for (let i = 0; i < unique.length; i += 10) {
      result.push(...(await this.request(`list/${unique.slice(i, i + 10).join('+')}`)))
    }
    return result
  }

  async getEntries(ids: string[]): Promise<KeggEntry[]> {
    const unique = [...new Set(ids)]
    const result: KeggEntry[] = []
    // KEGG get accepts at most ten identifiers per request. A chunk whose ids
    // are ALL unknown answers 404 → treat as absent entries (allow404), so one
    // unknown id in a batch degrades to the per-id "not returned" message
    // instead of failing the whole call (mixed chunks return 200-partial).
    for (let i = 0; i < unique.length; i += 10) {
      const body = await this.requestTextAllowMissing(`get/${unique.slice(i, i + 10).join('+')}`)
      result.push(...parseAtext(body))
    }
    return result
  }

  async compoundPathways(ids: string[]): Promise<Map<string, string[]>> {
    const unique = [...new Set(ids)]
    const links = new Map<string, string[]>()
    for (let i = 0; i < unique.length; i += 10) {
      for (const [cid, target] of await this.request(
        `link/pathway/${unique.slice(i, i + 10).join('+')}`,
      )) {
        const map = target.replace(/^path:/, '')
        if (!/^C\d{5}$/.test(cid) || !/^map\d{5}$/.test(map)) continue
        links.set(cid, [...new Set([...(links.get(cid) ?? []), map])])
      }
    }
    return links
  }

  async pathwayCompounds(id: string): Promise<string[]> {
    return (await this.request(`link/compound/${id}`))
      .map(([, target]) => target.replace(/^cpd:/, ''))
      .filter((cid) => /^C\d{5}$/.test(cid))
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

/** Live KEGG REST access through a fixed same-origin proxy; no downloaded index. */
import { abortable } from '../llm'

type Pair = [string, string]
export interface KeggCompound {
  id: string
  names: string[]
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
  private controller = new AbortController()
  private signal: AbortSignal

  constructor(signal?: AbortSignal) {
    this.signal = signal
      ? AbortSignal.any([signal, this.controller.signal])
      : this.controller.signal
  }

  private request(path: string): Promise<Pair[]> {
    this.signal?.throwIfAborted()
    let result = this.responses.get(path)
    if (!result) {
      result = this.fetchPairs(path).catch((error) => {
        this.controller.abort(error)
        throw error
      })
      this.responses.set(path, result)
    }
    return result
  }

  private async fetchPairs(path: string): Promise<Pair[]> {
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
    if (!response.ok)
      throw new Error(
        `KEGG REST HTTP ${response.status} for ${path}; query failed, not evidence of no pathway membership.`,
      )
    if (response.headers.get('content-type')?.includes('text/html') || /^\s*</.test(body)) {
      throw new Error(
        'KEGG REST proxy returned HTML. Configure /kegg-rest/ to forward to https://rest.kegg.jp instead of the SPA fallback.',
      )
    }
    const rows = pairs(body)
    if (rows.some(([id]) => !/^(?:C\d{5}|[a-z]{2,4}\d{5})$/.test(id))) {
      throw new Error('Invalid KEGG REST response: unexpected entry identifiers')
    }
    return rows
  }

  async findCompounds(query: string): Promise<KeggCompound[]> {
    const id = query.trim().replace(/^cpd:/i, '').toUpperCase()
    const rows = /^C\d{5}$/.test(id)
      ? await this.list([id])
      : await this.request(`find/compound/${encodeURIComponent(query.trim())}/nop`)
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

  async findPathways(query: string): Promise<Pair[]> {
    const id = query.trim().replace(/^path:/i, '')
    if (/^[a-z]{2,4}\d{5}$/i.test(id)) return this.list([id.toLowerCase()])
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

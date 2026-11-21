/** Live KEGG tools. Each invocation makes at most one upstream request. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, TOOL_RESULT_CHARS_EVIDENCE } from '../tools'
import { rankWindowMeta, resolveRankWindow } from '../../bridge/analysisTypes'
import { adductShiftTable } from '@/shared/chem/adducts'
import {
  KEGG_ENTRY_LIMIT,
  KeggClient,
  compoundLink,
  keggSource,
  pathwayLink,
  pngDataUrl,
  pngDimensions,
  type KeggEntry,
} from './kegg'

const massShifts = adductShiftTable([
  'M+H',
  'M+Na',
  'M+K',
  'M+NH4',
  'M+Li',
  'M-H',
  'M+Cl',
  'M+HCOO',
  'M+CH3COO',
  'M-2H+Na',
  'M-2H+K',
])

export type KeggFindDatabase = 'compound' | 'pathway'

/** Return a complete-result window for one keyword query; limit is only the page size. */
export async function keggFind(
  query: string,
  db: KeggFindDatabase,
  offset: number,
  limit: number,
  signal?: AbortSignal,
): Promise<string> {
  if (!query.trim()) throw new Error('Provide a nonempty KEGG query')
  const client = new KeggClient(signal)
  const entries =
    db === 'compound'
      ? (await client.findCompounds(query)).map((entry) => ({
          id: entry.id,
          name: entry.names.join('; '),
        }))
      : (await client.findPathways(query)).map(([id, name]) => ({ id, name }))
  const selected = entries.slice(offset, offset + limit)
  const window = rankWindowMeta(entries.length, offset, limit, selected.length)
  // rn/hsa-style ids returned by find/pathway are species/reaction variants
  // of the same map; say so instead of silently dropping them from the list.
  const variantNote =
    db === 'pathway' && entries.length === 0 && /^[a-z]{2,4}\d{5}$/i.test(query.trim())
      ? `\n"${query.trim()}" is an organism- or reference-specific pathway code; only map codes (e.g. map00010) are listed. Try the map form or a keyword.`
      : ''
  const missNote =
    entries.length === 0 && !variantNote
      ? `\nNo KEGG entries matched "${query}". This is a database search miss, not biological absence.`
      : ''
  return `${JSON.stringify({ query, window, entries: selected }, null, 2)}${variantNote}${missNote}\n${keggSource()}`
}

export async function keggMassSearch(
  mz: number,
  adduct: string,
  ppm: number,
  offset: number,
  limit: number,
  signal?: AbortSignal,
): Promise<string> {
  const shift = massShifts[adduct]
  if (typeof shift !== 'number') throw new Error(`Unknown KEGG mass-search adduct "${adduct}"`)
  if (!Number.isFinite(mz) || mz <= 0) throw new Error('Provide a positive m/z')
  if (!Number.isFinite(ppm) || ppm <= 0) throw new Error('Provide a positive ppm tolerance')
  const polarity = adduct.endsWith('+') ? 'positive' : 'negative'
  // The supported adducts are singly charged monomers. The ppm tolerance is relative to observed m/z.
  const neutralMass = mz - shift
  const tolerance = (mz * ppm) / 1e6
  const lo = Math.max(1e-6, neutralMass - tolerance)
  const hi = neutralMass + tolerance
  if (hi < lo) throw new Error(`m/z ${mz} and ${adduct} give no positive neutral-mass range`)
  const hits = await new KeggClient(signal).findExactMass(lo, hi)
  const matches = hits
    .map(({ id, exactMass }) => ({
      id,
      adduct,
      exactMass,
      deltaPpm: ((exactMass - neutralMass) / mz) * 1e6,
    }))
    .filter((hit) => Math.abs(hit.deltaPpm) <= ppm)
  matches.sort((a, b) => Math.abs(a.deltaPpm) - Math.abs(b.deltaPpm) || a.id.localeCompare(b.id))
  const selected = matches.slice(offset, offset + limit)
  const window = rankWindowMeta(matches.length, offset, limit, selected.length)
  const missNote =
    matches.length === 0
      ? `\nNo KEGG compounds matched m/z ${mz} (${adduct}, ${ppm} ppm). This is a database search miss, not biological absence.`
      : ''
  return `${JSON.stringify({ queryMz: mz, adduct, polarity, ppm, window, matches: selected }, null, 2)}${missNote}\n${keggSource()}`
}

function formatKeggCompound(entry: KeggEntry): string {
  const lines = [
    `entry: ${compoundLink(entry.id)}`,
    `names: ${entry.names.length ? entry.names.join('; ') : '(no name returned by KEGG)'}`,
  ]
  if (entry.formula) lines.push(`formula: ${entry.formula}`)
  if (entry.pathways.length) {
    lines.push('pathways:')
    for (const pathway of entry.pathways) {
      lines.push(`- ${pathwayLink(pathway.id, pathway.name)}`)
    }
  }
  return lines.join('\n')
}

function formatKeggPathway(entry: KeggEntry): string {
  const lines = [
    `entry: [${entry.id}](https://www.kegg.jp/pathway/${entry.id})`,
    `name: ${entry.names.length ? entry.names.join('; ') : '(no name returned by KEGG)'}`,
  ]
  if (entry.class) lines.push(`class: ${entry.class}`)
  if (entry.description) {
    lines.push(
      `description: ${entry.description.slice(0, 400)}${entry.description.length > 400 ? '…' : ''}`,
    )
  }
  return lines.join('\n')
}

function formatMembers(id: string, compounds: Set<string>, offset: number, limit: number): string {
  const selected = [...compounds].slice(offset, offset + limit)
  const window = rankWindowMeta(compounds.size, offset, limit, selected.length)
  const lines = [
    `entry: [${id}](https://www.kegg.jp/pathway/${id})`,
    `window: ${JSON.stringify(window)}`,
    'compounds:',
    ...selected.map((cid) => `- ${compoundLink(cid)}`),
  ]
  if (selected.length === 0) {
    lines.push(
      compounds.size
        ? '- No compounds in this window; use a smaller offset.'
        : '- No member compounds returned by KEGG for this pathway.',
    )
  }
  return lines.join('\n')
}

function entryInput(id?: string, ids?: string[]): string[] {
  if (id !== undefined && ids !== undefined) throw new Error('Provide only one of "id" or "ids"')
  if (id !== undefined) return [id]
  if (ids?.length) return ids
  throw new Error('Provide "id" or "ids"')
}

const entryTypes = {
  compound: {
    normalize: (value: string) => value.trim().replace(/^cpd:/i, '').toUpperCase(),
    pattern: /^C\d{5}$/,
    expected: 'C followed by five digits',
    format: formatKeggCompound,
  },
  pathway: {
    normalize: (value: string) =>
      value
        .trim()
        .replace(/^path:/i, '')
        .toLowerCase(),
    pattern: /^map\d{5}$/,
    expected:
      'map followed by five digits (for organism-specific codes like hsa00010 use map00010)',
    format: formatKeggPathway,
  },
} as const

/** Preserve input order and per-id errors when KEGG returns a partial batch. */
async function readIds(
  kind: keyof typeof entryTypes,
  input: string[],
  client: KeggClient,
  memberWindow?: ReturnType<typeof resolveRankWindow>,
): Promise<string> {
  const type = entryTypes[kind]
  const ids = [...new Set(input.map(type.normalize))]
  const valid = ids.filter((id) => type.pattern.test(id))
  const records = new Map<string, string>()
  if (valid.length) {
    if (memberWindow) {
      const groups = await client.pathwayCompounds(valid)
      for (const [map, compounds] of groups) {
        records.set(map, formatMembers(map, compounds, memberWindow.offset, memberWindow.limit))
      }
    } else {
      for (const entry of await client.getEntries(valid)) {
        records.set(entry.id, type.format(entry))
      }
    }
  }
  const sections = ids.map((id) => {
    let body = records.get(id) ?? `No KEGG ${kind} entry was returned for ${id}.`
    if (!type.pattern.test(id)) {
      const message = `Invalid KEGG ${kind} id "${id}"; expected ${type.expected}`
      if (ids.length === 1) throw new Error(message)
      body = `Error: ${message}`
    }
    return ids.length === 1 ? body : `### ${id}\n${body}`
  })
  if (valid.length) sections.push(keggSource())
  return sections.join('\n\n')
}

const resultWindow = {
  offset: {
    type: 'integer',
    description: 'Zero-based position in the results (default 0). Continue with nextOffset.',
  },
  limit: { type: 'integer', description: 'Results displayed per page (default 10, max 25).' },
} as const

export const name = 'tool-kegg'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(
    defineTool({
      name: 'kegg_find',
      timeoutMs: 120_000,
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      category: 'biology',
      description:
        'Search KEGG compound or reference pathway entries with one query. Multiple keywords in the same ' +
        'string use DBGET AND semantics and return one result set. Call separately for independent searches. ' +
        'Returns candidate ids, names and a result window. Verify compound identity with kegg_compound.',
      parameters: {
        query: {
          type: 'string',
          required: true,
          description:
            'One keyword expression, e.g. "glucose phosphate" to match both terms. An exact entry id is also accepted.',
        },
        db: {
          type: 'string',
          enum: ['compound', 'pathway'],
          description: 'Database to search (default compound).',
        },
        ...resultWindow,
      },
      execute(args, exec) {
        const { offset, limit } = resolveRankWindow(args.offset, args.limit)
        return keggFind(args.query, args.db ?? 'compound', offset, limit, exec.signal)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'kegg_compound',
      timeoutMs: 120_000,
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      category: 'biology',
      description:
        'Read official KEGG compound entries for identity checking. One get request accepts 1–10 compound ids ' +
        'in "ids". Returns names, FORMULA, PATHWAY links and official entry links. Judge identity from the ' +
        'returned record as a whole, not formula alone; library masses and cross-reference id lists are not ' +
        'returned because they add no independent identity evidence for annotation review.',
      parameters: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          maxItems: KEGG_ENTRY_LIMIT,
          required: true,
          description: '1–10 compound ids for one KEGG get request.',
        },
      },
      execute(args, exec) {
        if (!args.ids.length) throw new Error('Provide "ids"')
        return readIds('compound', args.ids, new KeggClient(exec.signal))
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'kegg_pathway',
      timeoutMs: 120_000,
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      category: 'biology',
      description:
        'Use id or ids for pathway names, classes and description excerpts (one get request, 1–10 map ids). ' +
        'Add withImage=true with exactly one map id to attach that KEGG pathway map as a PNG image, so you ' +
        'can see where the compound sits in the map; the image is a diagram, not quantitative evidence. ' +
        'Use membersOf for member compound ids grouped by pathway (one official REST link request for all ' +
        'supplied maps). Use offset and limit to page each member list independently. Use kegg_compound for ' +
        'member names or formulas. Reference map ids only.',
      parameters: {
        id: {
          type: 'string',
          description: 'One reference pathway for entry details, e.g. map00010 or path:map00010.',
        },
        ids: {
          type: 'array',
          items: { type: 'string' },
          maxItems: KEGG_ENTRY_LIMIT,
          description: '1–10 reference pathway ids for entry details.',
        },
        withImage: {
          type: 'boolean',
          description:
            'Attach the KEGG pathway map PNG (default false). Detail mode with exactly one map id only.',
        },
        membersOf: {
          type: 'array',
          items: { type: 'string' },
          description:
            'One or more reference map ids for compound membership, e.g. ["map00010","map00020"]. Use by itself with optional offset/limit.',
        },
        ...resultWindow,
      },
      async execute(args, exec) {
        const client = new KeggClient(exec.signal)
        if (args.membersOf !== undefined) {
          if (
            !args.membersOf.length ||
            args.id !== undefined ||
            args.ids !== undefined ||
            args.withImage !== undefined
          ) {
            throw new Error(
              'Provide a nonempty "membersOf" array on its own for pathway membership (no id/ids/withImage)',
            )
          }
          return readIds(
            'pathway',
            args.membersOf,
            client,
            resolveRankWindow(args.offset, args.limit),
          )
        }
        const ids = entryInput(args.id, args.ids)
        const text = await readIds('pathway', ids, client)
        if (args.withImage !== true) return text
        const maps = [...new Set(ids.map((id) => id.trim().replace(/^path:/i, '').toLowerCase()))]
        if (maps.length !== 1 || !/^map\d{5}$/.test(maps[0]!)) {
          throw new Error('withImage requires exactly one reference map id, e.g. ids=["map00010"]')
        }
        const map = maps[0]!
        const bytes = await client.pathwayImage(map)
        // Same decoded-size ceiling the attachment pipeline enforces; fail with a readable reason.
        if (bytes.length > 2 * 1024 * 1024) {
          throw new Error(`KEGG pathway map ${map} exceeds the 2 MB image limit; read the entry text instead`)
        }
        const { width, height } = pngDimensions(bytes)
        return {
          text,
          images: [
            {
              dataUrl: pngDataUrl(bytes),
              mime: 'image/png' as const,
              width,
              height,
              label: `KEGG pathway map ${map}`,
            },
          ],
        }
      },
      output: {
        render: (_args, value) => (typeof value === 'string' ? value : value.text),
        images: (_args, value) => (typeof value === 'string' ? undefined : value.images),
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'kegg_mass_search',
      timeoutMs: 120_000,
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      category: 'biology',
      description:
        'Search KEGG compound for small-molecule candidates using one observed m/z and one explicit adduct ' +
        'consistent with the acquisition polarity. Each call searches one neutral exact-mass range and ranks ' +
        'hits by absolute Δppm. Returns compound ids, exact masses and signed mass errors. Use kegg_compound ' +
        'for names and formulas. Test a different m/z or adduct in a separate call. For lipid annotation use the annotation library.',
      parameters: {
        mz: { type: 'number', required: true, description: 'One observed positive m/z value.' },
        adduct: {
          type: 'string',
          required: true,
          enum: Object.keys(massShifts),
          description:
            'One ion adduct hypothesis, e.g. [M+H]+ for positive mode or [M-H]- for negative mode.',
        },
        ppm: {
          type: 'integer',
          description:
            'Mass tolerance relative to observed m/z in ppm (default 10, clamped to 1–50).',
        },
        ...resultWindow,
      },
      execute(args, exec) {
        const { offset, limit } = resolveRankWindow(args.offset, args.limit)
        const ppm = Math.min(Math.max(args.ppm ?? 10, 1), 50)
        return keggMassSearch(args.mz, args.adduct, ppm, offset, limit, exec.signal)
      },
    }),
  )
}

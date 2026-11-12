/** Archived HMDB metabolite profiles and Exa-assisted name-to-id resolution. */
import { ENV } from '@/shared/config/env'
import { searchExaResults } from '../tool-web-search'

/** Chemical taxonomy as recorded under <taxonomy>. */
export interface HmdbTaxonomy {
  description?: string
  directParent?: string
  kingdom?: string
  superClass?: string
  klass?: string
  subClass?: string
  molecularFramework?: string
  alternativeParents: string[]
  substituents: string[]
  externalDescriptors: string[]
}

/** One non-empty field of HMDB's External Links section, labelled as on the HMDB page. */
export interface HmdbExternalLink {
  field: string
  label: string
  value: string
}

export interface HmdbConcentration {
  biospecimen: string
  value?: string
  units?: string
  subjectAge?: string
  subjectSex?: string
  subjectCondition?: string
  references: string[]
}

export interface HmdbProfile {
  accession: string
  name: string
  updateDate?: string
  description?: string
  smiles?: string
  inchi?: string
  inchikey?: string
  synonyms: string[]
  formula?: string
  monoisotopicMass?: string
  averageMass?: string
  iupacName?: string
  traditionalIupac?: string
  casRegistryNumber?: string
  taxonomy?: HmdbTaxonomy
  /** Leaf terms of the `Role` ontology tree only (HMDB's Role section). */
  roles: string[]
  tissues: string[]
  cellLocations: string[]
  biospecimens: string[]
  pathways: string[]
  normalConcentrations: HmdbConcentration[]
  /** Non-empty external database ids, in HMDB External Links order. */
  externalLinks: HmdbExternalLink[]
}

export interface HmdbCandidate {
  id: string
  title: string
  excerpt: string
}

export function normalizeHmdbId(value: string): string {
  const id = value.trim().toUpperCase()
  if (!/^HMDB\d{5,}$/.test(id)) {
    throw new Error(`Invalid HMDB id "${value}"; expected HMDB followed by at least five digits`)
  }
  return id
}

export function hmdbPage(id: string): string {
  return `https://hmdb.ca/metabolites/${id}`
}

export function hmdbArchive(id: string): string {
  return `https://web.archive.org/web/2id_/${hmdbPage(id)}.xml`
}

/** Same-origin relay endpoint; the server follows Wayback's 2id_ redirect. */
export function hmdbArchiveRequest(id: string): string {
  // Mirror kegg.ts: respect a non-root deployment base instead of assuming "/".
  return `${import.meta.env.BASE_URL}hmdb-archive/${normalizeHmdbId(id)}.xml`
}

function hmdbUnearth(name: string): string {
  return `https://hmdb.ca/unearth/q?query=${encodeURIComponent(name)}`
}

function child(parent: Element, tag: string): Element | undefined {
  return Array.from(parent.children).find((element) => element.tagName === tag)
}

function text(parent: Element, tag: string): string | undefined {
  return child(parent, tag)?.textContent?.trim() || undefined
}

function unique(values: (string | undefined)[]): string[] {
  return [
    ...new Set(values.filter((value): value is string => !!value?.trim()).map((v) => v.trim())),
  ]
}

function section(parent: Element | undefined, tag: string): Element | undefined {
  return parent ? child(parent, tag) : undefined
}

/**
 * Semantic-aware description truncation: cut on the last sentence boundary
 * before the cap so a truncated description never stops mid-sentence (a
 * plain character cut would drop the point of the final clause). Falls back
 * to the character cap when no boundary fits.
 */
export function truncateDescription(value: string, cap = 1000): string {
  if (value.length <= cap) return value
  const head = value.slice(0, cap)
  const lastStop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('.\n'))
  if (lastStop > cap * 0.5) return head.slice(0, lastStop + 1)
  return head
}

/**
 * HMDB's External Links section: every `*_id` element of the metabolite root,
 * with the label the HMDB metabolite page shows (checked against the archived
 * HMDB0007861 page, 2026-02 snapshot), in page order.
 */
const EXTERNAL_LINK_FIELDS: { field: string; label: string }[] = [
  { field: 'drugbank_id', label: 'DrugBank ID' },
  { field: 'phenol_explorer_compound_id', label: 'Phenol Explorer Compound ID' },
  { field: 'foodb_id', label: 'FooDB ID' },
  { field: 'knapsack_id', label: 'KNApSAcK ID' },
  { field: 'chemspider_id', label: 'Chemspider ID' },
  { field: 'kegg_id', label: 'KEGG Compound ID' },
  { field: 'biocyc_id', label: 'BioCyc ID' },
  { field: 'bigg_id', label: 'BiGG ID' },
  { field: 'wikipedia_id', label: 'Wikipedia Link' },
  { field: 'metlin_id', label: 'METLIN ID' },
  { field: 'pubchem_compound_id', label: 'PubChem Compound' },
  { field: 'pdb_id', label: 'PDB ID' },
  { field: 'chebi_id', label: 'ChEBI ID' },
  { field: 'fbonto_id', label: 'Food Biomarker Ontology' },
  { field: 'vmh_id', label: 'VMH ID' },
]

/**
 * Walk an ontology <descendant> subtree collecting leaf terms. Only leaf terms
 * carry molecule-specific values; internal nodes are vocabulary shared by every
 * metabolite.
 */
function collectOntologyLeaves(element: Element, into: string[]): void {
  const children = Array.from(child(element, 'descendants')?.children ?? []).filter(
    (node) => node.tagName === 'descendant',
  )
  const term = text(element, 'term')
  if (children.length === 0) {
    if (term) into.push(term)
    return
  }
  for (const node of children) collectOntologyLeaves(node, into)
}

/**
 * Parse only documented HMDB fields; optional sections are omitted when absent.
 * Tag names verified against real archived v4/v5 XML (2024-07 snapshot of
 * HMDB0003502, 2026-02 snapshot of HMDB0007861): record dates are
 * `creation_date`/`update_date`; structure identifiers are root-level `smiles`/
 * `inchi`/`inchikey`; taxonomy lives under root `taxonomy` (kingdom/super_class/
 * class/sub_class/direct_parent, `alternative_parents`/`substituents`/
 * `external_descriptors` lists); ontology trees are rooted at Physiological
 * effect/Disposition/Process/Role and only the Role tree maps to the page's
 * "Role" section, so only its LEAF terms (e.g. "Energy source") are kept;
 * normal concentrations sit under `normal_concentrations > concentration` with
 * biospecimen/value/units/subject_age/subject_sex/subject_condition; external
 * links are the root-level `*_id` elements (see EXTERNAL_LINK_FIELDS).
 */
export function parseHmdbXml(source: string): HmdbProfile {
  const xml = new DOMParser().parseFromString(source, 'text/xml')
  if (xml.querySelector('parsererror') || xml.documentElement.tagName !== 'metabolite') {
    throw new Error('Invalid HMDB XML: expected a metabolite document')
  }
  const root = xml.documentElement
  const accession = text(root, 'accession')
  const name = text(root, 'name')
  if (!accession || !name) throw new Error('Invalid HMDB XML: missing accession or primary name')

  const synonyms = Array.from(section(root, 'synonyms')?.children ?? [])
    .filter((element) => element.tagName === 'synonym')
    .map((element) => element.textContent?.trim())
  const biology = section(root, 'biological_properties')
  const tissues = Array.from(section(biology, 'tissue_locations')?.children ?? [])
    .filter((element) => element.tagName === 'tissue')
    .map((element) => element.textContent?.trim())
  const cellLocations = Array.from(section(biology, 'cellular_locations')?.children ?? [])
    .filter((element) => element.tagName === 'cellular')
    .map((element) => element.textContent?.trim())
  const biospecimens = Array.from(section(biology, 'biospecimen_locations')?.children ?? [])
    .filter((element) => element.tagName === 'biospecimen')
    .map((element) => element.textContent?.trim())
  const pathways = Array.from(section(biology, 'pathways')?.children ?? [])
    .filter((element) => element.tagName === 'pathway')
    .map((element) => text(element, 'name'))

  const taxonomyEl = section(root, 'taxonomy')
  const taxonomy: HmdbTaxonomy | undefined = taxonomyEl
    ? {
        description: text(taxonomyEl, 'description')?.replace(/\s+/g, ' '),
        directParent: text(taxonomyEl, 'direct_parent'),
        kingdom: text(taxonomyEl, 'kingdom'),
        superClass: text(taxonomyEl, 'super_class'),
        klass: text(taxonomyEl, 'class'),
        subClass: text(taxonomyEl, 'sub_class'),
        molecularFramework: text(taxonomyEl, 'molecular_framework'),
        alternativeParents: unique(
          Array.from(section(taxonomyEl, 'alternative_parents')?.children ?? []).map(
            (element) => element.textContent?.trim() ?? undefined,
          ),
        ),
        substituents: unique(
          Array.from(section(taxonomyEl, 'substituents')?.children ?? []).map(
            (element) => element.textContent?.trim() ?? undefined,
          ),
        ),
        externalDescriptors: unique(
          Array.from(section(taxonomyEl, 'external_descriptors')?.children ?? []).map(
            (element) => element.textContent?.trim() ?? undefined,
          ),
        ),
      }
    : undefined

  // The page's "Role" section is the `Role` root of the ontology; the other
  // roots (Physiological effect/Disposition/Process) are not "Role" content.
  const roles: string[] = []
  for (const rootEl of Array.from(section(root, 'ontology')?.children ?? []).filter(
    (element) => element.tagName === 'root',
  )) {
    if (text(rootEl, 'term') !== 'Role') continue
    for (const node of Array.from(child(rootEl, 'descendants')?.children ?? []).filter(
      (element) => element.tagName === 'descendant',
    )) {
      collectOntologyLeaves(node, roles)
    }
  }

  const externalLinks: HmdbExternalLink[] = EXTERNAL_LINK_FIELDS.flatMap(({ field, label }) => {
    const value = text(root, field)
    return value ? [{ field, label, value }] : []
  })

  const normalConcentrations = Array.from(section(root, 'normal_concentrations')?.children ?? [])
    .filter((element) => element.tagName === 'concentration')
    .map((element) => ({
      biospecimen: text(element, 'biospecimen') ?? '',
      value: text(element, 'concentration_value'),
      units: text(element, 'concentration_units'),
      subjectAge: text(element, 'subject_age'),
      subjectSex: text(element, 'subject_sex'),
      subjectCondition: text(element, 'subject_condition'),
      references: Array.from(section(element, 'references')?.children ?? [])
        .filter((ref) => ref.tagName === 'reference')
        .map((ref) =>
          `${text(ref, 'reference_text') ?? ''}${text(ref, 'pubmed_id') ? ` (PMID: ${text(ref, 'pubmed_id')})` : ''}`.trim(),
        )
        .filter(Boolean),
    }))
    .filter((entry) => entry.biospecimen)

  return {
    accession: normalizeHmdbId(accession),
    name,
    updateDate: text(root, 'update_date')?.replace(/\s+UTC$/, ''),
    smiles: text(root, 'smiles'),
    inchi: text(root, 'inchi'),
    inchikey: text(root, 'inchikey'),
    synonyms: unique(synonyms),
    formula: text(root, 'chemical_formula'),
    monoisotopicMass: text(root, 'monisotopic_molecular_weight'),
    averageMass: text(root, 'average_molecular_weight'),
    iupacName: text(root, 'iupac_name'),
    traditionalIupac: text(root, 'traditional_iupac'),
    casRegistryNumber: text(root, 'cas_registry_number'),
    description: text(root, 'description')?.replace(/\s+/g, ' '),
    taxonomy,
    roles: unique(roles),
    tissues: unique(tissues),
    cellLocations: unique(cellLocations),
    biospecimens: unique(biospecimens),
    pathways: unique(pathways),
    normalConcentrations,
    externalLinks,
  }
}

function limitedLines(label: string, values: string[], limit: number): string | undefined {
  if (!values.length) return undefined
  return `${label} (${values.length}): ${values.slice(0, limit).join('; ')}${values.length > limit ? ` … +${values.length - limit} more` : ''}`
}

function formatTaxonomy(taxonomy: HmdbTaxonomy): string[] {
  const lines: string[] = []
  const chain = [
    taxonomy.kingdom,
    taxonomy.superClass,
    taxonomy.klass,
    taxonomy.subClass,
    taxonomy.directParent,
  ].filter(Boolean)
  if (chain.length) lines.push(`Taxonomy Class: ${chain.join(' > ')}`)
  if (taxonomy.molecularFramework) lines.push(`Molecular Framework: ${taxonomy.molecularFramework}`)
  const alts = limitedLines('Alternative Parents', taxonomy.alternativeParents, 6)
  if (alts) lines.push(alts)
  const subs = limitedLines('Substituents', taxonomy.substituents, 10)
  if (subs) lines.push(subs)
  const descriptors = limitedLines('External Descriptors', taxonomy.externalDescriptors, 4)
  if (descriptors) lines.push(descriptors)
  return lines
}

function formatConcentration(entry: HmdbConcentration): string {
  const details = [
    entry.value ? `${entry.value} ${entry.units ?? ''}`.trim() : undefined,
    entry.subjectAge,
    entry.subjectSex,
    entry.subjectCondition,
  ]
    .filter(Boolean)
    .join(', ')
  const reference = entry.references[0]
  return `- ${entry.biospecimen}${details ? `: ${details}` : ''}${reference ? ` | ${reference}` : ''}`
}

export function formatHmdbProfile(profile: HmdbProfile, archiveUrl: string): string {
  const snapshot = /\/web\/(\d{14})id_\//.exec(archiveUrl)?.[1] ?? 'unknown'
  // Field labels follow the HMDB metabolite page (Record Information /
  // Metabolite Identification / Chemical Taxonomy / Biological Properties /
  // Normal Concentrations / External Links), not the XML tag names, so the
  // model can map a line straight to the page a user is reading.
  const lines = [
    `HMDB ID: ${profile.accession}`,
    `Common Name: ${profile.name}`,
    profile.updateDate ? `Update Date: ${profile.updateDate}` : undefined,
    limitedLines('Synonyms', profile.synonyms, 10),
    profile.formula ? `Chemical Formula: ${profile.formula}` : undefined,
    profile.monoisotopicMass
      ? `Monoisotopic Molecular Weight: ${profile.monoisotopicMass}`
      : undefined,
    profile.averageMass ? `Average Molecular Weight: ${profile.averageMass}` : undefined,
    profile.iupacName ? `IUPAC Name: ${profile.iupacName}` : undefined,
    profile.traditionalIupac ? `Traditional Name: ${profile.traditionalIupac}` : undefined,
    profile.casRegistryNumber ? `CAS Registry Number: ${profile.casRegistryNumber}` : undefined,
    profile.smiles ? `SMILES: ${profile.smiles}` : undefined,
    profile.inchi ? `InChI Identifier: ${profile.inchi}` : undefined,
    profile.inchikey ? `InChI Key: ${profile.inchikey}` : undefined,
  ]
  if (profile.description) {
    const truncated = truncateDescription(profile.description)
    lines.push(
      `Description: ${truncated}${truncated.length < profile.description.length ? ' …' : ''}`,
    )
  }
  if (profile.taxonomy) lines.push(...formatTaxonomy(profile.taxonomy))
  lines.push(
    limitedLines('Role', profile.roles, 12),
    limitedLines('Tissue Locations', profile.tissues, 12),
    limitedLines('Cellular Locations', profile.cellLocations, 8),
    limitedLines('Biospecimen Locations', profile.biospecimens, 8),
    limitedLines('Pathways', profile.pathways, 12),
  )
  if (profile.normalConcentrations.length) {
    lines.push(
      `Normal Concentrations (${profile.normalConcentrations.length}):`,
      ...profile.normalConcentrations.slice(0, 8).map(formatConcentration),
    )
    if (profile.normalConcentrations.length > 8) {
      lines.push(`  … +${profile.normalConcentrations.length - 8} more`)
    }
  }
  for (const link of profile.externalLinks) lines.push(`${link.label}: ${link.value}`)
  lines.push(
    `page: ${hmdbPage(profile.accession)}`,
    `snapshot: ${snapshot}`,
    `archive: ${archiveUrl}`,
    'source: HMDB metabolite XML via Internet Archive Wayback Machine',
  )
  return lines.filter((line): line is string => !!line).join('\n')
}

function archiveUrlFromResponse(id: string, response: Response): string {
  let snapshot: string | undefined
  try {
    snapshot =
      new URL(response.url, 'https://massvision.invalid').searchParams.get('snapshot') ?? undefined
  } catch {
    // A malformed/empty response URL falls through to the Memento header.
  }
  if (!snapshot) {
    const mementoDate = response.headers.get('memento-datetime')
    const date = mementoDate ? new Date(mementoDate) : undefined
    if (date && !Number.isNaN(date.getTime())) {
      snapshot = date.toISOString().slice(0, 19).replace(/[-:T]/g, '')
    }
  }
  return snapshot && /^\d{14}$/.test(snapshot)
    ? `https://web.archive.org/web/${snapshot}id_/${hmdbPage(id)}.xml`
    : hmdbArchive(id)
}

function hmdbLinkFallback(id: string, detail: string): string {
  return [
    `accession: ${id}`,
    'Archive content could not be retrieved (network/relay); no HMDB data has been retrieved.',
    `page: ${hmdbPage(id)}`,
    `archive: ${hmdbArchive(id)}`,
    `You can cite or open these links, or give them to the user. Network detail: ${detail}`,
  ].join('\n')
}

// The production relay rate-limits /hmdb-archive at 2r/s burst=4 (nginx
// limit_req). Sequential items must also SPACE themselves: when Wayback
// answers fast (<500ms), unspaced back-to-back requests exhaust the burst
// bucket and healthy ids start seeing 429 → silent link degradation.
// One shared chain: parallel hmdb_lookup invocations space out together.
let hmdbQueue: Promise<void> = Promise.resolve()
function paceHmdbRequests(): Promise<void> {
  const ready = hmdbQueue.then(() => new Promise<void>((resolve) => setTimeout(resolve, 500)))
  hmdbQueue = ready.catch(() => {})
  return ready
}

export async function hmdbLookupById(value: string, signal?: AbortSignal): Promise<string> {
  const id = normalizeHmdbId(value)
  // 20s per item keeps a full 8-item batch inside the 120s tool timeout even
  // before the batch-level time-budget guard kicks in.
  const timeout = AbortSignal.timeout(20_000)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  await paceHmdbRequests()
  signal?.throwIfAborted()
  let response: Response
  let body: string
  try {
    response = await fetch(hmdbArchiveRequest(id), {
      signal: requestSignal,
      headers: { Accept: 'application/xml, text/xml' },
    })
    body = await response.text()
  } catch (error) {
    signal?.throwIfAborted()
    return hmdbLinkFallback(id, error instanceof Error ? error.message : String(error))
  }
  signal?.throwIfAborted()
  if (response.status === 404) return `No archived snapshot for ${id}`
  // Any other non-ok (rate limit, relay misconfig, 5xx) degrades to links —
  // never a hard error that loses the page/archive links entirely.
  if (!response.ok) {
    return hmdbLinkFallback(id, `HTTP ${response.status} from the HMDB Wayback relay`)
  }
  try {
    return formatHmdbProfile(parseHmdbXml(body), archiveUrlFromResponse(id, response))
  } catch (error) {
    signal?.throwIfAborted()
    // A 200 with a non-XML body (misrouted relay answering with the SPA page,
    // captive portal) is a relay failure, not a profile: degrade honestly.
    return hmdbLinkFallback(
      id,
      `the relay answered HTTP ${response.status} but the body was not readable HMDB XML (${error instanceof Error ? error.message : String(error)}); no HMDB data has been retrieved`,
    )
  }
}

/** Resolve official HMDB ids from Exa's structured results (url/title/excerpt rows). */
export async function resolveHmdbIds(name: string, signal?: AbortSignal): Promise<HmdbCandidate[]> {
  // Same 20s per-item cap as the id mode: a hung Exa SSE stream must degrade
  // THIS item (Unearth link), not burn the 120s tool timeout and discard the
  // whole already-rendered batch.
  const timeout = AbortSignal.timeout(20_000)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  const results = await searchExaResults(
    `${name} HMDB metabolite`,
    5,
    requestSignal,
    // Same key source as the web_search tool so name resolution is not stuck
    // on the anonymous endpoint when a deployment key is configured.
    ENV.exaApiKey,
  )
  const candidates: HmdbCandidate[] = []
  const seen = new Set<string>()
  for (const result of results) {
    const id = /^https?:\/\/(?:www\.)?hmdb\.ca\/metabolites\/(HMDB\d{5,})(?:[/?#]|$)/i.exec(
      result.url,
    )?.[1]
    if (!id) continue
    const normalized = normalizeHmdbId(id)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    candidates.push({
      id: normalized,
      title: result.title || normalized,
      excerpt: result.excerpt.slice(0, 400),
    })
  }
  return candidates
}

export async function hmdbLookupByName(name: string, signal?: AbortSignal): Promise<string> {
  if (!name.trim()) throw new Error('Provide a nonempty HMDB metabolite name')
  let candidates: HmdbCandidate[]
  try {
    candidates = await resolveHmdbIds(name, signal)
  } catch (error) {
    signal?.throwIfAborted()
    // A slow/hung Exa stream (or rate limit) degrades to the manual-search
    // link like the id mode's relay fallback — it must not error out the item
    // and, in a single-item call, lose the whole invocation.
    return [
      `query: ${name}`,
      `Name resolution failed: ${error instanceof Error ? error.message : String(error)}. No HMDB ids have been resolved.`,
      `Search manually: ${hmdbUnearth(name)}`,
    ].join('\n')
  }
  const lines = [
    `query: ${name}`,
    'HMDB id candidates from name search; keyword relevance is not identity verification. Review the candidates, then call hmdb_lookup again with an id for archived details.',
  ]
  if (!candidates.length) {
    lines.push(`No official HMDB page ids found. Search manually: ${hmdbUnearth(name)}`)
  }
  for (const candidate of candidates) {
    lines.push(`- ${candidate.id} | ${candidate.title} | ${hmdbPage(candidate.id)}`)
    if (candidate.excerpt) lines.push(`  ${candidate.excerpt}`)
  }
  return lines.join('\n')
}

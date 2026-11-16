/**
 * PubChem PUG REST API client.
 *
 * Calls the public PubChem REST endpoint directly from the browser - PubChem
 * sends `Access-Control-Allow-Origin: *` so CORS is not an issue.  No API key
 * is required, but the service is rate-limited (5 req/s).  This module
 * enforces a client-side rate limiter (max 5 requests / second, spaced 200ms
 * apart) and caches results by compound name so repeated clicks on the same
 * name never hit the network twice.
 *
 * Docs: https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest
 */

import axios from 'axios'
import type { PubChemCompound } from '../types/pubchem'
import { PubChemNotFoundError } from '../types/pubchem'

const PUBCHEM_BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug'

const pcClient = axios.create({
  baseURL: PUBCHEM_BASE,
  timeout: 15000,
})

// ---- Front-end cache (per compound name, session lifetime) ----

const cache = new Map<string, PubChemCompound>()
const notFoundCache = new Set<string>()

// ---- Rate limiter: max 5 req/s, requests spaced >= 200ms apart ----

let lastRequestTime = 0
const MIN_INTERVAL_MS = 220 // 200ms theoretical + 20ms safety margin

function rateLimitedDelay(): Promise<void> {
  const now = Date.now()
  const wait = Math.max(0, lastRequestTime + MIN_INTERVAL_MS - now)
  lastRequestTime = now + wait
  return wait > 0 ? new Promise((r) => setTimeout(r, wait)) : Promise.resolve()
}

/** Build the 2D structure image URL for a CID. */
function structureImageUrlFor(cid: number): string {
  return `${PUBCHEM_BASE}/compound/cid/${cid}/PNG`
}

/**
 * Look up a compound by name via the PUG REST API.
 *
 * Queries `/compound/name/{name}/property/Title,MolecularFormula,...,SMILES/JSON`
 * and reads the first result from `PropertyTable.Properties[0]`.  Results are
 * cached per name so repeated clicks on the same compound are instant and
 * rate-limit-friendly.
 *
 * @param name  Compound name to search (e.g. "Lactate", "Pyruvate").
 * @returns     The first matching compound.
 * @throws      {@link PubChemNotFoundError} if no match; generic Error on
 *              network/parse failure.
 */
export async function searchPubChemByName(name: string): Promise<PubChemCompound> {
  const query = name.trim()
  if (!query) throw new PubChemNotFoundError('')

  // Cache hit: skip network entirely.
  const cached = cache.get(query)
  if (cached) return cached
  if (notFoundCache.has(query)) throw new PubChemNotFoundError(query)

  await rateLimitedDelay()

  try {
    const res = await pcClient.get<{
      PropertyTable?: {
        Properties?: Array<Record<string, unknown>>
      }
    }>(`/compound/name/${encodeURIComponent(query)}/property/Title,MolecularFormula,MolecularWeight,IUPACName,SMILES,ConnectivitySMILES,IsomericSMILES,InChI,InChIKey/JSON`)

    const props = res.data.PropertyTable?.Properties
    if (!props?.length) {
      notFoundCache.add(query)
      throw new PubChemNotFoundError(query)
    }

    const p = props[0]!
    const cid = Number(p.CID)
    const compound: PubChemCompound = {
      cid,
      title: String(p.Title ?? ''),
      molecularFormula: String(p.MolecularFormula ?? ''),
      molecularWeight: Number(p.MolecularWeight ?? 0),
      iupacName: String(p.IUPACName ?? ''),
      smiles: String(p.SMILES ?? p.ConnectivitySMILES ?? p.IsomericSMILES ?? ''),
      inchi: String(p.InChI ?? ''),
      inchiKey: String(p.InChIKey ?? ''),
      pubchemUrl: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`,
      structureImageUrl: structureImageUrlFor(cid),
    }

    cache.set(query, compound)
    return compound
  } catch (e) {
    // PubChem returns HTTP 404 with a text body when no compound matches the
    // name - convert that to our not-found error so the UI can show a
    // friendly message instead of a generic "request failed".
    if (axios.isAxiosError(e) && e.response?.status === 404) {
      notFoundCache.add(query)
      throw new PubChemNotFoundError(query)
    }
    // Re-throw our own error type as-is.
    if (e instanceof PubChemNotFoundError) throw e
    throw new Error(
      `PubChem request failed: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  apply as applyKnowledge,
  chebiLookup,
  pubchemLookupCompound,
  pubchemSearchFormula,
} from '../index'
import { hmdbLookupById, formatHmdbProfile, parseHmdbXml, truncateDescription } from '../hmdb'
import { ToolRuntime } from '../../tools'
import { SystemPrompt } from '../../system-prompt'

/** fetch mock：按 URL 前缀/包含串路由到固定响应 */
function mockFetch(
  routes: { match: string | RegExp; ok?: boolean; status?: number; body: unknown }[],
) {
  const impl = vi.fn(async (url: string) => {
    const route = routes.find((r) =>
      typeof r.match === 'string' ? url.includes(r.match) : r.match.test(url),
    )
    if (!route) throw new Error(`unexpected fetch: ${url}`)
    if (route.ok === false) {
      return new Response(typeof route.body === 'string' ? route.body : '', {
        status: route.status ?? 500,
      })
    }
    return new Response(JSON.stringify(route.body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// Mirrors the real archived XML structure (verified 2026-11-11 against the
// 2024-07 snapshot of HMDB0003502 and the 2026-02 snapshot of HMDB0007861):
// PubChem is `pubchem_compound_id`, tissues and cellular locations live under
// biological_properties, taxonomy under the root `taxonomy` element, the
// page's "Role" section is the `Role` ontology root (only its leaf terms),
// normal concentrations sit under `normal_concentrations > concentration`, and
// external links are the root-level `*_id` elements.
const HMDB_XML = `
<metabolite>
  <creation_date>2006-08-12 22:06:07 UTC</creation_date>
  <update_date>2021-09-14 15:47:08 UTC</update_date>
  <accession>HMDB0003502</accession>
  <name>Example metabolite</name>
  <chemical_formula>C6H12O6</chemical_formula>
  <monisotopic_molecular_weight>180.063388</monisotopic_molecular_weight>
  <average_molecular_weight>180.156</average_molecular_weight>
  <iupac_name>(2R,3S,4R,5R)-2,3,4,5,6-pentahydroxyhexanal</iupac_name>
  <traditional_iupac>(2R,3S,4R,5R)-2,3,4,5,6-pentahydroxy-hexanal</traditional_iupac>
  <cas_registry_number>50-99-7</cas_registry_number>
  <smiles>OCC(O)C(O)C(O)C(O)C=O</smiles>
  <inchi>InChI=1S/C6H12O6/c7-1-3(9)5(11)6(12)4(10)2-8/h1,3-6,8-12H,2H2/t3-,4+,5+,6+/m0/s1</inchi>
  <inchikey>WQZGKKKJIJFFOK-GASJEMHNSA-N</inchikey>
  <description>An archived HMDB description.</description>
  <taxonomy>
    <kingdom>Organic compounds</kingdom>
    <super_class>Organic oxygen compounds</super_class>
    <class>Organooxygen compounds</class>
    <sub_class>Carbohydrates and carbohydrate conjugates</sub_class>
    <direct_parent>Hexoses</direct_parent>
    <molecular_framework>Aliphatic acyclic compounds</molecular_framework>
    <alternative_parents><alternative_parent>Hydrocarbon derivatives</alternative_parent></alternative_parents>
    <substituents><substituent>Hexose monosaccharide</substituent></substituents>
  </taxonomy>
  <ontology>
    <root>
      <term>Disposition</term>
      <descendants>
        <descendant>
          <term>Endogenous</term>
          <definition>Produced within the organism.</definition>
        </descendant>
      </descendants>
    </root>
    <root>
      <term>Role</term>
      <descendants>
        <descendant>
          <term>Energy source</term>
          <definition>A chemical substance used for energy.</definition>
        </descendant>
      </descendants>
    </root>
  </ontology>
  <synonyms><synonym>Synonym one</synonym><synonym>Synonym two</synonym></synonyms>
  <biological_properties>
    <cellular_locations><cellular>Cytoplasm</cellular></cellular_locations>
    <biospecimen_locations><biospecimen>Blood</biospecimen><biospecimen>Urine</biospecimen></biospecimen_locations>
    <tissue_locations><tissue>Blood</tissue><tissue>Liver</tissue></tissue_locations>
    <pathways><pathway><name>Example pathway</name><kegg_map_id>map00010</kegg_map_id></pathway></pathways>
  </biological_properties>
  <normal_concentrations>
    <concentration>
      <biospecimen>Blood</biospecimen>
      <concentration_value>4.5 (4.0-5.0)</concentration_value>
      <concentration_units>uM</concentration_units>
      <subject_age>Adult</subject_age>
      <subject_sex>Both</subject_sex>
      <subject_condition>Normal</subject_condition>
      <references>
        <reference>
          <reference_text>Example cohort study</reference_text>
          <pubmed_id>11417869</pubmed_id>
        </reference>
      </references>
    </concentration>
  </normal_concentrations>
  <diseases><disease><name>Example disease</name></disease></diseases>
  <kegg_id>C00031</kegg_id>
  <chebi_id>CHEBI:4167</chebi_id>
  <pubchem_compound_id>5793</pubchem_compound_id>
  <chemspider_id>12345</chemspider_id>
  <foodb_id>FDB000001</foodb_id>
</metabolite>`

function archiveResponse(body: string, status = 200): Response {
  const response = new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/xml',
      'Memento-Datetime': 'Mon, 22 Jul 2024 19:54:39 GMT',
    },
  })
  Object.defineProperty(response, 'url', {
    value: 'http://localhost:5173/hmdb-archive/HMDB0003502.xml?snapshot=20240722195439',
  })
  return response
}

async function makeKnowledgeContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  applyKnowledge(ctx)
  return ctx
}

describe('pubchemLookupCompound', () => {
  /** PUG-View 的真实嵌套：Record → Section → Section(Record Description) → Information */
  const viewBody = (text: string) => ({
    Record: {
      Section: [
        {
          TOCHeading: 'Names and Identifiers',
          Section: [
            {
              TOCHeading: 'Record Description',
              Information: [
                { ReferenceNumber: 12, Value: { StringWithMarkup: [{ String: text }] } },
                {
                  Name: 'See Also',
                  Value: {
                    StringWithMarkup: [
                      { String: 'See also: Dextrose (annotation moved to) ... View More' },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  })

  it('formats properties + description + synonyms + source link', async () => {
    const fetchMock = mockFetch([
      {
        match: '/property/',
        body: {
          PropertyTable: {
            Properties: [
              {
                CID: 5863,
                MolecularFormula: 'C6H12O6',
                MonoisotopicMass: 180.063,
                AverageMass: 180.156,
                CanonicalSMILES: 'C(C1C(C(C(C(O1)O)O)O)O)O',
                InChIKey: 'WQZGKKKJIJFFOK-UHFFFAOYSA-N',
                IUPACName: '(2R,3S,4R,5R)-2,3,4,5,6-pentahydroxyhexanal',
              },
            ],
          },
        },
      },
      {
        match: '/pug_view/',
        body: viewBody('Glucose is a simple sugar and an important energy source.'),
      },
      {
        match: '/synonyms/',
        body: {
          InformationList: { Information: [{ CID: 5863, Synonym: ['glucose', 'D-glucose', ''] }] },
        },
      },
    ])

    const out = await pubchemLookupCompound('glucose')

    expect(out).toContain('cid: 5863')
    expect(out).toContain('formula: C6H12O6')
    expect(out).not.toContain('monoisotopic_mass:')
    expect(out).not.toContain('average_mass:')
    expect(out).not.toContain('iupac_name:')
    expect(out).not.toContain('smiles:')
    expect(out).toContain('description: Glucose is a simple sugar and an important energy source.')
    // "See Also" 是导航项，不是描述正文
    expect(out).not.toContain('annotation moved to')
    // 空同义词被过滤
    expect(out).toContain('synonyms: glucose; D-glucose')
    expect(out).toContain('page: https://pubchem.ncbi.nlm.nih.gov/compound/5863')
    expect(out).toContain('https://pubchem.ncbi.nlm.nih.gov/compound/5863')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1]![0]).toContain('/pug_view/data/compound/5863/JSON')
    expect(fetchMock.mock.calls[1]![0]).toContain('heading=Record%20Description')
  })

  it('survives a description endpoint failure (props and synonyms still returned)', async () => {
    mockFetch([
      {
        match: '/property/',
        body: { PropertyTable: { Properties: [{ CID: 7, MolecularFormula: 'C2H6O' }] } },
      },
      { match: '/pug_view/', ok: false, status: 503, body: 'unavailable' },
      {
        match: '/synonyms/',
        body: { InformationList: { Information: [{ Synonym: ['ethanol'] }] } },
      },
    ])
    const out = await pubchemLookupCompound('ethanol')
    expect(out).toContain('cid: 7')
    expect(out).toContain('synonyms: ethanol')
    expect(out).not.toContain('description:')
  })

  it('survives synonyms endpoint failure (props still returned)', async () => {
    mockFetch([
      {
        match: '/property/',
        body: { PropertyTable: { Properties: [{ CID: 1, MolecularFormula: 'CH4' }] } },
      },
      { match: '/synonyms/', ok: false, status: 500, body: 'boom' },
    ])

    const out = await pubchemLookupCompound('methane')
    expect(out).toContain('cid: 1')
    expect(out).toContain('page: https://pubchem.ncbi.nlm.nih.gov/compound/1')
    expect(out).not.toContain('synonyms:')
  })

  it('throws readable error on 404 (unknown compound)', async () => {
    mockFetch([{ match: '/property/', ok: false, status: 404, body: '' }])
    await expect(pubchemLookupCompound('not-a-molecule-xyz')).rejects.toThrow(
      'Not found in database (HTTP 404)',
    )
  })

  it('keeps each batch item’s official page link aligned with its own CID', async () => {
    const fetcher = vi.fn(async (url: string) => {
      const cid = url.includes('/name/alpha/') ? 101 : 202
      if (url.includes('/property/')) {
        return Response.json({ PropertyTable: { Properties: [{ CID: cid }] } })
      }
      return Response.json({ InformationList: { Information: [{ Synonym: [] }] } })
    })
    vi.stubGlobal('fetch', fetcher)
    const ctx = await makeKnowledgeContext()
    try {
      const tool = ctx.tools.list().find((item) => item.name === 'pubchem_compound_lookup')!
      expect(tool.description).toContain('official CID page')
      expect(tool.description).toContain('Judge identity from the returned record as a whole')
      const result = await ctx.tools.execute({
        callId: 'pubchem-pages',
        name: 'pubchem_compound_lookup',
        arguments: { names: ['alpha', 'beta'] },
        signal: new AbortController().signal,
      })
      expect(result.isError).toBe(false)
      expect(result.content).toContain('### alpha\nname: alpha\ncid: 101')
      expect(result.content).toContain('### beta\nname: beta\ncid: 202')
      expect(result.content).toContain('page: https://pubchem.ncbi.nlm.nih.gov/compound/101')
      expect(result.content).toContain('page: https://pubchem.ncbi.nlm.nih.gov/compound/202')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

/** Minimal PNG: signature + IHDR carrying width/height, padded past the header. */
function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0, 0, 0, 13], 8)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12) // IHDR
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}

describe('pubchem_compound_lookup withImage', () => {
  /** alpha → CID 101, beta → CID 202; PNG requests route by CID. */
  function stubPubChem(png: (cid: number) => Response) {
    const fetcher = vi.fn(async (url: string) => {
      const cid = url.includes('/name/alpha/') || url.includes('/cid/101/') ? 101 : 202
      if (url.includes('/property/')) {
        return Response.json({
          PropertyTable: { Properties: [{ CID: cid, MolecularFormula: 'C6H12O6' }] },
        })
      }
      if (url.includes('/PNG')) return png(cid)
      return Response.json({ InformationList: { Information: [{ Synonym: [] }] } })
    })
    vi.stubGlobal('fetch', fetcher)
    return fetcher
  }

  const pngResponse = () =>
    new Response(pngBytes(500, 500).buffer as ArrayBuffer, {
      headers: { 'content-type': 'image/png' },
    })

  async function call(args: Record<string, unknown>) {
    const ctx = await makeKnowledgeContext()
    try {
      return await ctx.tools.execute({
        callId: 'pubchem-image',
        name: 'pubchem_compound_lookup',
        arguments: args,
        signal: new AbortController().signal,
      })
    } finally {
      await ctx.fiber.dispose()
    }
  }

  it('attaches one structure per returned CID, labelled with the queried name', async () => {
    const fetcher = stubPubChem(pngResponse)
    const result = await call({ names: ['alpha', 'beta'], withImage: true })
    expect(result.isError).toBe(false)
    expect(result.content).toContain('cid: 101')
    expect(result.images).toHaveLength(2)
    expect(result.images![0]).toMatchObject({
      mime: 'image/png',
      width: 500,
      height: 500,
      label: 'alpha (PubChem CID 101)',
    })
    expect(result.images![1]!.label).toBe('beta (PubChem CID 202)')
    const urls = fetcher.mock.calls.map((c) => c[0] as string)
    expect(urls).toContain(
      'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/101/PNG?image_size=500x500',
    )
    expect(urls).toContain(
      'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/202/PNG?image_size=500x500',
    )
  })

  it('stays text-only unless withImage is requested', async () => {
    const fetcher = stubPubChem(pngResponse)
    const result = await call({ names: ['alpha'] })
    expect(result.images).toBeUndefined()
    expect(fetcher.mock.calls.some((c) => (c[0] as string).includes('/PNG'))).toBe(false)
  })

  it('keeps the text and reports the gap when one structure image fails', async () => {
    stubPubChem((cid) => (cid === 101 ? pngResponse() : new Response('nope', { status: 503 })))
    const result = await call({ names: ['alpha', 'beta'], withImage: true })
    expect(result.isError).toBe(false)
    expect(result.content).toContain('cid: 202')
    expect(result.content).toContain('structure images unavailable')
    expect(result.content).toContain('beta (CID 202): structure image HTTP 503')
    expect(result.images).toHaveLength(1)
  })

  it('returns text without images when every structure image fails', async () => {
    stubPubChem(() => new Response('<!doctype html>', { status: 200 }))
    const result = await call({ names: ['alpha'], withImage: true })
    expect(result.isError).toBe(false)
    expect(result.images).toBeUndefined()
    expect(result.content).toContain('structure image response was not a PNG')
  })

  it.each([
    ['more than four names', { names: ['a', 'b', 'c', 'd', 'e'], withImage: true }, '1–4 names'],
    ['offset', { names: ['alpha'], withImage: true, offset: 1 }, 'does not paginate'],
    ['limit', { names: ['alpha'], withImage: true, limit: 2 }, 'does not paginate'],
  ])('rejects withImage with %s', async (_label, args, message) => {
    stubPubChem(pngResponse)
    const result = await call(args)
    expect(result.isError).toBe(true)
    expect(result.content).toContain(message)
  })
})

describe('pubchemSearchFormula', () => {
  it('lists candidates with total and truncation note', async () => {
    mockFetch([
      {
        match: '/fastformula/',
        body: {
          PropertyTable: {
            Properties: Array.from({ length: 20 }, (_, i) => ({
              CID: 1000 + i,
              MolecularFormula: 'C6H12O6',
              MonoisotopicMass: 180.063 + i,
              InChIKey: `KEY${i}`,
            })),
          },
        },
      },
    ])

    const out = await pubchemSearchFormula('C6H12O6', 15)

    expect(out).toContain('total_matches: 20')
    expect(out).toContain(
      '- 1000 | C6H12O6 | 180.063 | KEY0 | page: https://pubchem.ncbi.nlm.nih.gov/compound/1000',
    )
    expect(out).toContain('page: https://pubchem.ncbi.nlm.nih.gov/compound/1014')
    expect(out).not.toContain('page: https://pubchem.ncbi.nlm.nih.gov/compound/1015')
    expect(out).toContain('(…and 5 more)')
  })

  it('throws when no compound matches the formula', async () => {
    mockFetch([{ match: '/fastformula/', body: { PropertyTable: { Properties: [] } } }])
    await expect(pubchemSearchFormula('Xx99', 15)).rejects.toThrow('No compound found')
  })
})

describe('chebiLookup', () => {
  const DERIVATIVE_FIRST = {
    response: {
      docs: [
        {
          iri: 'http://purl.obolibrary.org/obo/CHEBI_12345',
          short_form: 'CHEBI:12345',
          label: 'palmitic acid derivative',
          synonym: ['palmitoyl residue'],
          description: ['A derivative of palmitic acid.'],
        },
        {
          iri: 'http://purl.obolibrary.org/obo/CHEBI_15756',
          short_form: 'CHEBI:15756',
          label: 'palmitic acid',
          synonym: ['hexadecanoic acid'],
          description: ['A straight-chain saturated fatty acid.'],
        },
      ],
    },
  }

  it('keeps OLS4 relevance order (no identity claim) and links each term by its own short_form', async () => {
    mockFetch([{ match: 'ols4', body: DERIVATIVE_FIRST }])
    const out = await chebiLookup('palmitic acid', 5)

    const derivative = out.indexOf('palmitic acid derivative')
    const exact = out.indexOf('- palmitic acid (CHEBI:15756)')
    expect(derivative).toBeGreaterThanOrEqual(0)
    expect(exact).toBeGreaterThan(derivative) // 顺序保持 OLS4 相关性排序
    expect(out).toContain('| page: https://www.ebi.ac.uk/chebi/searchId.do?chebiId=CHEBI:12345')
    expect(out).toContain('| page: https://www.ebi.ac.uk/chebi/searchId.do?chebiId=CHEBI:15756')
    expect(out).not.toContain('exact') // 不伪装成身份匹配
    expect(out).toContain('source: ChEBI via EBI OLS4')
  })

  it('normalizes the underscore identifier when falling back to the IRI', async () => {
    mockFetch([
      {
        match: 'ols4',
        body: {
          response: {
            docs: [
              {
                iri: 'http://purl.obolibrary.org/obo/CHEBI_15756',
                label: 'palmitic acid',
                description: ['A fatty acid.'],
              },
            ],
          },
        },
      },
    ])
    const out = await chebiLookup('palmitic acid', 5)
    expect(out).toContain('- palmitic acid (CHEBI:15756)')
    expect(out).toContain('| page: https://www.ebi.ac.uk/chebi/searchId.do?chebiId=CHEBI:15756')
    expect(out).not.toContain('CHEBI_15756')
  })

  it('normalizes the actual OLS4 underscore short_form for the page link', async () => {
    mockFetch([
      {
        match: 'ols4',
        body: {
          response: {
            docs: [
              {
                iri: 'http://purl.obolibrary.org/obo/CHEBI_15756',
                short_form: 'CHEBI_15756',
                label: 'palmitic acid',
              },
            ],
          },
        },
      },
    ])
    const out = await chebiLookup('palmitic acid', 5)
    expect(out).toContain('- palmitic acid (CHEBI:15756)')
    expect(out).toContain('| page: https://www.ebi.ac.uk/chebi/searchId.do?chebiId=CHEBI:15756')
    expect(out).not.toContain('chebiId=CHEBI_15756')
  })

  it('keeps the no-match message unchanged', async () => {
    mockFetch([{ match: 'ols4', body: { response: { docs: [] } } }])
    await expect(chebiLookup('zzz-not-a-compound', 5)).resolves.toContain('No ChEBI terms match')
  })

  it('documents relevance ordering and identity verification in the description', async () => {
    const ctx = await makeKnowledgeContext()
    try {
      const tool = ctx.tools.list().find((item) => item.name === 'chebi_lookup')!
      expect(tool.description).toContain('relevance ranking is not identity verification')
      expect(tool.description).toContain('first hit may be a derivative or related compound')
      expect(tool.description).toContain('kegg_compound')
      expect(tool.description).toContain('pubchem_compound_lookup')
      expect(tool.description).toContain('official page links')
      expect(Object.keys(tool.parameters.properties)).not.toContain('query')
      expect(tool.parameters.required).toContain('queries')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

it('uses supported PubChem property names and reads current response keys', async () => {
  const fetcher = mockFetch([
    {
      match: '/property/',
      body: {
        PropertyTable: {
          Properties: [
            {
              CID: 5793,
              MolecularFormula: 'C6H12O6',
              InChIKey: 'WQZGKKKJIJFFOK-GASJEMHNSA-N',
            },
          ],
        },
      },
    },
    {
      match: '/pug_view/',
      body: { Record: {} },
    },
    {
      match: '/synonyms/',
      body: { InformationList: { Information: [{ Synonym: ['D-glucose'] }] } },
    },
  ])
  const signal = new AbortController().signal
  const result = await pubchemLookupCompound('glucose', signal)
  expect(result).toContain('formula: C6H12O6')
  expect(result).toContain('inchikey: WQZGKKKJIJFFOK-GASJEMHNSA-N')
  expect(result).not.toContain('average_mass:')
  expect(result).not.toContain('smiles:')
  expect(fetcher.mock.calls[0]![0]).toContain('MolecularFormula,InChIKey')
  expect(fetcher.mock.calls[2]![0]).toContain('/cid/5793/synonyms/')
})

it('propagates cancellation during optional PubChem synonyms rather than returning partial success', async () => {
  const controller = new AbortController()
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/property/'))
      return Response.json({ PropertyTable: { Properties: [{ CID: 1 }] } })
    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
    })
  })
  vi.stubGlobal('fetch', fetcher)
  const result = pubchemLookupCompound('methane', controller.signal)
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  const reason = new Error('user stopped lookup')
  controller.abort(reason)
  await expect(result).rejects.toBe(reason)
})

describe('hmdb_lookup archived profiles', () => {
  it('parses required and optional XML fields and reports the canonical page and snapshot', async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toBe('/hmdb-archive/HMDB0003502.xml')
      return archiveResponse(HMDB_XML)
    })
    vi.stubGlobal('fetch', fetcher)
    const out = await hmdbLookupById('hmdb0003502')
    expect(out).toContain('HMDB ID: HMDB0003502')
    expect(out).toContain('Common Name: Example metabolite')
    expect(out).toContain('Update Date: 2021-09-14 15:47:08')
    expect(out).toContain('Synonyms (2): Synonym one; Synonym two')
    expect(out).toContain('Chemical Formula: C6H12O6')
    expect(out).toContain('Monoisotopic Molecular Weight: 180.063388')
    expect(out).toContain('Average Molecular Weight: 180.156')
    expect(out).toContain('IUPAC Name: (2R,3S,4R,5R)-2,3,4,5,6-pentahydroxyhexanal')
    expect(out).toContain('Traditional Name: (2R,3S,4R,5R)-2,3,4,5,6-pentahydroxy-hexanal')
    expect(out).toContain('CAS Registry Number: 50-99-7')
    expect(out).toContain('SMILES: OCC(O)C(O)C(O)C(O)C=O')
    expect(out).toContain(
      'InChI Identifier: InChI=1S/C6H12O6/c7-1-3(9)5(11)6(12)4(10)2-8/h1,3-6,8-12H,2H2/t3-,4+,5+,6+/m0/s1',
    )
    expect(out).toContain('InChI Key: WQZGKKKJIJFFOK-GASJEMHNSA-N')
    expect(out).toContain('Description: An archived HMDB description.')
    expect(out).toContain(
      'Taxonomy Class: Organic compounds > Organic oxygen compounds > Organooxygen compounds > Carbohydrates and carbohydrate conjugates > Hexoses',
    )
    expect(out).toContain('Molecular Framework: Aliphatic acyclic compounds')
    expect(out).toContain('Role (1): Energy source')
    expect(out).not.toContain('Endogenous')
    expect(out).toContain('Tissue Locations (2): Blood; Liver')
    expect(out).toContain('Cellular Locations (1): Cytoplasm')
    expect(out).toContain('Biospecimen Locations (2): Blood; Urine')
    expect(out).not.toContain('diseases')
    expect(out).toContain('Pathways (1):')
    expect(out).toContain('- Example pathway [map00010](https://www.kegg.jp/pathway/map00010)')
    expect(out).toContain('Normal Concentrations (1):')
    expect(out).toContain('- Blood: 4.5 (4.0-5.0) uM, Adult, Both, Normal')
    expect(out).toContain('PMID: 11417869')
    // External Links use the HMDB page labels, not the XML tag names.
    expect(out).toContain('KEGG Compound ID: C00031')
    expect(out).toContain('ChEBI ID: CHEBI:4167')
    expect(out).toContain('PubChem Compound: 5793')
    expect(out).toContain('Chemspider ID: 12345')
    expect(out).toContain('FooDB ID: FDB000001')
    expect(out).not.toContain('pubchem_id:')
    expect(out).not.toContain('pubchem_compound_id:')
    expect(out).toContain('page: https://hmdb.ca/metabolites/HMDB0003502')
    expect(out).toContain(
      'archive: https://web.archive.org/web/20240722195439id_/https://hmdb.ca/metabolites/HMDB0003502.xml',
    )
    expect(out).toContain('snapshot: 20240722195439')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('caps variable-length fields and reports omitted counts', () => {
    const profile = parseHmdbXml(HMDB_XML)
    profile.synonyms = Array.from({ length: 12 }, (_, i) => `synonym ${i}`)
    profile.tissues = Array.from({ length: 13 }, (_, i) => `tissue ${i}`)
    profile.roles = Array.from({ length: 14 }, (_, i) => `role ${i}`)
    const out = formatHmdbProfile(profile, 'https://archive.example/snapshot')
    expect(out).toContain('Synonyms (12):')
    expect(out).toContain('… +2 more')
    expect(out).toContain('Tissue Locations (13):')
    expect(out).toContain('Role (14):')
    expect(out).toContain('snapshot: unknown')
  })

  it('truncates the description at a sentence boundary near the 1000-character cap', () => {
    const profile = parseHmdbXml(HMDB_XML)
    const sentence = 'This metabolite participates in a well described pathway. '
    profile.description = sentence.repeat(30).trim() // 31 sentences ≈ 2010 chars
    const out = formatHmdbProfile(profile, 'https://archive.example/snapshot')
    const description = /^Description: (.+)$/m.exec(out)![1]!
    expect(description.endsWith(' …')).toBe(true)
    const body = description.slice(0, -2)
    expect(body.length).toBeLessThanOrEqual(1000)
    // The cut lands on a whole sentence: the body is a whole number of
    // sentences and does not stop mid-clause.
    expect(body).toMatch(/\.$/)
    expect(body.split('. ').length).toBe(17)
    // With no boundary in the second half, the hard cap applies as fallback.
    expect(truncateDescription('x'.repeat(1200))).toBe('x'.repeat(1000))
  })

  it('retries transient rate-limit and gateway statuses once, but not the relay redirect-contract 502', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(archiveResponse('busy', 503))
      .mockResolvedValueOnce(archiveResponse(HMDB_XML))
    vi.stubGlobal('fetch', fetcher)
    const out = await hmdbLookupById('HMDB0003502')
    expect(out).toContain('Common Name: Example metabolite')
    expect(fetcher).toHaveBeenCalledTimes(2)

    fetcher.mockReset().mockResolvedValue(archiveResponse('bad redirect', 502))
    const fallback = await hmdbLookupById('HMDB0003502')
    expect(fallback).toContain('HTTP 502 from the HMDB Wayback relay after bounded retry')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('allows cancellation while an HMDB request waits in the shared pacing queue', async () => {
    const controller = new AbortController()
    let releaseFirst!: (response: Response) => void
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { releaseFirst = resolve }))
      .mockResolvedValue(archiveResponse(HMDB_XML))
    vi.stubGlobal('fetch', fetcher)
    const first = hmdbLookupById('HMDB0003502')
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    const queued = hmdbLookupById('HMDB0003503', controller.signal)
    controller.abort(new Error('cancel queued request'))
    await expect(queued).rejects.toThrow('cancel queued request')
    releaseFirst(archiveResponse(HMDB_XML))
    await expect(first).resolves.toContain('Common Name: Example metabolite')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('returns the fixed 404 message and does not block later batch items', async () => {
    const calls: string[] = []
    const fetcher = vi.fn(async (url: string) => {
      calls.push(url)
      return url.includes('HMDB0000001') ? archiveResponse('', 404) : archiveResponse(HMDB_XML)
    })
    vi.stubGlobal('fetch', fetcher)
    const ctx = await makeKnowledgeContext()
    try {
      const result = await ctx.tools.execute({
        callId: 'hmdb-batch',
        name: 'hmdb_lookup',
        arguments: { ids: ['HMDB0000001', 'HMDB0003502'] },
        signal: new AbortController().signal,
      })
      expect(result.isError).toBe(false)
      expect(result.content).toContain('No archived snapshot for HMDB0000001')
      expect(result.content).toContain('Common Name: Example metabolite')
      expect(calls).toEqual(['/hmdb-archive/HMDB0000001.xml', '/hmdb-archive/HMDB0003502.xml'])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('degrades same-origin relay failures to links without pretending to have profile data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    )
    const out = await hmdbLookupById('HMDB0003502')
    expect(out).toContain(
      'Archive content could not be retrieved (network/relay); no HMDB data has been retrieved.',
    )
    expect(out).toContain('page: https://hmdb.ca/metabolites/HMDB0003502')
    expect(out).toContain(
      'archive: https://web.archive.org/web/2id_/https://hmdb.ca/metabolites/HMDB0003502.xml',
    )
    expect(out).not.toContain('Chemical Formula:')
    expect(out).not.toContain('snapshot: 20')
  })

  it.each([502, 503, 504])('degrades relay HTTP %s failures to links', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => archiveResponse('unavailable', status)),
    )
    const out = await hmdbLookupById('HMDB0003502')
    expect(out).toContain(
      'Archive content could not be retrieved (network/relay); no HMDB data has been retrieved.',
    )
    expect(out).toContain('page: https://hmdb.ca/metabolites/HMDB0003502')
    expect(out).toContain(
      'archive: https://web.archive.org/web/2id_/https://hmdb.ca/metabolites/HMDB0003502.xml',
    )
    expect(out).toContain(`Network detail: HTTP ${status} from the HMDB Wayback relay`)
    expect(out).not.toContain('Chemical Formula:')
  })

  it('rejects malformed XML at the parser and degrades relay failures at the tool level', async () => {
    expect(() => parseHmdbXml('<metabolite><name>broken</name>')).toThrow('Invalid HMDB XML')
    expect(() => parseHmdbXml('<metabolite><name>Missing id</name></metabolite>')).toThrow(
      'missing accession',
    )
    // Non-404 client errors degrade to the link result; they used to hard-fail.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => archiveResponse('unavailable', 403)),
    )
    let out = await hmdbLookupById('HMDB0003502')
    expect(out).toContain('no HMDB data has been retrieved.')
    expect(out).toContain('Network detail: HTTP 403 from the HMDB Wayback relay')
    expect(out).toContain('page: https://hmdb.ca/metabolites/HMDB0003502')
    // A 200 answering with the SPA index.html (misrouted relay) degrades the same way.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => archiveResponse('<html><body>SPA</body></html>')),
    )
    out = await hmdbLookupById('HMDB0003502')
    expect(out).toContain('no HMDB data has been retrieved.')
    expect(out).toContain('not readable HMDB XML')
    expect(out).toContain('page: https://hmdb.ca/metabolites/HMDB0003502')
    expect(out).toContain(
      'archive: https://web.archive.org/web/2id_/https://hmdb.ca/metabolites/HMDB0003502.xml',
    )
  })

  it('isolates one invalid accession in a batch instead of failing the whole call', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => archiveResponse(HMDB_XML)),
    )
    const ctx = await makeKnowledgeContext()
    try {
      const result = await ctx.tools.execute({
        callId: 'hmdb-mixed-batch',
        name: 'hmdb_lookup',
        arguments: { ids: ['HMDB0003502', 'hmdb 123'] },
        signal: new AbortController().signal,
      })
      expect(result.isError).toBe(false)
      expect(result.content).toContain('Common Name: Example metabolite')
      expect(result.content).toContain('Error: Invalid HMDB id "hmdb 123"')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('leaves budget-exhausted ids for the nextOffset footer instead of degrading them in place', async () => {
    let fakeNow = 1_700_000_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => fakeNow)
    try {
      const fetcher = vi.fn(async () => {
        // After the first fetch returns, the 90s batch budget is spent.
        fakeNow += 91_000
        return archiveResponse(HMDB_XML)
      })
      vi.stubGlobal('fetch', fetcher)
      const ctx = await makeKnowledgeContext()
      try {
        const result = await ctx.tools.execute({
          callId: 'hmdb-time-budget',
          name: 'hmdb_lookup',
          arguments: { ids: ['HMDB0003502', 'HMDB0000001'], limit: 8 },
          signal: new AbortController().signal,
        })
        expect(result.isError).toBe(false)
        expect(result.content).toContain('Common Name: Example metabolite')
        // The second id must NOT be rendered as done (degraded in place): it
        // stays queryable via the footer so the model retries it with a fresh
        // budget instead of skipping it forever.
        expect(result.content).toContain(
          '1 inputs not started: the batch time budget was exhausted',
        )
        expect(result.content).toContain('nextOffset=1')
        expect(result.content).not.toContain('HMDB0000001 |')
        expect(fetcher).toHaveBeenCalledTimes(1)
      } finally {
        await ctx.fiber.dispose()
      }
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('preserves caller cancellation instead of converting it to link-only success', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), {
            once: true,
          })
        }),
    )
    vi.stubGlobal('fetch', fetcher)
    const result = hmdbLookupById('HMDB0003502', controller.signal)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    const reason = new Error('stop HMDB lookup')
    controller.abort(reason)
    await expect(result).rejects.toBe(reason)
  })
})

it('exposes only accession-based HMDB parameters and validates empty input', async () => {
  const ctx = await makeKnowledgeContext()
  try {
    const tool = ctx.tools.list().find((item) => item.name === 'hmdb_lookup')!
    expect(Object.keys(tool.parameters.properties)).toEqual(
      expect.arrayContaining(['ids', 'offset', 'limit']),
    )
    for (const removed of [
      'id',
      'query',
      'queries',
      'mz',
      'mzs',
      'polarity',
      'ppm',
      'maxResults',
    ]) {
      expect(tool.parameters.properties).not.toHaveProperty(removed)
    }
    const result = await ctx.tools.execute({
      callId: 'hmdb-empty',
      name: 'hmdb_lookup',
      arguments: {},
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('ids')
  } finally {
    await ctx.fiber.dispose()
  }
})

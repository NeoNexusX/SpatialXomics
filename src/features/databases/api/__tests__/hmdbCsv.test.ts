import { beforeEach, describe, expect, it, vi } from 'vitest'

// 适配器带模块级缓存，每个用例前 resetModules 后动态 import，拿到干净的缓存

const CSV = [
  'ID,Name,Formula,InChI,Mass',
  'HMDB1,Creatine riboside,C9H17N3O6,"InChI=1S/a",263.1117353',
  'HMDB2,N-Acetyltaurine,C4H9NO4S,"InChI=1S/b",167.0252289',
  'HMDB3,Salicyluric beta-D-glucuronide,C15H17NO10,"InChI=1S/c",371.0852458',
  'HMDB4,cis-4-Hydroxyproline,C5H9NO3,"InChI=1S/d",131.0582432',
  'HMDB5,Another metabolite,C2H6O,"InChI=1S/e",46.0418651',
].join('\n')

function stubFetch(body: string, ok = true) {
  const fetchMock = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 404,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function freshModule() {
  vi.resetModules()
  return import('../hmdbCsv')
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('listHmdbFromCsv', () => {
  it('returns the shared envelope with pagination meta', async () => {
    stubFetch(CSV)
    const { listHmdbFromCsv } = await freshModule()
    const res = await listHmdbFromCsv({ page: 1, size: 2 })
    expect(res.data).toHaveLength(2)
    expect(res.data[0]!.id).toBe('HMDB1')
    expect(res.meta).toEqual({ current_page: 1, total_pages: 3, total_records: 5 })
  })

  it('clamps an out-of-range page into the valid range', async () => {
    stubFetch(CSV)
    const { listHmdbFromCsv } = await freshModule()
    const res = await listHmdbFromCsv({ page: 99, size: 2 })
    expect(res.meta.current_page).toBe(3)
    expect(res.data.map((r) => r.id)).toEqual(['HMDB5'])
  })

  it('filters by keyword case-insensitively across id, name and formula', async () => {
    stubFetch(CSV)
    const { listHmdbFromCsv } = await freshModule()
    const byName = await listHmdbFromCsv({ keyword: 'creATine', page: 1, size: 10 })
    expect(byName.data.map((r) => r.id)).toEqual(['HMDB1'])
    const byFormula = await listHmdbFromCsv({ keyword: 'C4H9NO4S', page: 1, size: 10 })
    expect(byFormula.data.map((r) => r.id)).toEqual(['HMDB2'])
  })

  it('downloads the CSV only once across calls (module-level cache)', async () => {
    const fetchMock = stubFetch(CSV)
    const { listHmdbFromCsv } = await freshModule()
    await listHmdbFromCsv({ page: 1, size: 2 })
    await listHmdbFromCsv({ page: 2, size: 2 })
    await listHmdbFromCsv({ keyword: 'taurine', page: 1, size: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not cache failures, so a retry can recover', async () => {
    stubFetch('', false)
    const { listHmdbFromCsv } = await freshModule()
    await expect(listHmdbFromCsv({ page: 1, size: 2 })).rejects.toThrow(/404/)
    // 失败后缓存已清：修复 fetch 再调用，能正常取数
    stubFetch(CSV)
    const res = await listHmdbFromCsv({ page: 1, size: 10 })
    expect(res.meta.total_records).toBe(5)
  })
})

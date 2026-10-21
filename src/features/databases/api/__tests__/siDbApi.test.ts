import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// siDbApi 只消费 auth_api 的方法调用，mock 掉 httpClient 即可断言请求形状
vi.mock('@/shared/api/httpClient', () => ({
  auth_api: { get: vi.fn(), post: vi.fn() },
  api: { get: vi.fn(), post: vi.fn() },
}))

import { auth_api } from '@/shared/api/httpClient'
import { fetchSiDbCsv, getSiDbDownload, listSiDb, toProxiedRelayUrl } from '../siDbApi'

const post = vi.mocked(auth_api.post)
const get = vi.mocked(auth_api.get)

beforeEach(() => {
  post.mockReset()
  get.mockReset()
})

afterEach(() => vi.unstubAllGlobals())

describe('listSiDb', () => {
  it('sends a mandatory (empty by default) body with default sort in the query', async () => {
    post.mockResolvedValue({ data: { data: [], meta: { current_page: 1, current_records: 0, total_pages: 1, total_records: 0 } } })

    await listSiDb()

    expect(post).toHaveBeenCalledWith('/annotations/si-db/list', {}, {
      params: { page: 1, size: 10, sort_by: 'entry_key', order: 'asc' },
    })
  })

  it('passes filter fields in the body and pagination/sort in the query', async () => {
    post.mockResolvedValue({ data: { data: [], meta: { current_page: 3, total_pages: 5, total_records: 50 } } })

    await listSiDb(
      { name: 'creatine', origin: 'endogenous', mass_min: 100, mass_max: 300 },
      3,
      50,
      { sortBy: 'mass', order: 'desc' },
    )

    expect(post).toHaveBeenCalledWith(
      '/annotations/si-db/list',
      { name: 'creatine', origin: 'endogenous', mass_min: 100, mass_max: 300 },
      { params: { page: 3, size: 50, sort_by: 'mass', order: 'desc' } },
    )
  })

  it('returns the unwrapped { data, meta } envelope', async () => {
    const body = {
      data: [{ entry_key: 'HMDB0000001', name: '1-Methylhistidine', formula: 'C7H11N3O2', mass: 169.0851266, origin: 'endogenous', inchi: 'InChI=1S/...' }],
      meta: { current_page: 1, current_records: 1, total_pages: 5635, total_records: 112691 },
    }
    post.mockResolvedValue({ data: body })

    await expect(listSiDb({}, 1, 1)).resolves.toBe(body)
  })
})

describe('getSiDbDownload', () => {
  it('GETs the download endpoint and unwraps { filename, url, size }', async () => {
    const body = { filename: 'SI_DB.csv', url: 'http://backend/annotations/si-db/relay/download?token=x', size: 40386338 }
    get.mockResolvedValue({ data: body })

    await expect(getSiDbDownload()).resolves.toBe(body)
    expect(get).toHaveBeenCalledWith('/annotations/si-db/download')
  })
})

describe('toProxiedRelayUrl', () => {
  it('rewrites the absolute relay url onto the same-origin /api proxy, keeping path and query', () => {
    expect(toProxiedRelayUrl('http://47.98.174.83:8000/annotations/si-db/relay/download?token=abc%2Fx')).toBe(
      '/api/annotations/si-db/relay/download?token=abc%2Fx',
    )
  })
})

describe('fetchSiDbCsv', () => {
  /** 不依赖真实 Response/ReadableStream：够用的假流（分块 push，读尽返回 done） */
  function fakeStreamResponse(chunks: string[], ok = true) {
    const enc = new TextEncoder()
    let i = 0
    return {
      ok,
      body: {
        getReader: () => ({
          read: async () =>
            i < chunks.length
              ? { done: false, value: enc.encode(chunks[i++]!) }
              : { done: true, value: undefined },
        }),
      },
    }
  }

  it('fetches the proxied relay url, reports byte progress and decodes the csv text', async () => {
    const csv = 'ID,Name,Formula\nHMDB1,X,C6H12O6'
    get.mockResolvedValue({
      data: {
        filename: 'SI_DB.csv',
        url: 'http://backend/annotations/si-db/relay/download?token=x',
        size: csv.length,
      },
    })
    const fetchMock = vi.fn(async () => fakeStreamResponse([csv.slice(0, 5), csv.slice(5)]))
    vi.stubGlobal('fetch', fetchMock)
    const progress: Array<[number, number]> = []

    const res = await fetchSiDbCsv((loaded, total) => progress.push([loaded, total]))

    expect(fetchMock).toHaveBeenCalledWith('/api/annotations/si-db/relay/download?token=x')
    expect(res).toEqual({ fileName: 'SI_DB.csv', text: csv })
    expect(progress).toEqual([
      [5, csv.length],
      [csv.length, csv.length],
    ])
  })

  it('throws on a non-OK relay response without touching the body', async () => {
    get.mockResolvedValue({
      data: { filename: 'SI_DB.csv', url: 'http://backend/relay?token=x', size: 1 },
    })
    const body = { getReader: vi.fn() }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, body })))

    await expect(fetchSiDbCsv()).rejects.toThrow('HTTP')
    expect(body.getReader).not.toHaveBeenCalled()
  })
})

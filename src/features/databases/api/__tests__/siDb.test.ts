import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type AxiosResponse } from 'axios'

vi.mock('@/shared/api/httpClient', () => ({
  auth_api: { get: vi.fn(), post: vi.fn() },
  api: { get: vi.fn(), post: vi.fn() },
}))

import { auth_api } from '@/shared/api/httpClient'
import { buildSiDbFilters, downloadSiDbCsv, listSiDbPage } from '../siDb'

const post = vi.mocked(auth_api.post)
const get = vi.mocked(auth_api.get)

/** 无响应（连接不上）的 axios 错误 */
const networkError = () => new AxiosError('Network Error')
/** 后端有响应但拒绝：status 会进 isServiceUnavailable 的分支判断 */
const httpError = (status: number) =>
  new AxiosError(`HTTP ${status}`, 'ERR', undefined, undefined, {
    status,
    data: {},
  } as AxiosResponse)

let clickSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  post.mockReset()
  get.mockReset()
  // 失败路径上 console.error 原始错误（约定），测试里静音降噪
  vi.spyOn(console, 'error').mockImplementation(() => {})
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildSiDbFilters', () => {
  it('maps HMDB-prefixed keyword to entry_key (checked before the formula shape)', () => {
    // "HMDB0001" 本身也满足分子式形状，前缀判断必须先做
    expect(buildSiDbFilters('HMDB0001')).toEqual({ entry_key: 'HMDB0001' })
    expect(buildSiDbFilters('hmdb')).toEqual({ entry_key: 'hmdb' })
  })

  it('maps formula-shaped keyword (element+count sequence containing a digit) to formula', () => {
    expect(buildSiDbFilters('C7H11N3O2')).toEqual({ formula: 'C7H11N3O2' })
    expect(buildSiDbFilters('C6H12O6')).toEqual({ formula: 'C6H12O6' })
    expect(buildSiDbFilters('CO2')).toEqual({ formula: 'CO2' })
  })

  it('maps everything else to name (words without digits never look like a formula)', () => {
    expect(buildSiDbFilters('Glucose')).toEqual({ name: 'Glucose' })
    expect(buildSiDbFilters('creatine riboside')).toEqual({ name: 'creatine riboside' })
    expect(buildSiDbFilters('1-Methylhistidine')).toEqual({ name: '1-Methylhistidine' })
  })

  it('ignores blank keyword and non-finite control values', () => {
    expect(buildSiDbFilters('')).toEqual({})
    expect(buildSiDbFilters('   ')).toEqual({})
    expect(buildSiDbFilters('', { origin: '', mass: { min: Number.NaN } })).toEqual({})
  })

  it('passes the origin select and finite mass bounds through', () => {
    expect(
      buildSiDbFilters('', { origin: 'endogenous', mass: { min: 100.5, max: 200 } }),
    ).toEqual({ origin: 'endogenous', mass_min: 100.5, mass_max: 200 })
    expect(buildSiDbFilters('', { mass: { max: 300 } })).toEqual({ mass_max: 300 })
  })
})

describe('listSiDbPage', () => {
  it('calls the live API and maps entry_key to id', async () => {
    post.mockResolvedValue({
      data: {
        data: [
          { entry_key: 'HMDB0000001', name: '1-Methylhistidine', formula: 'C7H11N3O2', mass: 169.0851266, origin: 'endogenous', inchi: 'InChI=1S/...' },
        ],
        meta: { current_page: 2, current_records: 1, total_pages: 5635, total_records: 112691 },
      },
    })

    const res = await listSiDbPage({ keyword: 'Methylhistidine', page: 2, size: 20 })

    expect(post).toHaveBeenCalledWith(
      '/annotations/si-db/list',
      { name: 'Methylhistidine' },
      { params: { page: 2, size: 20, sort_by: 'entry_key', order: 'asc' } },
    )
    expect(res.data[0]).toEqual({
      id: 'HMDB0000001',
      name: '1-Methylhistidine',
      formula: 'C7H11N3O2',
      mass: 169.0851266,
      origin: 'endogenous',
      inchi: 'InChI=1S/...',
    })
    expect(res.meta.total_records).toBe(112691)
  })

  it('maps filter controls into body fields alongside the keyword', async () => {
    post.mockResolvedValue({ data: { data: [], meta: { current_page: 1, total_pages: 1, total_records: 0 } } })

    await listSiDbPage({
      keyword: 'HMDB0001',
      filters: { origin: 'endogenous', mass: { min: 100, max: 300 } },
      page: 1,
      size: 10,
    })

    expect(post).toHaveBeenCalledWith(
      '/annotations/si-db/list',
      { entry_key: 'HMDB0001', origin: 'endogenous', mass_min: 100, mass_max: 300 },
      { params: { page: 1, size: 10, sort_by: 'entry_key', order: 'asc' } },
    )
  })

  it('replaces service-unavailable failures (no response / 5xx / 404) with a localized error', async () => {
    post
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(httpError(502))
      .mockRejectedValueOnce(httpError(404))

    // 语言包未加载时 t() 返回 key 本身；页面错误态显示的就是这句本地化文案
    for (let i = 0; i < 3; i++) {
      await expect(listSiDbPage({ page: 1, size: 10 })).rejects.toThrow(
        'databases.hmdb.serviceUnavailable',
      )
    }
  })

  it('rethrows explicit backend rejections (401/403/422) instead of masking them', async () => {
    post.mockRejectedValueOnce(httpError(401))
    await expect(listSiDbPage({ page: 1, size: 10 })).rejects.toBeInstanceOf(AxiosError)

    post.mockRejectedValueOnce(httpError(403))
    await expect(listSiDbPage({ page: 1, size: 10 })).rejects.toBeInstanceOf(AxiosError)

    post.mockRejectedValueOnce(httpError(422))
    await expect(listSiDbPage({ page: 0, size: 999 })).rejects.toBeInstanceOf(AxiosError)
  })
})

describe('downloadSiDbCsv', () => {
  it('navigates the browser to the relay url from step one', async () => {
    get.mockResolvedValue({
      data: { filename: 'SI_DB.csv', url: 'http://backend/annotations/si-db/relay/download?token=x', size: 40386338 },
    })

    await downloadSiDbCsv()

    expect(get).toHaveBeenCalledWith('/annotations/si-db/download')
    expect(clickSpy).toHaveBeenCalledTimes(1)
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement
    expect(anchor.href).toBe('http://backend/annotations/si-db/relay/download?token=x')
    expect(anchor.getAttribute('download')).toBe('SI_DB.csv')
  })

  it('throws a localized one-liner when step one fails, without touching the browser', async () => {
    get.mockRejectedValue(httpError(500))

    // 语言包未加载时 t() 返回 key 本身
    await expect(downloadSiDbCsv()).rejects.toThrow('databases.hmdb.downloadFailed')
    expect(clickSpy).not.toHaveBeenCalled()
  })
})

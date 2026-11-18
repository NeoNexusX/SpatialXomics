import { beforeEach, describe, expect, it, vi } from 'vitest'

// datasetApi 只消费 auth_api 的方法调用，mock 掉 httpClient 即可断言请求形状
vi.mock('@/shared/api/httpClient', () => ({
  auth_api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

import { auth_api } from '@/shared/api/httpClient'
import { countNonDirectProcesses, listMyProcesses } from '../datasetApi'

const post = vi.mocked(auth_api.post)

describe('countNonDirectProcesses', () => {
  beforeEach(() => {
    post.mockReset()
  })

  const page = (
    data: Array<Partial<{ id: number; params_json: string; status: string }>>,
    totalPages = 1,
    totalRecords = data.length,
  ) => ({
    data: { data, meta: { current_page: 1, total_pages: totalPages, total_records: totalRecords } },
  })

  it('excludes direct runs and accumulates across pages', async () => {
    post
      .mockResolvedValueOnce(
        page(
          [
            { id: 1, params_json: '__RAW_CONVERT__' },
            { id: 2, params_json: '{"noise_reduction":{}}' },
            { id: 3, params_json: '__RAW_CONVERT__' },
            { id: 4, params_json: '{"peak_align":{}}' },
          ],
          2,
          6,
        ),
      )
      .mockResolvedValueOnce(page([{ id: 5, params_json: '{"normalization":{}}' }], 2, 6))

    await expect(countNonDirectProcesses()).resolves.toBe(3)
    expect(post).toHaveBeenCalledTimes(2)
    expect(post).toHaveBeenNthCalledWith(
      1,
      '/processes/mine',
      {},
      { params: { page: 1, size: 100 } },
    )
    expect(post).toHaveBeenNthCalledWith(
      2,
      '/processes/mine',
      {},
      { params: { page: 2, size: 100 } },
    )
  })

  it('stops paging as soon as the limit is reached', async () => {
    post.mockResolvedValueOnce(
      page(
        [
          { id: 1, params_json: '{"noise_reduction":{}}' },
          { id: 2, params_json: '{"baseline_correction":{}}' },
          { id: 3, params_json: '{"normalization":{}}' },
          { id: 4, params_json: '{"peak_pick":{}}' },
          { id: 5, params_json: '{"peak_align":{}}' },
          { id: 6, params_json: '__RAW_CONVERT__' },
          { id: 7, params_json: '__RAW_CONVERT__' },
        ],
        5,
        500,
      ),
    )

    await expect(countNonDirectProcesses()).resolves.toBe(5)
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('returns zero when every run is a direct conversion', async () => {
    post.mockResolvedValueOnce(
      page([
        { id: 1, params_json: '__RAW_CONVERT__' },
        { id: 2, params_json: '__RAW_CONVERT__' },
      ]),
    )

    await expect(countNonDirectProcesses()).resolves.toBe(0)
  })

  it('counts processing runs returned by the list', async () => {
    post.mockResolvedValueOnce(
      page([
        { id: 1, status: 'processing', params_json: '{"noise_reduction":{}}' },
        { id: 2, status: 'completed', params_json: '{"normalization":{}}' },
      ]),
    )

    await expect(countNonDirectProcesses()).resolves.toBe(2)
  })
})

describe('listMyProcesses', () => {
  beforeEach(() => {
    post.mockReset()
  })

  it('sends POST with mandatory (empty by default) RunFilter body and page/size query', async () => {
    post.mockResolvedValue({
      data: { data: [], meta: { current_page: 1, total_pages: 1, total_records: 0 } },
    })

    await listMyProcesses(2, 20)

    expect(post).toHaveBeenCalledWith('/processes/mine', {}, { params: { page: 2, size: 20 } })
  })

  it('passes fuzzy filter fields in the body', async () => {
    post.mockResolvedValue({
      data: { data: [], meta: { current_page: 1, total_pages: 1, total_records: 0 } },
    })

    await listMyProcesses(1, 10, { filename: 'kidney', params: 'tolerance' })

    expect(post).toHaveBeenCalledWith(
      '/processes/mine',
      { filename: 'kidney', params: 'tolerance' },
      { params: { page: 1, size: 10 } },
    )
  })

  it('normalizes a plain array response into { data, meta }', async () => {
    const rows = [{ id: 1 }, { id: 2 }]
    post.mockResolvedValue({ data: rows })

    const result = await listMyProcesses()

    expect(result).toEqual({
      data: rows,
      meta: { current_page: 1, total_pages: 1, total_records: 2 },
    })
  })

  it('keeps the { data, meta } envelope when present', async () => {
    const body = { data: [{ id: 1 }], meta: { current_page: 2, total_pages: 3, total_records: 25 } }
    post.mockResolvedValue({ data: body })

    const result = await listMyProcesses()

    expect(result).toEqual(body)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

// datasetApi 只消费 auth_api 的方法调用，mock 掉 httpClient 即可断言请求形状
vi.mock('@/shared/api/httpClient', () => ({
  auth_api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

import { auth_api } from '@/shared/api/httpClient'
import { listMyProcesses } from '../datasetApi'

const post = vi.mocked(auth_api.post)

describe('listMyProcesses', () => {
  beforeEach(() => {
    post.mockReset()
  })

  it('sends POST with mandatory (empty by default) RunFilter body and page/size query', async () => {
    post.mockResolvedValue({ data: { data: [], meta: { current_page: 1, total_pages: 1, total_records: 0 } } })

    await listMyProcesses(2, 20)

    expect(post).toHaveBeenCalledWith('/processes/mine', {}, { params: { page: 2, size: 20 } })
  })

  it('passes fuzzy filter fields in the body', async () => {
    post.mockResolvedValue({ data: { data: [], meta: { current_page: 1, total_pages: 1, total_records: 0 } } })

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

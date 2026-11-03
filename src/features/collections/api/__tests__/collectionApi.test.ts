import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/httpClient', () => ({
  auth_api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  extractBackendError: (err: any, fallback?: string) =>
    err?.response?.data?.detail ?? err?.message ?? fallback ?? 'Collection request failed',
}))

import { api, auth_api } from '@/shared/api/httpClient'
import {
  addMembers,
  createCollection,
  deleteCollection,
  getPublicCollection,
  listAllCollections,
  listCollections,
  removeMembers,
  reorderMembers,
  updateCollection,
} from '../collectionApi'

const authGet = vi.mocked(auth_api.get)
const authPost = vi.mocked(auth_api.post)
const authPatch = vi.mocked(auth_api.patch)
const authDelete = vi.mocked(auth_api.delete)
const publicGet = vi.mocked(api.get)

/** 集合的 16 位 public_id：集合接口的唯一对外标识（数字 id 已下线） */
const CID = 'aB3xK9mQ2rT7wY1z'

const detailBody = {
  public_id: CID,
  name: 'X',
  member_count: 1,
  total_size: 10,
  owner_username: 'u',
  metadata: { name: 'X' },
  members: [{ public_id: 'qW3rT5yU7iO9pA1s', image_path: 'images/file_42/', filename: 'a.imzML' }],
}

beforeEach(() => {
  for (const m of [authGet, authPost, authPatch, authDelete, publicGet]) m.mockReset()
})

describe('collectionApi', () => {
  it('listCollections posts empty filter body, paginates via query, unwraps {meta, data}', async () => {
    // 列表行与详情同构：只有 public_id，无数字 id（对齐线上响应）
    const row = { public_id: 'bB2cD4fG6hJ8kL0m', name: 'a', member_count: 0, total_size: 0, owner_username: 'u' }

    authPost.mockResolvedValueOnce({
      data: {
        meta: { current_page: 2, current_records: 10, total_pages: 3, total_records: 25 },
        data: [row],
      },
    })
    const res = await listCollections(2, 10)

    expect(authPost).toHaveBeenCalledWith('/collections/list', {}, { params: { page: 2, size: 10 } })
    expect(res.meta).toEqual({
      current_page: 2,
      current_records: 10,
      total_pages: 3,
      total_records: 25,
    })
    expect(res.data).toHaveLength(1)
    expect(res.data.map((r) => r.name)).toEqual(['a'])
    expect(res.data[0]!.publicId).toBe('bB2cD4fG6hJ8kL0m')
  })

  it('listCollections passes filter body through (single value or array)', async () => {
    authPost.mockResolvedValueOnce({ data: { meta: {}, data: [] } })
    await listCollections(1, 10, { organism: ['mouse', 'human'], name: 'brain' })

    expect(authPost).toHaveBeenCalledWith(
      '/collections/list',
      { organism: ['mouse', 'human'], name: 'brain' },
      { params: { page: 1, size: 10 } },
    )
  })

  it('listCollections still tolerates legacy envelopes, meta falls back to single page', async () => {
    // 列表行与详情同构：只有 public_id，无数字 id（对齐线上响应）
    const row = { public_id: 'bB2cD4fG6hJ8kL0m', name: 'a', member_count: 0, total_size: 0, owner_username: 'u' }

    authPost.mockResolvedValueOnce({ data: [row, row] })
    const plain = await listCollections(1, 10)
    expect(plain.data).toHaveLength(2)
    expect(plain.meta).toEqual({
      current_page: 1,
      current_records: 0,
      total_pages: 1,
      total_records: 0,
    })

    authPost.mockResolvedValueOnce({ data: { items: [row] } })
    const items = await listCollections(1, 10)
    expect(items.data).toHaveLength(1)

    authPost.mockResolvedValueOnce({ data: {} })
    const empty = await listCollections(1, 10)
    expect(empty.data).toEqual([])
  })

  it('listAllCollections hits /collections/list_all with the same pagination contract', async () => {
    // 列表行与详情同构：只有 public_id，无数字 id（对齐线上响应）
    const row = { public_id: 'bB2cD4fG6hJ8kL0m', name: 'a', member_count: 0, total_size: 0, owner_username: 'u' }

    authPost.mockResolvedValueOnce({
      data: {
        meta: { current_page: 1, current_records: 1, total_pages: 1, total_records: 1 },
        data: [row],
      },
    })
    const res = await listAllCollections(1, 10)

    expect(authPost).toHaveBeenCalledWith(
      '/collections/list_all',
      {},
      { params: { page: 1, size: 10 } },
    )
    expect(res.data).toHaveLength(1)
    expect(res.meta.total_records).toBe(1)
  })

  it('createCollection posts payload and returns mapped detail', async () => {
    authPost.mockResolvedValueOnce({ data: detailBody })
    const d = await createCollection({
      name: 'X',
      description: 'd',
      file_public_ids: ['qW3rT5yU7iO9pA1s', 'zX9cV8bN6mL4kJ2h', 'pL0kJ8hG6fD4sA2w'],
    })
    expect(authPost).toHaveBeenCalledWith('/collections', {
      name: 'X',
      description: 'd',
      file_public_ids: ['qW3rT5yU7iO9pA1s', 'zX9cV8bN6mL4kJ2h', 'pL0kJ8hG6fD4sA2w'],
    })
    expect(d.memberCount).toBe(1)
  })

  it('updateCollection sends only provided fields via PATCH', async () => {
    authPatch.mockResolvedValueOnce({ data: detailBody })
    await updateCollection(CID, { name: 'Y' })
    expect(authPatch).toHaveBeenCalledWith(`/collections/${CID}`, { name: 'Y' })
  })

  it('deleteCollection maps the {public_id, deleted} response', async () => {
    authDelete.mockResolvedValueOnce({ data: { public_id: CID, deleted: true } })
    const r = await deleteCollection(CID)
    expect(r).toEqual({ publicId: CID, deleted: true })
  })

  it('addMembers posts file_public_ids and returns full detail', async () => {
    authPost.mockResolvedValueOnce({ data: detailBody })
    await addMembers(CID, ['qW3rT5yU7iO9pA1s', 'zX9cV8bN6mL4kJ2h'])
    expect(authPost).toHaveBeenCalledWith(`/collections/${CID}/members`, {
      file_public_ids: ['qW3rT5yU7iO9pA1s', 'zX9cV8bN6mL4kJ2h'],
    })
  })

  it('removeMembers sends file_public_ids in the DELETE body', async () => {
    authDelete.mockResolvedValueOnce({
      data: { public_id: CID, removed: ['qW3rT5yU7iO9pA1s'], skipped: ['zX9cV8bN6mL4kJ2h'] },
    })
    const r = await removeMembers(CID, ['qW3rT5yU7iO9pA1s', 'zX9cV8bN6mL4kJ2h'])
    expect(authDelete).toHaveBeenCalledWith(`/collections/${CID}/members`, {
      data: { file_public_ids: ['qW3rT5yU7iO9pA1s', 'zX9cV8bN6mL4kJ2h'] },
    })
    expect(r).toEqual({ publicId: CID, removed: ['qW3rT5yU7iO9pA1s'], skipped: ['zX9cV8bN6mL4kJ2h'] })
  })

  it('reorderMembers patches the full-rewrite order endpoint', async () => {
    authPatch.mockResolvedValueOnce({ data: detailBody })
    await reorderMembers(CID, ['qW3rT5yU7iO9pA1s', 'zX9cV8bN6mL4kJ2h', 'pL0kJ8hG6fD4sA2w'])
    expect(authPatch).toHaveBeenCalledWith(`/collections/${CID}/members/order`, {
      file_public_ids: ['qW3rT5yU7iO9pA1s', 'zX9cV8bN6mL4kJ2h', 'pL0kJ8hG6fD4sA2w'],
    })
  })

  it('getPublicCollection uses the no-auth client', async () => {
    // 公开页与认证详情同结构：对外只有 public_id（16 位 base62），无数字 id
    publicGet.mockResolvedValueOnce({ data: detailBody })
    const d = await getPublicCollection(CID)
    expect(publicGet).toHaveBeenCalledWith(`/collections/public/${CID}`)
    expect(authGet).not.toHaveBeenCalled()
    expect(d.publicId).toBe(CID)
    expect(d.memberCount).toBe(1)
  })

  it('wraps axios errors into CollectionApiError with status and backend detail', async () => {
    authDelete.mockRejectedValueOnce({
      response: { status: 409, data: { detail: 'invalid collection members' } },
      message: 'Request failed with status code 409',
    })
    const err = await deleteCollection(CID).catch((e) => e)
    expect(err.status).toBe(409)
    expect(err.backendMessage).toBe('invalid collection members')
    expect(err.message).toBe('invalid collection members')
  })
})

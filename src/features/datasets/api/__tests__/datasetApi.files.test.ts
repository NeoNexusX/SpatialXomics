import { beforeEach, describe, expect, it, vi } from 'vitest'

// datasetApi 只消费 httpClient 的方法调用，mock 掉即可断言请求形状
vi.mock('@/shared/api/httpClient', () => ({
  auth_api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

// getFileMetadata 按登录态选客户端（后端 metadata 一律要求登录）
const { getTokenMock } = vi.hoisted(() => ({ getTokenMock: vi.fn() }))

vi.mock('@/shared/auth/authStorage', () => ({
  authStorage: { getToken: getTokenMock },
}))

import { api, auth_api } from '@/shared/api/httpClient'
import {
  createProcess,
  deleteFile,
  getDownloadMetadata,
  getDownloadRaw,
  getDownloadRawNoauth,
  getFileMetadata,
  patchFileMetadata,
  rawConvertProcess,
  setFilePublic,
} from '../datasetApi'

const authGet = vi.mocked(auth_api.get)
const authPut = vi.mocked(auth_api.put)
const authPatch = vi.mocked(auth_api.patch)
const authDelete = vi.mocked(auth_api.delete)
const authPost = vi.mocked(auth_api.post)
const anonGet = vi.mocked(api.get)

const PID = 'aB3xK9mQ2rT7wY1z'

beforeEach(() => {
  for (const m of [authGet, authPut, authPatch, authDelete, authPost, anonGet]) m.mockReset()
  getTokenMock.mockReset()
})

// 文件域对外只用 16 位 public_id；数字 file_id 仅存在于旧分享链接的 legacy 分支
describe('datasetApi file paths (public_id)', () => {
  it('builds every auth path from the public id as-is', async () => {
    getTokenMock.mockReturnValue('token')
    authGet.mockResolvedValue({ data: {} })
    await getDownloadMetadata(PID)
    expect(authGet).toHaveBeenCalledWith(`/files/${PID}/download`)

    await getFileMetadata(PID)
    expect(authGet).toHaveBeenCalledWith(`/files/${PID}/metadata`)

    await getDownloadRaw(PID)
    expect(authGet).toHaveBeenCalledWith(`/files/${PID}/download_raw`)

    authPut.mockResolvedValue({ data: { public_id: PID } })
    await setFilePublic(PID)
    expect(authPut).toHaveBeenCalledWith(`/files/${PID}/set_public`)

    authDelete.mockResolvedValue({ data: { public_id: PID } })
    await deleteFile(PID)
    expect(authDelete).toHaveBeenCalledWith(`/files/${PID}`)

    authPatch.mockResolvedValue({ data: {} })
    await patchFileMetadata(PID, { organism: 'Mouse' })
    expect(authPatch).toHaveBeenCalledWith(`/files/${PID}`, { organism: 'Mouse' })
  })

  it('routes metadata by login state (backend requires auth for metadata)', async () => {
    // 已登录 → auth_api：metadata 一律要求登录态，登录用户任意可看
    getTokenMock.mockReturnValue('token')
    authGet.mockResolvedValue({ data: {} })
    await getFileMetadata(PID)
    expect(authGet).toHaveBeenCalledWith(`/files/${PID}/metadata`)

    // 匿名 → api + skipAuthRedirect：401 不触发全局跳登录，由页面就地引导
    getTokenMock.mockReturnValue(undefined)
    anonGet.mockResolvedValue({ data: {} })
    await getFileMetadata(PID)
    expect(anonGet).toHaveBeenCalledWith(`/files/${PID}/metadata`, { skipAuthRedirect: true })
    expect(authGet).toHaveBeenCalledTimes(1)
  })

  it('patches numeric and text metadata and returns the updated file body', async () => {
    const patch = { mz: 300.5, pixel_size_horizontal: 0, organism: '', analyzer: 'timsTOF fleX' }
    const updated = { public_id: PID, filename: 'brain.imzML', ...patch }
    authPatch.mockResolvedValue({ data: updated })

    expect(await patchFileMetadata(PID, patch)).toEqual(updated)
    expect(authPatch).toHaveBeenCalledWith(`/files/${PID}`, patch)
    expect(api.patch).not.toHaveBeenCalled()
  })

  it('switches to the anonymous client for public raw downloads', async () => {
    anonGet.mockResolvedValue({ data: {} })

    await getDownloadRaw(PID, true)
    expect(anonGet).toHaveBeenCalledWith(`/files/${PID}/download_raw`)

    await getDownloadRawNoauth(PID)
    expect(anonGet).toHaveBeenCalledWith(`/files/${PID}/download_raw_noauth`)
  })

  it('creates processes with file_public_id and no numeric conversion', async () => {
    authPost.mockResolvedValue({ data: {} })

    await createProcess({ file_public_id: PID, algorithms: { noise_reduction: {} } })
    expect(authPost).toHaveBeenCalledWith('/processes', {
      file_public_id: PID,
      algorithms: { noise_reduction: {} },
    })

    await rawConvertProcess(PID)
    expect(authPost).toHaveBeenCalledWith('/processes/raw-convert', { file_public_id: PID })
  })
})

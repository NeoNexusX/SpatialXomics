import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/httpClient', () => ({
  auth_api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const { getTokenMock } = vi.hoisted(() => ({ getTokenMock: vi.fn() }))

vi.mock('@/shared/auth/authStorage', () => ({
  authStorage: { getToken: getTokenMock },
}))

import { api, auth_api } from '@/shared/api/httpClient'
import { getShareOverviewMetadata } from '../overviewShareApi'

const anonGet = vi.mocked(api.get)
const authGet = vi.mocked(auth_api.get)

const PID = 'aB3xK9mQ2rT7wY1z'

beforeEach(() => {
  anonGet.mockReset()
  authGet.mockReset()
  getTokenMock.mockReset()
})

describe('getShareOverviewMetadata（分享内容需要登录态）', () => {
  it('fetches public-id links directly with the auth client', async () => {
    getTokenMock.mockReturnValue('token-1')
    authGet.mockResolvedValue({ data: {} })

    const result = await getShareOverviewMetadata(PID)

    expect(authGet).toHaveBeenCalledWith(`/files/${PID}/metadata`, {})
    expect(anonGet).not.toHaveBeenCalled()
    expect(result.metadata).toEqual({})
  })

  it('uses the anonymous client with skipAuthRedirect when signed out', async () => {
    getTokenMock.mockReturnValue(null)
    anonGet.mockResolvedValue({ data: {} })

    await getShareOverviewMetadata(PID)

    // skipAuthRedirect 挡掉全局 401 跳转，页面才能就地渲染登录/注册引导
    expect(anonGet).toHaveBeenCalledWith(
      `/files/${PID}/metadata`,
      expect.objectContaining({ skipAuthRedirect: true }),
    )
    expect(authGet).not.toHaveBeenCalled()
  })
})

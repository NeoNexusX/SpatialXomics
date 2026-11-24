import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/httpClient', () => ({
  auth_api: { get: vi.fn() },
}))

import { auth_api } from '@/shared/api/httpClient'
import { getZarrUrl } from '../zarrAccessApi'

const authGet = vi.mocked(auth_api.get)
const ROOT = 'https://gdn.example.com/processed/run_a1b2c3_45.zarr/'

describe('getZarrUrl', () => {
  beforeEach(() => {
    authGet.mockReset()
  })

  it('requests the run zarr endpoint and returns the root URL', async () => {
    authGet.mockResolvedValueOnce({ data: { zarr_url: ROOT } })

    await expect(getZarrUrl('45')).resolves.toBe(ROOT)
    expect(authGet).toHaveBeenCalledWith('/processes/45/zarr')
  })

  it('appends the trailing slash so object paths can be joined', async () => {
    authGet.mockResolvedValueOnce({ data: { zarr_url: ROOT.slice(0, -1) } })

    await expect(getZarrUrl('45')).resolves.toBe(ROOT)
  })

  it.each([
    ['missing', {}],
    [
      'relative (domain configured without a scheme)',
      { zarr_url: 'gdn.example.com/processed/run.zarr/' },
    ],
    ['plain http', { zarr_url: 'http://gdn.example.com/processed/run.zarr/' }],
  ])('rejects a %s zarr_url', async (_label, body) => {
    authGet.mockResolvedValueOnce({ data: body })

    await expect(getZarrUrl('45')).rejects.toThrow(/zarr_url/)
  })

  it('requires a run id', async () => {
    await expect(getZarrUrl('')).rejects.toThrow(/runId/)
    expect(authGet).not.toHaveBeenCalled()
  })
})

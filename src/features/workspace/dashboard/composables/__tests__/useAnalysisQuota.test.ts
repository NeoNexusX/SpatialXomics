import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }))

vi.mock('@/features/datasets/api/datasetApi', () => ({
  ANALYSIS_LIMIT: 5,
  countNonDirectProcesses: vi.fn(),
}))

vi.mock('@/shared/composables/useToast', () => ({
  useToast: () => ({ showToast }),
}))

vi.mock('@/i18n', () => ({ t: (key: string) => key }))

import { countNonDirectProcesses } from '@/features/datasets/api/datasetApi'
import { useAnalysisQuota } from '../useAnalysisQuota'

const countMock = vi.mocked(countNonDirectProcesses)

describe('useAnalysisQuota.check', () => {
  beforeEach(() => {
    countMock.mockReset()
    showToast.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('allows creating while the count is below the limit', async () => {
    countMock.mockResolvedValue(4)
    const quota = useAnalysisQuota()

    await expect(quota.check()).resolves.toBe(true)
    expect(quota.blockedCount.value).toBe(4)
    expect(quota.checking.value).toBe(false)
  })

  it('blocks creating at the limit', async () => {
    countMock.mockResolvedValue(5)
    const quota = useAnalysisQuota()

    await expect(quota.check()).resolves.toBe(false)
    expect(quota.blockedCount.value).toBe(5)
  })

  it('blocks and shows an error toast when the count request fails', async () => {
    countMock.mockRejectedValue(new Error('network down'))
    const quota = useAnalysisQuota()

    await expect(quota.check()).resolves.toBe(false)
    expect(console.error).toHaveBeenCalledWith('Failed to check analysis quota:', expect.any(Error))
    expect(showToast).toHaveBeenCalledWith('workspace.dashboard.analysisCheckFailed', 'error')
    expect(quota.checking.value).toBe(false)
  })
})

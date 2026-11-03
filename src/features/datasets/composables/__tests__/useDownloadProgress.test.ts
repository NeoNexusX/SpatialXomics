import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  ossDownloadRawMock,
  showToastMock,
  removeToastMock,
  extractBackendErrorMock,
  downloadStore,
  authStore,
} = vi.hoisted(() => ({
  ossDownloadRawMock: vi.fn(),
  showToastMock: vi.fn(() => 7),
  removeToastMock: vi.fn(),
  extractBackendErrorMock: vi.fn(() => 'backend error'),
  downloadStore: {
    downloading: false,
    canDownload: vi.fn(() => true),
    cooldownRemaining: vi.fn(() => 0),
    startDownload: vi.fn(),
    completeDownload: vi.fn(),
    failDownload: vi.fn(),
  },
  authStore: {
    token: null as string | null,
    user: null as Record<string, unknown> | null,
    fetchUser: vi.fn(),
  },
}))

vi.mock('@/features/datasets/utils/downloadHelper', () => ({
  ossDownloadRaw: ossDownloadRawMock,
}))

vi.mock('@/features/datasets/stores/downloadStore', () => ({
  useDownloadStore: () => downloadStore,
}))

vi.mock('@/shared/auth/authStore', () => ({
  useAuthStore: () => authStore,
}))

vi.mock('@/shared/composables/useToast', () => ({
  useToast: () => ({ showToast: showToastMock, removeToast: removeToastMock }),
}))

vi.mock('@/shared/api/httpClient', () => ({
  extractBackendError: extractBackendErrorMock,
}))

vi.mock('@/i18n', () => ({
  t: (key: string) => key,
}))

import { useDownloadProgress } from '../useDownloadProgress'

describe('useDownloadProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    downloadStore.downloading = false
    downloadStore.canDownload.mockReturnValue(true)
    authStore.token = null
    authStore.user = null
    authStore.fetchUser = vi.fn()
  })

  it('shows the localized download-limit message for a 403 response', async () => {
    ossDownloadRawMock.mockRejectedValueOnce({
      response: { status: 403, data: { detail: 'user download limit reached' } },
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { handleDownloadRaw, packingIds } = useDownloadProgress()

    await handleDownloadRaw('403-file')

    expect(downloadStore.failDownload).toHaveBeenCalledOnce()
    expect(removeToastMock).toHaveBeenCalledWith(7)
    expect(showToastMock).toHaveBeenLastCalledWith('datasets.download.limitReached', 'error')
    expect(extractBackendErrorMock).not.toHaveBeenCalled()
    expect(packingIds.has('403-file')).toBe(false)
    consoleError.mockRestore()
  })

  it('blocks the download with a warning toast when a required profile field is empty', async () => {
    authStore.token = 'tok'
    authStore.user = { institution: '', position: 'Professor', research_field: 'MS imaging', region: 'CN' }
    const { handleDownloadRaw, packingIds } = useDownloadProgress()

    await handleDownloadRaw('incomplete-profile-file')

    expect(authStore.fetchUser).toHaveBeenCalledOnce()
    expect(ossDownloadRawMock).not.toHaveBeenCalled()
    expect(downloadStore.startDownload).not.toHaveBeenCalled()
    expect(showToastMock).toHaveBeenLastCalledWith('datasets.download.profileIncomplete', 'warning')
    expect(packingIds.has('incomplete-profile-file')).toBe(false)
  })

  it('proceeds when every required profile field is filled', async () => {
    authStore.token = 'tok'
    authStore.user = { institution: 'EIT', position: 'Professor', research_field: 'MS imaging', region: 'CN' }
    ossDownloadRawMock.mockResolvedValueOnce(undefined)
    const { handleDownloadRaw } = useDownloadProgress()

    await handleDownloadRaw('complete-profile-file')

    expect(ossDownloadRawMock).toHaveBeenCalledWith('complete-profile-file', { isPublic: false })
    expect(downloadStore.completeDownload).toHaveBeenCalledOnce()
  })
})

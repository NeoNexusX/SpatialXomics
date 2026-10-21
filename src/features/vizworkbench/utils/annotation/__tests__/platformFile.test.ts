import { afterEach, describe, expect, it, vi } from 'vitest'
import { pickSaveHandle, supportsFileHandles } from '../platformFile'

afterEach(() => vi.unstubAllGlobals())

describe('pickSaveHandle', () => {
  it('opens the save dialog in the Downloads folder by default', async () => {
    const handle = {} as FileSystemFileHandle
    const picker = vi.fn(async () => handle)
    vi.stubGlobal('showSaveFilePicker', picker)

    await expect(pickSaveHandle('SI_DB.csv')).resolves.toBe(handle)
    expect(picker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'SI_DB.csv', startIn: 'downloads' }),
    )
  })

  it('retries without startIn when the browser rejects the well-known directory', async () => {
    const handle = {} as FileSystemFileHandle
    const picker = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('invalid startIn'))
      .mockResolvedValueOnce(handle)
    vi.stubGlobal('showSaveFilePicker', picker)

    await expect(pickSaveHandle('SI_DB.csv')).resolves.toBe(handle)
    expect(picker).toHaveBeenCalledTimes(2)
    // 重试时不带 startIn（老 Chromium 只认这个组合）
    expect(picker.mock.calls[1]![0]).not.toHaveProperty('startIn')
  })

  it('returns null when the user cancels, without retrying', async () => {
    const picker = vi.fn(async () => {
      throw new DOMException('cancelled', 'AbortError')
    })
    vi.stubGlobal('showSaveFilePicker', picker)

    await expect(pickSaveHandle('SI_DB.csv')).resolves.toBeNull()
    expect(picker).toHaveBeenCalledTimes(1)
  })

  it('treats a plain object AbortError as cancel too', async () => {
    const cancel = Object.assign(new Error('cancel'), { name: 'AbortError' })
    vi.stubGlobal(
      'showSaveFilePicker',
      vi.fn(async () => {
        throw cancel
      }),
    )

    await expect(pickSaveHandle('SI_DB.csv')).resolves.toBeNull()
  })

  it('returns null without calling the picker when the API is missing', async () => {
    expect(supportsFileHandles()).toBe(false)
    await expect(pickSaveHandle('SI_DB.csv')).resolves.toBeNull()
  })
})

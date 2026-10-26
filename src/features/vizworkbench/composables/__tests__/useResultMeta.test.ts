import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { useResultMeta } from '../useResultMeta'
import { metadataAttrsRef, polarityRef } from '@/services/zarr/zarrSharedState'
import type { MetadataAttrs } from '@/services/zarr/types/zarr'

const api = vi.hoisted(() => ({
  getFileMetadata: vi.fn(),
  listMyProcesses: vi.fn(),
}))

vi.mock('@/features/datasets/api/datasetApi', () => api)

// 真实的 useZarrIonImage 会拉起整套 zarr store；这里只需要它转出的共享 ref
vi.mock('@/features/vizworkbench/composables/useZarrIonImage', async () => {
  const shared = await import('@/services/zarr/zarrSharedState')
  return {
    metadataAttrsRef: shared.metadataAttrsRef,
    dataModeRef: shared.dataModeRef,
    polarityRef: shared.polarityRef,
  }
})

const FILE_ID = 'AbCdEfGh12345678'

/** GET /files/{public_id}/metadata 的响应（后端 snake_case 原样） */
function fileRecord(over: Record<string, unknown> = {}) {
  return {
    public_id: FILE_ID,
    filename: 'mouse_brain.imzML',
    polarity: 'Positive',
    ionisation_source: 'MALDI',
    analyzer: 'timsTOF fleX',
    pixel_size_horizontal: 20,
    pixel_size_vertical: 20,
    spectrum_mode: 'profile',
    storage_mode: 'processed',
    maldi_matrix: 'DHB',
    organism: 'Mouse (Mus musculus)',
    ...over,
  }
}

/** 工作区列表入口携带的完整 state */
function workspaceState(over: Record<string, unknown> = {}) {
  return {
    runId: '7',
    datasetName: 'mouse_brain',
    status: 'completed',
    methods: ['Peak Picking'],
    filePublicId: FILE_ID,
    ...over,
  }
}

function mountMeta(id = '7') {
  let meta!: ReturnType<typeof useResultMeta>
  const wrapper = mount(
    defineComponent({
      setup() {
        meta = useResultMeta(ref(id))
        return () => null
      },
    }),
  )
  return { meta, wrapper }
}

beforeEach(() => {
  api.getFileMetadata.mockReset()
  api.listMyProcesses.mockReset()
  api.listMyProcesses.mockResolvedValue({ data: [] })
  metadataAttrsRef.value = null
  polarityRef.value = ''
  history.replaceState(workspaceState(), '')
})

describe('useResultMeta source file metadata', () => {
  it('reads the full file record by the filePublicId the entry passed', async () => {
    api.getFileMetadata.mockResolvedValue(fileRecord())
    const { meta } = mountMeta()
    await flushPromises()

    expect(api.getFileMetadata).toHaveBeenCalledWith(FILE_ID)
    // state 已带齐名称 / 状态 / methods：不再回查处理记录
    expect(api.listMyProcesses).not.toHaveBeenCalled()
    expect(meta.sourceFile.value?.maldiMatrix).toBe('DHB')
    expect(meta.sourceFile.value?.organism).toBe('Mouse (Mus musculus)')
    expect(meta.acquisition.value.polarity).toBe('Positive')
    expect(meta.acquisition.value.ionSource).toBe('MALDI')
    expect(meta.pixelSizeUm.value).toEqual({ x: 20, y: 20 })
  })

  it('loads metadata for a run outside my process list (public data, old runs)', async () => {
    // Explore 入口不带 status；别人的 run 不在「我的处理记录」里
    history.replaceState(workspaceState({ status: undefined }), '')
    api.getFileMetadata.mockResolvedValue(fileRecord())
    const { meta } = mountMeta()
    await flushPromises()

    expect(api.listMyProcesses).toHaveBeenCalledTimes(1)
    expect(meta.status.value).toBe('')
    expect(meta.sourceFile.value?.maldiMatrix).toBe('DHB')
    expect(meta.acquisition.value.polarity).toBe('Positive')
  })

  it.each([
    ['before', true],
    ['after', false],
  ])('keeps zarr attrs ahead of the file record when zarr loads %s it', async (_, zarrFirst) => {
    const attrs = { polarity: 'negative', analyzer: 'Orbitrap' } as MetadataAttrs
    api.getFileMetadata.mockResolvedValue(fileRecord())
    if (zarrFirst) metadataAttrsRef.value = attrs
    const { meta } = mountMeta()
    if (!zarrFirst) {
      await flushPromises()
      metadataAttrsRef.value = attrs
    }
    await flushPromises()

    expect(meta.acquisition.value.polarity).toBe('negative')
    expect(meta.acquisition.value.analyzer).toBe('Orbitrap')
    // zarr 没有的字段由文件记录补齐
    expect(meta.acquisition.value.ionSource).toBe('MALDI')
  })

  it('keeps the Peak Picking adjustment when zarr attrs arrive last', async () => {
    api.getFileMetadata.mockResolvedValue(fileRecord({ spectrum_mode: 'profile' }))
    const { meta } = mountMeta()
    await flushPromises()
    expect(meta.spectrumMode.value).toBe('centroid')

    metadataAttrsRef.value = { profile_spectrum: true } as MetadataAttrs
    await flushPromises()
    expect(meta.spectrumMode.value).toBe('centroid')
  })

  it('falls back to zarr-only metadata when the source file is gone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    api.getFileMetadata.mockRejectedValue(
      Object.assign(new Error('Not Found'), { response: { status: 404 } }),
    )
    metadataAttrsRef.value = { polarity: 'positive' } as MetadataAttrs
    const { meta } = mountMeta()
    await flushPromises()

    expect(meta.sourceFile.value).toBeNull()
    expect(meta.acquisition.value.polarity).toBe('positive')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('drops a file record that arrives after unmount', async () => {
    let resolve!: (v: unknown) => void
    api.getFileMetadata.mockReturnValue(new Promise((r) => (resolve = r)))
    const { meta, wrapper } = mountMeta()
    wrapper.unmount()
    resolve(fileRecord())
    await flushPromises()

    expect(meta.sourceFile.value).toBeNull()
    // polarityRef 是模块级共享状态，迟到的响应不能写进去
    expect(polarityRef.value).toBe('')
  })
})

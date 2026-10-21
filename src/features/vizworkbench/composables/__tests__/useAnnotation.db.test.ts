import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createApp, ref } from 'vue'
import { useAnnotation } from '../useAnnotation'
import type { Acquisition } from '@/features/vizworkbench/types/acquisition'
import {
  installFakeAnnotationWorker,
  type FakeWorkerHarness,
} from '../../utils/annotation/__tests__/fakeAnnotationWorker'

const fake = vi.hoisted(() => ({ harness: null as FakeWorkerHarness | null }))
const stored = vi.hoisted(() => ({ resolve: (_value: unknown) => {} }))

vi.mock('../useZarrIonImage', async () => {
  const { ref } = await import('vue')
  return {
    dataModeRef: ref('continuous'),
    meanSpectrumRef: ref(null),
    mzAxisRef: ref(null),
    spectrumError: ref(null),
  }
})
vi.mock('../useAnnotationSpatial', () => ({
  useAnnotationSpatial: () => ({ start: vi.fn(), cancel: vi.fn(), bump: vi.fn() }),
}))
vi.mock('../../utils/annotation/engineClient', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../utils/annotation/engineClient')>()
  return {
    ...mod,
    createEngineClient: (handlers: Parameters<typeof mod.createEngineClient>[0]) =>
      mod.createEngineClient(handlers, () => fake.harness!.spawn()),
  }
})
vi.mock('../../utils/annotation/dbStore', () => ({
  loadStoredDb: () => new Promise((resolve) => (stored.resolve = resolve)),
  saveStoredDb: vi.fn(async () => {}),
  clearStoredDb: vi.fn(async () => {}),
}))
vi.mock('@/features/assistant/providers/analysisContext', () => ({
  registerContextProviders: vi.fn(),
  unregisterContextProviders: vi.fn(),
}))

import { saveStoredDb } from '../../utils/annotation/dbStore'

const acquisition: Acquisition = {
  polarity: 'negative',
  ionSource: 'MALDI',
  analyzer: 'Orbitrap',
  resolvingPower: '',
  resolvingPowerMz: '',
  maldiMatrix: '',
  maldiMatrixApplication: '',
  solvent: '',
  spectrumMode: 'centroid',
  storageMode: 'continuous',
}

const STORED_CSV = 'ID,Name,Formula\nS1,Sorbitol,C6H14O6\nS2,Ribose,C5H10O5'
const IMPORTED_CSV = 'ID,Name,Formula\nA1,Glucose,C6H12O6'

/** jsdom 的 File 没有 arrayBuffer()；导入只用到文件名和内容 */
function csvFile(name: string, text: string): File {
  const bytes = new TextEncoder().encode(text)
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return { name, arrayBuffer: async () => buffer } as unknown as File
}

function setupAnnotation() {
  let ann!: ReturnType<typeof useAnnotation>
  const app = createApp({
    setup() {
      ann = useAnnotation({
        runId: ref('db-test'),
        acquisition: ref(acquisition),
        selectedMzIndex: ref(-1),
        selectMzIndex: vi.fn(),
      })
      return () => null
    },
  })
  app.mount(document.createElement('div'))
  return { ann, app }
}

/** 交替推进主线程的异步步骤和 worker 的消息，直到都处理完 */
async function drain() {
  for (let i = 0; i < 10; i++) {
    await flushPromises()
    fake.harness!.deliver()
  }
}

beforeEach(async () => {
  fake.harness = await installFakeAnnotationWorker()
})

afterEach(() => vi.unstubAllGlobals())

describe('annotation database loading (worker)', () => {
  it('applies a file imported during the restore after the restored one, in the worker too', async () => {
    const { ann, app } = setupAnnotation()
    const importing = ann.importDbFile(csvFile('imported.csv', IMPORTED_CSV))
    // 不排队的话，导入此时已经把 imported.csv 发给 worker，恢复的库反而后到
    await flushPromises()
    stored.resolve({ fileName: 'stored.csv', text: STORED_CSV })
    await drain()
    await importing

    expect(ann.db.value).toEqual({ label: 'imported.csv', count: 1 })
    expect(ann.dbState.value).toBe('ready')
    // worker 里最后换上的库就是界面上的库
    expect(fake.harness!.dbFiles).toEqual(['stored.csv', 'imported.csv'])
    app.unmount()
  })

  it('discards a restore that finishes after the database was cleared', async () => {
    const { ann, app } = setupAnnotation()
    await flushPromises()
    stored.resolve({ fileName: 'stored.csv', text: STORED_CSV })
    await flushPromises()
    ann.clearDb()
    await drain()

    expect(fake.harness!.dbFiles).toEqual(['stored.csv'])
    expect(ann.db.value).toBeNull()
    expect(ann.dbState.value).toBe('idle')
    app.unmount()
  })

  it('imports a platform database csv end-to-end, reports progress and remembers it', async () => {
    const { ann, app } = setupAnnotation()
    await flushPromises()
    stored.resolve(null)
    await drain()
    vi.mocked(saveStoredDb).mockClear()

    let seenTotal = 0
    const importing = ann.importPlatformDb(
      {
        fetch: async (onProgress) => {
          onProgress?.(11, 22)
          onProgress?.(22, 22)
          seenTotal = 22
          return { fileName: 'SI_DB.csv', text: IMPORTED_CSV }
        },
      },
      'HMDB 4.0 代谢物',
    )
    // 下载阶段的进度进了状态；解析换库在 worker 里排队执行
    await drain()
    await importing

    // 库标签用传入的库名，取代后端文件名 SI_DB.csv
    expect(ann.db.value).toEqual({ label: 'HMDB 4.0 代谢物', count: 1 })
    expect(ann.dbState.value).toBe('ready')
    expect(fake.harness!.dbFiles).toEqual(['HMDB 4.0 代谢物'])
    expect(vi.mocked(saveStoredDb)).toHaveBeenCalledWith({
      fileName: 'HMDB 4.0 代谢物',
      text: IMPORTED_CSV,
    })
    expect(seenTotal).toBe(22)
    // 导入结束后进度清空、导入态复位
    expect(ann.platformFetch.value).toBeNull()
    expect(ann.importingDb.value).toBe(false)
    expect(ann.importingKind.value).toBeNull()
    app.unmount()
  })

  it('falls back to the fetched filename as the db label when the label is blank', async () => {
    const { ann, app } = setupAnnotation()
    await flushPromises()
    stored.resolve(null)
    await drain()

    const importing = ann.importPlatformDb(
      { fetch: async () => ({ fileName: 'SI_DB.csv', text: IMPORTED_CSV }) },
      '  ',
    )
    await drain()
    await importing

    expect(ann.db.value).toEqual({ label: 'SI_DB.csv', count: 1 })
    app.unmount()
  })

  it('shows the localized failure toast and keeps the previous db when the platform fetch fails', async () => {
    const { ann, app } = setupAnnotation()
    await flushPromises()
    stored.resolve({ fileName: 'stored.csv', text: STORED_CSV })
    await drain()
    vi.mocked(saveStoredDb).mockClear()

    const importing = ann.importPlatformDb(
      {
        fetch: async () => {
          throw new Error('HTTP 502')
        },
      },
      'HMDB 4.0 代谢物',
    )
    await drain()
    await importing

    // 失败不动已有库：恢复的 stored.csv 仍在
    expect(ann.db.value).toEqual({ label: 'stored.csv', count: 2 })
    expect(ann.dbState.value).toBe('ready')
    expect(vi.mocked(saveStoredDb)).not.toHaveBeenCalled()
    expect(ann.importingDb.value).toBe(false)
    app.unmount()
  })
})

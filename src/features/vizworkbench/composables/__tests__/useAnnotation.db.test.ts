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
})

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, provide, ref } from 'vue'
import { ANNOTATION_KEY, useAnnotation, type AnnotationController } from '../useAnnotation'
import AnnotationConditions from '../../components/annotation/AnnotationConditions.vue'
import type { Acquisition } from '../../types/acquisition'
import type { AnnotationResult } from '../../types/annotation'
import type { EngineHandlers } from '../../utils/annotation/engineClient'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'
import { STORAGE_KEYS } from '@/shared/config/storageKeys'

const engineRun = vi.hoisted(() => vi.fn())
const engineHandlers = vi.hoisted(() => ({ current: null as EngineHandlers | null }))

vi.mock('../useZarrIonImage', async () => {
  const { ref } = await import('vue')
  return {
    dataModeRef: ref('continuous'),
    meanSpectrumRef: ref(new Float32Array([1])),
    mzAxisRef: ref(new Float64Array([181.071762])),
    spectrumError: ref(null),
  }
})
vi.mock('../useAnnotationSpatial', () => ({
  useAnnotationSpatial: () => ({ start: vi.fn(), cancel: vi.fn(), bump: vi.fn() }),
}))
vi.mock('../../utils/annotation/engineClient', () => ({
  createEngineClient: (handlers: EngineHandlers) => {
    engineHandlers.current = handlers
    return {
      run: engineRun,
      dispose: vi.fn(),
      loadDb: async (label: string) => ({ label, count: 1 }),
    }
  },
}))
vi.mock('../../utils/annotation/dbStore', () => ({
  loadStoredDb: async () => ({
    fileName: 'user-db.csv',
    text: 'ID,Name,Formula\nTEST0001,L-Iditol,C6H14O6',
  }),
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

let wrappers: VueWrapper[] = []

function setupAnnotation(id = 'spatial-pct-test') {
  let ann!: AnnotationController
  const runId = ref(id)
  const wrapper = mount(
    defineComponent({
      setup() {
        ann = useAnnotation({
          runId,
          acquisition: ref(acquisition),
          selectedMzIndex: ref(-1),
          selectMzIndex: vi.fn(),
        })
        provide(ANNOTATION_KEY, ann)
        return () => h(AnnotationConditions)
      },
    }),
    { global: { plugins: [i18n], stubs: { SvgIcon: true } } },
  )
  wrappers.push(wrapper)
  return { ann, wrapper, runId }
}

beforeAll(async () => {
  i18n.global.locale.value = 'en'
  await loadCoreMessages('en')
  await loadFeatureMessages('vizworkbench')
})

beforeEach(() => {
  localStorage.clear()
  engineRun.mockClear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers = []
  vi.useRealTimers()
})

describe('annotation spatial calculation setting', () => {
  it('waits for a click at 100% and after percentage changes or clearing', async () => {
    const { wrapper } = setupAnnotation()
    await flushPromises()
    const input = wrapper.get('input[aria-label="Spatial scoring"]')
    expect((input.element as HTMLInputElement).value).toBe('100')
    await vi.advanceTimersByTimeAsync(150)
    expect(engineRun).not.toHaveBeenCalled()
    await wrapper.get('button[aria-label="Start annotation"]').trigger('click')
    await vi.advanceTimersByTimeAsync(150)
    expect(engineRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ spatialPct: 100 }) }),
    )

    await input.setValue('20.5')
    await vi.advanceTimersByTimeAsync(150)
    expect(engineRun).toHaveBeenCalledTimes(1)
    await wrapper.get('button[aria-label="Start annotation"]').trigger('click')
    expect(engineRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ spatialPct: 20.5 }) }),
    )

    await input.setValue('')
    await vi.advanceTimersByTimeAsync(150)
    expect(engineRun).toHaveBeenCalledTimes(2)
    await wrapper.get('button[aria-label="Start annotation"]').trigger('click')
    expect(engineRun).toHaveBeenCalledTimes(3)
    expect(engineRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ spatialPct: 100 }) }),
    )
  })

  it('remembers the percentage per result page and can reset it with the button', async () => {
    const first = setupAnnotation()
    await flushPromises()
    await first.wrapper.get('input[aria-label="Spatial scoring"]').setValue('80')
    first.ann.start()
    await vi.advanceTimersByTimeAsync(150)
    first.wrapper.unmount()
    wrappers = []

    engineRun.mockClear()
    const { wrapper, runId } = setupAnnotation()
    await flushPromises()
    const input = wrapper.get('input[aria-label="Spatial scoring"]')
    expect((input.element as HTMLInputElement).value).toBe('80')
    await wrapper.get('button[title="Score all matches"]').trigger('click')
    await vi.advanceTimersByTimeAsync(150)
    expect((input.element as HTMLInputElement).value).toBe('100')
    expect(engineRun).not.toHaveBeenCalled()
    await wrapper.get('button[aria-label="Start annotation"]').trigger('click')
    expect(engineRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ spatialPct: 100 }) }),
    )
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEYS.annotationSettings + runId.value)!),
    ).toMatchObject({ spatialPct: 100 })

    runId.value = 'another-result'
    await flushPromises()
    expect((input.element as HTMLInputElement).value).toBe('100')
    expect(engineRun).toHaveBeenCalledTimes(1)
  })

  it.each(['-1', '100.1', '20.55'])(
    'rejects invalid percentage %s without starting another run',
    async (value) => {
      const { ann, wrapper } = setupAnnotation()
      await flushPromises()
      const input = wrapper.get('input[aria-label="Spatial scoring"]')
      await input.setValue('30')
      ann.start()
      await vi.advanceTimersByTimeAsync(150)
      engineRun.mockClear()
      await input.setValue(value)
      await vi.advanceTimersByTimeAsync(150)
      expect((input.element as HTMLInputElement).value).toBe('30')
      expect(engineRun).not.toHaveBeenCalled()
    },
  )

  it('passes 0% to the engine to disable spatial scoring', async () => {
    const { ann, wrapper } = setupAnnotation()
    await flushPromises()
    await wrapper.get('input[aria-label="Spatial scoring"]').setValue('0')
    ann.start()
    await vi.advanceTimersByTimeAsync(150)
    expect(engineRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ spatialPct: 0 }) }),
    )
  })

  it('restores all for settings saved before the input existed', async () => {
    localStorage.setItem(
      STORAGE_KEYS.annotationSettings + 'spatial-pct-test',
      JSON.stringify({
        started: true,
        tolValue: null,
        tolUnit: 'ppm',
        overrides: {},
        polarity: null,
        spatialLimit: 80,
      }),
    )
    const { wrapper } = setupAnnotation()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(150)
    expect(
      (wrapper.get('input[aria-label="Spatial scoring"]').element as HTMLInputElement).value,
    ).toBe('100')
    expect(engineRun).not.toHaveBeenCalled()
    await wrapper.get('button[aria-label="Start annotation"]').trigger('click')
    expect(engineRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ spatialPct: 100 }) }),
    )
  })

  it('ignores repeated clicks while the current matching request is running', async () => {
    const { ann, wrapper } = setupAnnotation()
    await flushPromises()
    await wrapper.get('button[aria-label="Start annotation"]').trigger('click')
    expect(
      wrapper.get('button[aria-label="Start annotation"]').attributes('disabled'),
    ).toBeDefined()
    ann.start()
    expect(engineRun).toHaveBeenCalledTimes(1)
  })

  it('discards a late response after conditions change and waits for another click', async () => {
    const { ann, wrapper } = setupAnnotation()
    await flushPromises()
    await wrapper.get('button[aria-label="Start annotation"]').trigger('click')
    const firstKey = engineRun.mock.calls[0]![0].runKey as number
    const result: AnnotationResult = {
      ions: [],
      molecules: [],
      jobs: [],
      summary: {
        peaks: 1,
        ions: 0,
        molecules: 0,
        qCounts: { q05: 0, q10: 0, q20: 0 },
        decoy: { replicates: 10, ions: 0 },
        spatial: { total: 0, done: 0 },
        timingMs: 0,
      },
    }
    await wrapper.get('input[aria-label="Spatial scoring"]').setValue('20')
    engineHandlers.current!.onResult(firstKey, result)
    await vi.advanceTimersByTimeAsync(500)
    expect(ann.summary.value).toBeNull()
    expect(ann.runState.value).toBe('idle')
    expect(engineRun).toHaveBeenCalledTimes(1)

    await wrapper.get('button[aria-label="Start annotation"]').trigger('click')
    const secondKey = engineRun.mock.calls[1]![0].runKey as number
    expect(secondKey).not.toBe(firstKey)
    engineHandlers.current!.onResult(secondKey, result)
    expect(ann.runState.value).toBe('done')
    expect(ann.summary.value).toEqual(result.summary)
  })
})

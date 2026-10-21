import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, ref } from 'vue'
import { useAnnotation } from '../useAnnotation'
import type { Acquisition } from '@/features/vizworkbench/types/acquisition'
import type { AdductId, IonAnnotation } from '@/features/vizworkbench/types/annotation'

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
vi.mock('../../utils/annotation/engineClient', () => ({
  createEngineClient: () => ({ dispose: vi.fn(), loadDb: vi.fn() }),
}))
vi.mock('../../utils/annotation/dbStore', () => ({ loadStoredDb: async () => null }))
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

function ion(id: number, adduct: AdductId): IonAnnotation {
  return {
    id,
    adduct,
    moleculeId: id,
    fit: 1,
    peak: id,
    axisIndex: id,
    theoMz: 100 + id,
    obsMz: 100 + id,
    intensity: 1,
    errPpm: 0,
    samePeak: [],
    rank: id,
    q: 0.01,
    scores: {
      mass: 1,
      adduct: 1,
      spatial: null,
      spatialState: 'na',
      chaos: null,
      coloc: null,
      total: 0.7,
    },
  }
}

function setupAnnotation() {
  let ann!: ReturnType<typeof useAnnotation>
  const app = createApp({
    setup() {
      ann = useAnnotation({
        runId: ref('filter-test'),
        acquisition: ref(acquisition),
        selectedMzIndex: ref(-1),
        selectMzIndex: vi.fn(),
      })
      return () => null
    },
  })
  app.mount(document.createElement('div'))
  ann.ions.value = [ion(1, 'M-H'), ion(2, 'M+Cl'), ion(3, 'M+HCOO')]
  return { ann, app }
}

beforeEach(() => localStorage.clear())

describe('annotation adduct filters', () => {
  it('shows the union of selected adducts and restores all rows when cleared', () => {
    const { ann, app } = setupAnnotation()
    expect(ann.rows.value.map((row) => row.id)).toEqual([1, 2, 3])
    ann.adductFilter.value = ['M-H', 'M+Cl']
    expect(ann.rows.value.map((row) => row.id)).toEqual([1, 2])
    ann.adductFilter.value = ['M+Cl']
    expect(ann.rows.value.map((row) => row.id)).toEqual([2])
    ann.adductFilter.value = []
    expect(ann.rows.value.map((row) => row.id)).toEqual([1, 2, 3])
    app.unmount()
  })

  it('clears every selected adduct when revealing a hidden jump target', () => {
    const { ann, app } = setupAnnotation()
    ann.adductFilter.value = ['M-H', 'M+Cl']
    ann.jumpToIon(3)
    expect(ann.hiddenJumpId.value).toBe(3)
    ann.revealHiddenJump()
    expect(ann.adductFilter.value).toEqual([])
    expect(ann.rows.value.map((row) => row.id)).toEqual([1, 2, 3])
    expect(ann.scrollRequest.value?.id).toBe(3)
    app.unmount()
  })
})

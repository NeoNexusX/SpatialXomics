import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed, nextTick, ref } from 'vue'
import AnnotationDetailCard from '../AnnotationDetailCard.vue'
import {
  ANNOTATION_KEY,
  type AnnotationController,
} from '@/features/vizworkbench/composables/useAnnotation'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'
import type { IonAnnotation, Molecule } from '@/features/vizworkbench/types/annotation'

beforeAll(async () => {
  await loadCoreMessages('en')
  await loadFeatureMessages('vizworkbench')
})

function mountCard(correlation: number | null | undefined) {
  const ion: IonAnnotation = {
    id: 1,
    moleculeId: 1,
    adduct: 'M-H',
    fit: 1,
    peak: 0,
    axisIndex: 0,
    theoMz: 181.071762,
    obsMz: 181.071835,
    intensity: 1,
    errPpm: 0.403,
    samePeak: [],
    scores: {
      mass: 1,
      adduct: 1,
      chaos: 0.9,
      coloc: null,
      spatial: 0.18,
      spatialState: 'done',
      total: 0.836,
    },
    q: 0.067,
    rank: 1,
  }
  const sibling: IonAnnotation = {
    ...ion,
    id: 2,
    axisIndex: 1,
    adduct: 'M+Cl',
    obsMz: 217.047971,
  }
  const molecule: Molecule = {
    id: 1,
    formula: 'C6H14O6',
    neutralMass: 182.079038,
    candidates: [{ id: 'TEST0001', name: 'L-Iditol', inchi: '' }],
    ionIds: [ion.id, sibling.id],
    missing: [],
  }
  const pairR = ref(correlation)
  const context: Pick<
    AnnotationController,
    'molecules' | 'ionById' | 'pairRFor' | 'computePairOnDemand' | 'moleculeFilter'
  > = {
    molecules: ref(new Map([[molecule.id, molecule]])),
    ionById: computed(() => new Map([ion, sibling].map((entry) => [entry.id, entry]))),
    pairRFor: () => pairR.value,
    computePairOnDemand: vi.fn<AnnotationController['computePairOnDemand']>().mockResolvedValue(),
    moleculeFilter: ref<number | null>(null),
  }
  const wrapper = mount(AnnotationDetailCard, {
    props: { ion, pinned: false },
    global: {
      plugins: [i18n],
      provide: { [ANNOTATION_KEY as symbol]: context },
      stubs: { SvgIcon: true },
    },
  })
  return { wrapper, pairR, context }
}

describe('AnnotationDetailCard sibling correlations', () => {
  it.each([-0.4, 0, 0.05, 0.099999])('hides sibling rows with correlation %s', (r) => {
    const { wrapper } = mountCard(r)
    expect(wrapper.text()).not.toContain('217.047971')
    expect(wrapper.text()).not.toContain('Same-molecule ions')
    expect(wrapper.find('button[aria-label="Show only this molecule"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it.each([0.1, 0.100001, 0.74])('shows sibling rows with correlation %s', (r) => {
    const { wrapper } = mountCard(r)
    expect(wrapper.text()).toContain('217.047971')
    expect(wrapper.text()).toContain('Same-molecule ions')
    wrapper.unmount()
  })

  it('keeps visible sibling rows interactive', async () => {
    const { wrapper, context } = mountCard(0.74)
    const jump = wrapper
      .findAll('button')
      .find(
        (button) => button.attributes('title') === i18n.global.t('vizworkbench.annotation.jump'),
      )!
    await jump.trigger('click')
    expect(wrapper.emitted('jump')).toEqual([[2]])
    await wrapper.get('button[aria-label="Show only this molecule"]').trigger('click')
    expect(context.moleculeFilter.value).toBe(1)
    wrapper.unmount()
  })

  it('computes pending pairs and updates visibility when the correlation arrives', async () => {
    const { wrapper, pairR, context } = mountCard(undefined)
    expect(context.computePairOnDemand).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('217.047971')
    pairR.value = 0.05
    await nextTick()
    expect(wrapper.text()).not.toContain('217.047971')
    expect(wrapper.text()).not.toContain('Same-molecule ions')
    pairR.value = 0.74
    await nextTick()
    expect(wrapper.text()).toContain('217.047971')
    wrapper.unmount()
  })
})

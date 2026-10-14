import { beforeAll, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AnnotationScoreBreakdown from '../AnnotationScoreBreakdown.vue'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'
import type {
  IonAnnotation,
  IonScores,
  ScoreWeights,
} from '@/features/vizworkbench/types/annotation'

beforeAll(async () => {
  await loadCoreMessages('en')
  await loadFeatureMessages('vizworkbench')
})

function mountBreakdown(scores: Partial<IonScores> = {}, weights?: ScoreWeights) {
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
      coloc: 0.75,
      spatial: 0.78,
      spatialState: 'done',
      total: 0.956,
      ...scores,
    },
    q: 0.067,
    rank: 1,
  }
  return mount(AnnotationScoreBreakdown, {
    props: { ion, weights },
    global: { plugins: [i18n] },
  })
}

function cells(wrapper: ReturnType<typeof mountBreakdown>, label: string): string[] {
  const row = wrapper.findAll('tbody tr').find((row) => row.find('td').text() === label)!
  return row.findAll('td').map((cell) => cell.text())
}

describe('AnnotationScoreBreakdown', () => {
  it('lists scores and contributions, including the two spatial components', () => {
    const wrapper = mountBreakdown()
    expect(cells(wrapper, 'Mass')).toEqual(['Mass', '1.000', '60%', '0.600'])
    expect(cells(wrapper, 'Adduct fit')).toEqual(['Adduct fit', '1.000', '10%', '0.100'])
    expect(cells(wrapper, 'Spatial')).toEqual(['Spatial', '0.780', '30%', '0.234'])
    expect(cells(wrapper, 'chaos')).toEqual(['chaos', '0.900', '6%', '0.054'])
    expect(cells(wrapper, 'Co-loc')).toEqual(['Co-loc', '0.750', '24%', '0.180'])
    expect(wrapper.find('tfoot').text()).toContain('0.956')
    expect(wrapper.find('details').exists()).toBe(false)
    expect(wrapper.findAll('p')).toHaveLength(0)
    wrapper.unmount()
  })

  it.each(['na', 'queued', 'error'] as const)('counts %s spatial evidence as zero', (state) => {
    const wrapper = mountBreakdown({
      chaos: null,
      coloc: null,
      spatial: null,
      spatialState: state,
      total: 0.8,
    })
    expect(cells(wrapper, 'Spatial')).toEqual(['Spatial', '0.000', '30%', '0.000'])
    expect(cells(wrapper, 'chaos')).toEqual(['chaos', '–', '6%', '–'])
    expect(cells(wrapper, 'Co-loc')).toEqual(['Co-loc', '–', '24%', '–'])
    expect(wrapper.find('tfoot').text()).toContain('0.800')
    expect(wrapper.text()).not.toContain('0.150*')
    wrapper.unmount()
  })

  it('distinguishes absent co-localization from an uncomputed spatial score', () => {
    const wrapper = mountBreakdown({ coloc: null, spatial: 0.18, total: 0.836 })
    expect(cells(wrapper, 'Spatial')).toEqual(['Spatial', '0.180', '30%', '0.054'])
    expect(cells(wrapper, 'Co-loc')).toEqual(['Co-loc', '0.000', '24%', '0.000'])
    wrapper.unmount()
  })

  it.each([-0.4, 0.05, 0.1])('shows correlation %s as zero co-localization contribution', (r) => {
    const wrapper = mountBreakdown({ coloc: r, spatial: 0.18, total: 0.836 })
    expect(cells(wrapper, 'Co-loc')).toEqual(['Co-loc', '0.000', '24%', '0.000'])
    expect(cells(wrapper, 'chaos')).toEqual(['chaos', '0.900', '6%', '0.054'])
    wrapper.unmount()
  })

  it('uses the weights of the current run', () => {
    const wrapper = mountBreakdown({}, { mass: 0.45, adduct: 0.15, spatial: 0.4 })
    expect(cells(wrapper, 'Mass')).toEqual(['Mass', '1.000', '45%', '0.450'])
    expect(cells(wrapper, 'Adduct fit')).toEqual(['Adduct fit', '1.000', '15%', '0.150'])
    expect(cells(wrapper, 'Spatial')).toEqual(['Spatial', '0.780', '40%', '0.312'])
    expect(cells(wrapper, 'chaos')).toEqual(['chaos', '0.900', '8%', '0.072'])
    expect(cells(wrapper, 'Co-loc')).toEqual(['Co-loc', '0.750', '32%', '0.240'])
    wrapper.unmount()
  })

  it('keeps one decimal for weights that are not whole percentages', () => {
    const wrapper = mountBreakdown({}, { mass: 1 / 3, adduct: 1 / 3, spatial: 1 / 3 })
    expect(cells(wrapper, 'Mass')[2]).toBe('33.3%')
    expect(cells(wrapper, 'chaos')[2]).toBe('6.7%')
    expect(cells(wrapper, 'Co-loc')[2]).toBe('26.7%')
    wrapper.unmount()
  })

  it('places measured values immediately after the total with six m/z decimals', () => {
    const wrapper = mountBreakdown()
    const footer = wrapper.findAll('tfoot tr')
    expect(footer[0]!.text()).toContain('Total')
    expect(footer[1]!.text()).toContain('obs 181.071835')
    expect(footer[1]!.text()).toContain('theo 181.071762')
    expect(footer[1]!.text()).toContain('Intensity 1.00')
    wrapper.unmount()
  })
})

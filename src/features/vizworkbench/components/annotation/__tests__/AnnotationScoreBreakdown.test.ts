import { beforeAll, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AnnotationScoreBreakdown from '../AnnotationScoreBreakdown.vue'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'
import type { IonAnnotation, IonScores } from '@/features/vizworkbench/types/annotation'

beforeAll(async () => {
  await loadCoreMessages('en')
  await loadFeatureMessages('vizworkbench')
})

function mountBreakdown(scores: Partial<IonScores> = {}) {
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
    props: { ion },
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
    expect(cells(wrapper, 'Mass')).toEqual(['Mass', '1.000', '70%', '0.700'])
    expect(cells(wrapper, 'Adduct fit')).toEqual(['Adduct fit', '1.000', '10%', '0.100'])
    expect(cells(wrapper, 'Spatial')).toEqual(['Spatial', '0.780', '20%', '0.156'])
    expect(cells(wrapper, 'chaos')).toEqual(['chaos', '0.900', '4%', '0.036'])
    expect(cells(wrapper, 'Co-loc')).toEqual(['Co-loc', '0.750', '16%', '0.120'])
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
    expect(cells(wrapper, 'Spatial')).toEqual(['Spatial', '0.000', '20%', '0.000'])
    expect(cells(wrapper, 'chaos')).toEqual(['chaos', '–', '4%', '–'])
    expect(cells(wrapper, 'Co-loc')).toEqual(['Co-loc', '–', '16%', '–'])
    expect(wrapper.find('tfoot').text()).toContain('0.800')
    expect(wrapper.text()).not.toContain('0.150*')
    wrapper.unmount()
  })

  it('distinguishes absent co-localization from an uncomputed spatial score', () => {
    const wrapper = mountBreakdown({ coloc: null, spatial: 0.18, total: 0.836 })
    expect(cells(wrapper, 'Spatial')).toEqual(['Spatial', '0.180', '20%', '0.036'])
    expect(cells(wrapper, 'Co-loc')).toEqual(['Co-loc', '0.000', '16%', '0.000'])
    wrapper.unmount()
  })

  it.each([-0.4, 0.05, 0.1])('shows correlation %s as zero co-localization contribution', (r) => {
    const wrapper = mountBreakdown({ coloc: r, spatial: 0.18, total: 0.836 })
    expect(cells(wrapper, 'Co-loc')).toEqual(['Co-loc', '0.000', '16%', '0.000'])
    expect(cells(wrapper, 'chaos')).toEqual(['chaos', '0.900', '4%', '0.036'])
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

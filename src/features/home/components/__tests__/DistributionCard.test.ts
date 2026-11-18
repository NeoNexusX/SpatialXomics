import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'
import DistributionCard from '../DistributionCard.vue'

const get = vi.hoisted(() => vi.fn())
vi.mock('@/shared/api/httpClient', () => ({ api: { get } }))
enableAutoUnmount(afterEach)

beforeAll(async () => {
  i18n.global.locale.value = 'en'
  await Promise.all([loadCoreMessages('en'), loadFeatureMessages('home')])
})
beforeEach(() => {
  get.mockReset()
  get.mockResolvedValue({ data: { 'Mouse (Mus musculus)': 3, 'Human (Homo sapiens)': 1 } })
})

function render(category: 'organism' | 'tissue' | 'ion-source' | 'analyzer') {
  return mount(DistributionCard, { props: { category }, global: { plugins: [i18n] } })
}

describe('distribution cards', () => {
  it.each([
    ['organism', 'Organism'],
    ['tissue', 'Organism Parts'],
    ['ion-source', 'Ion Source Types'],
    ['analyzer', 'Analyzer'],
  ] as const)('renders the %s title, total and category shares', async (category, title) => {
    const wrapper = render(category)
    expect(wrapper.get('[role="status"]').text()).toContain('Loading')
    await flushPromises()
    expect(wrapper.get('article').attributes('aria-label')).toBe(title)
    expect(wrapper.get('h3').text()).toBe(title)
    expect(wrapper.get('strong').text()).toBe('4')
    expect(wrapper.get('ol').attributes('aria-label')).toBe('4 datasets total')
    expect(wrapper.findAll('li').map((row) => row.text())).toEqual([
      'MouseMus musculus375.0%',
      'HumanHomo sapiens125.0%',
    ])
  })

  it('retries a failed card without resetting another card', async () => {
    get.mockRejectedValueOnce(new Error('Temporarily unavailable'))
    const organism = render('organism')
    const tissue = render('tissue')
    await flushPromises()
    expect(organism.get('[role="alert"]').text()).toContain('Temporarily unavailable')
    const tissueContent = tissue.text()

    await organism.get('button').trigger('click')
    await flushPromises()
    expect(organism.find('[role="alert"]').exists()).toBe(false)
    expect(organism.get('strong').text()).toBe('4')
    expect(tissue.text()).toBe(tissueContent)
    expect(tissue.find('[role="status"]').exists()).toBe(false)
  })

  it('shows an empty state without invalid percentages', async () => {
    get.mockResolvedValueOnce({ data: {} })
    const wrapper = render('analyzer')
    await flushPromises()
    expect(wrapper.find('ol').exists()).toBe(false)
    expect(wrapper.find('canvas').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/NaN|Infinity/)
    expect(wrapper.get('article').attributes('aria-busy')).toBe('false')
  })
})

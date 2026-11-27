import { beforeAll, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { i18n, loadFeatureMessages } from '@/i18n'
import ResultVisualizationLayout from '../ResultVisualizationLayout.vue'

beforeAll(() => loadFeatureMessages('vizworkbench'))

const global = { plugins: [i18n] }
const slots = {
  'left-panel': '<div data-testid="annotation-slot">annotation-slot</div>',
  viz: '<div>viz-slot</div>',
  compare: '<div>compare-slot</div>',
  'side-panel': '<div>side-slot</div>',
}

describe('ResultVisualizationLayout', () => {
  it('renders every column slot', () => {
    const wrapper = mount(ResultVisualizationLayout, { global, slots })

    expect(wrapper.text()).toContain('annotation-slot')
    expect(wrapper.text()).toContain('viz-slot')
    expect(wrapper.text()).toContain('compare-slot')
    expect(wrapper.text()).toContain('side-slot')
  })

  it('lets the left column shrink to a rail when collapsed', () => {
    const expanded = mount(ResultVisualizationLayout, { global, slots })
    const collapsed = mount(ResultVisualizationLayout, {
      props: { leftPanelCollapsed: true },
      global,
      slots,
    })

    expect(
      expanded.get('[data-testid="annotation-slot"]').element.parentElement?.classList,
    ).toContain('lg:flex-[1_1_0%]')
    expect(
      collapsed.get('[data-testid="annotation-slot"]').element.parentElement?.classList,
    ).toContain('lg:flex-none')
  })

  it('starts with Toolbox collapsed and keeps control values when reopened', async () => {
    const wrapper = mount(ResultVisualizationLayout, {
      global,
      attachTo: document.body,
      slots: { ...slots, 'side-panel': '<input aria-label="Gamma" />' },
    })
    const toggle = wrapper.get('aside button')
    const gamma = wrapper.get<HTMLInputElement>('[aria-label="Gamma"]')

    expect(toggle.text()).toBe('Toolbox')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('aside').classes()).toContain('lg:w-11')
    expect(gamma.isVisible()).toBe(false)

    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('aside').classes()).not.toContain('lg:w-11')
    expect(gamma.isVisible()).toBe(true)
    await gamma.setValue('0.8')

    await toggle.trigger('click')
    expect(gamma.isVisible()).toBe(false)
    await toggle.trigger('click')
    expect(gamma.isVisible()).toBe(true)
    expect(gamma.element.value).toBe('0.8')
    wrapper.unmount()
  })
})

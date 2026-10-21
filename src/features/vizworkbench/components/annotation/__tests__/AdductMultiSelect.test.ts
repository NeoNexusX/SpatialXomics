import { beforeAll, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import AdductMultiSelect from '../AdductMultiSelect.vue'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'
import type { AdductId } from '@/shared/chem/adducts'

beforeAll(async () => {
  await loadCoreMessages('en')
  await loadFeatureMessages('vizworkbench')
})

function mountSelect() {
  const Host = defineComponent({
    components: { AdductMultiSelect },
    setup: () => ({
      selected: ref<AdductId[]>(['M-H']),
      options: [
        { id: 'M-H', tone: 'primary', fit: 1 },
        { id: 'M+Cl', tone: 'secondary', fit: 0.5 },
        { id: 'M+HCOO', tone: 'muted', fit: 0 },
      ],
    }),
    template: `<AdductMultiSelect v-model="selected" :options="options" label="Adducts" empty-label="All adducts" clear-label="All adducts" />`,
  })
  return mount(Host, {
    attachTo: document.body,
    global: { plugins: [i18n], stubs: { SvgIcon: true } },
  })
}

describe('AdductMultiSelect', () => {
  it('keeps multiple choices selected while the list stays open', async () => {
    const wrapper = mountSelect()
    expect(wrapper.find('fieldset').isVisible()).toBe(false)
    await wrapper.find('button[aria-expanded]').trigger('click')
    const options = wrapper.findAll('input[type="checkbox"]')
    await options[1]!.setValue(true)
    expect(options.map((input) => (input.element as HTMLInputElement).checked)).toEqual([
      true,
      true,
      false,
    ])
    expect(wrapper.find('button[aria-expanded]').text()).toBe('2 selected')
    expect(wrapper.find('fieldset').isVisible()).toBe(true)
    await options[0]!.setValue(false)
    expect(options.map((input) => (input.element as HTMLInputElement).checked)).toEqual([
      false,
      true,
      false,
    ])
    wrapper.unmount()
  })

  it('clears the selected adducts to restore all results', async () => {
    const wrapper = mountSelect()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'All adducts')!
      .trigger('click')
    expect(wrapper.find('button[aria-expanded]').text()).toBe('All adducts')
    expect(
      wrapper
        .findAll('input[type="checkbox"]')
        .every((input) => !(input.element as HTMLInputElement).checked),
    ).toBe(true)
    wrapper.unmount()
  })
})

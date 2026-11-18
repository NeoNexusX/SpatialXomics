import { beforeAll, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

import SolventPicker from '../SolventPicker.vue'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'

const OPTIONS = ['Water', 'Acetic acid', 'Ammonium fluoride', 'Trifluoroacetic acid (TFA)'] as const

const mountPicker = (modelValue = '') =>
  mount(SolventPicker, {
    props: { modelValue, solventOptions: OPTIONS },
    global: { plugins: [i18n], stubs: { SvgIcon: true } },
  })

beforeAll(() =>
  Promise.all([
    loadCoreMessages('en'),
    loadFeatureMessages('upload'),
    loadFeatureMessages('datasets'),
  ]),
)

/** 模板里顺序是：用量输入 → 单位下拉 → 组分下拉（SelectWithOther） */
function selectsOf(wrapper: ReturnType<typeof mountPicker>) {
  const selects = wrapper.findAll('select')
  return { unit: selects[0]!, solvent: selects[1]! }
}

function lastEmitted(wrapper: ReturnType<typeof mountPicker>) {
  const events = wrapper.emitted('update:modelValue')
  return events?.[events.length - 1]
}

describe('SolventPicker', () => {
  it('adds a concentration entry with the selected unit', async () => {
    const wrapper = mountPicker()
    const { unit, solvent } = selectsOf(wrapper)

    await wrapper.find('input[type="text"]').setValue('1')
    await unit.setValue('mM')
    await solvent.setValue('Acetic acid')
    await wrapper.find('button[title="Add solvent"]').trigger('click')

    expect(lastEmitted(wrapper)).toEqual(['1 mM Acetic acid'])
  })

  it('still adds percentage entries', async () => {
    const wrapper = mountPicker()
    const { solvent } = selectsOf(wrapper)

    await wrapper.find('input[type="text"]').setValue('50')
    await solvent.setValue('Water')
    await wrapper.find('button[title="Add solvent"]').trigger('click')

    expect(lastEmitted(wrapper)).toEqual(['50% Water'])
  })

  it('accepts concentrations above 100, such as 350 μM', async () => {
    const wrapper = mountPicker()
    const { unit, solvent } = selectsOf(wrapper)

    await wrapper.find('input[type="text"]').setValue('350')
    await unit.setValue('μM')
    await solvent.setValue('Ammonium fluoride')
    await wrapper.find('button[title="Add solvent"]').trigger('click')

    expect(lastEmitted(wrapper)).toEqual(['350 μM Ammonium fluoride'])
  })

  it('adds an entry with a custom unit selected through Other', async () => {
    const wrapper = mountPicker()
    const { unit, solvent } = selectsOf(wrapper)

    await wrapper.find('input[type="text"]').setValue('5')
    await unit.setValue('__custom__')
    await wrapper.findAll('input')[1]!.setValue('mg/kg')
    await solvent.setValue('Water')
    await wrapper.find('button[title="Add solvent"]').trigger('click')

    expect(lastEmitted(wrapper)).toEqual(['5 mg/kg Water'])
  })

  it('requires a unit when Other is selected', async () => {
    const wrapper = mountPicker()
    const { unit, solvent } = selectsOf(wrapper)

    await wrapper.find('input[type="text"]').setValue('5')
    await unit.setValue('__custom__')
    await solvent.setValue('Water')
    await wrapper.find('button[title="Add solvent"]').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.text()).toContain('Please enter a unit')
  })

  it('allows small percentages such as 0.1% TFA', async () => {
    const wrapper = mountPicker()
    const { solvent } = selectsOf(wrapper)

    await wrapper.find('input[type="text"]').setValue('0.1')
    await solvent.setValue('Trifluoroacetic acid (TFA)')
    await wrapper.find('button[title="Add solvent"]').trigger('click')

    expect(lastEmitted(wrapper)).toEqual(['0.1% Trifluoroacetic acid (TFA)'])
  })

  it('rejects percentages outside (0, 100]', async () => {
    const wrapper = mountPicker()
    const { solvent } = selectsOf(wrapper)

    await wrapper.find('input[type="text"]').setValue('0')
    await solvent.setValue('Water')
    await wrapper.find('button[title="Add solvent"]').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.text()).toContain('Percentage must be greater than 0 and at most 100')
  })

  it('rejects non-positive concentrations', async () => {
    const wrapper = mountPicker()
    const { unit, solvent } = selectsOf(wrapper)

    await wrapper.find('input[type="text"]').setValue('0')
    await unit.setValue('mM')
    await solvent.setValue('Acetic acid')
    await wrapper.find('button[title="Add solvent"]').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.text()).toContain('Concentration must be a number greater than 0')
  })

  it('parses existing entries and removes them individually', async () => {
    const wrapper = mountPicker('50% Water, 1 mM Acetic acid')

    expect(wrapper.text()).toContain('50% Water')
    expect(wrapper.text()).toContain('1 mM Acetic acid')

    await wrapper.findAll('button[title="Remove"]')[1]!.trigger('click')
    await nextTick()

    expect(lastEmitted(wrapper)).toEqual(['50% Water'])
  })
})

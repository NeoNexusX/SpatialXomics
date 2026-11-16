import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import IconSelect from '../IconSelect.vue'

const mountSelect = (props: Record<string, unknown> = {}) =>
  mount(IconSelect, {
    props: { modelValue: '', options: ['profile', 'centroid'], placeholder: 'Select...', ...props },
    global: { stubs: { SvgIcon: true } },
  })

const placeholderOption = (wrapper: ReturnType<typeof mountSelect>) => wrapper.find('option')

describe('IconSelect placeholder option', () => {
  // 回归：占位项（"Select stabilization..." 这类提示）曾被渲染成可选项，
  // 展开后能点中并把字段改成空值
  it('is not selectable by default', () => {
    const option = placeholderOption(mountSelect()).element

    expect(option.hasAttribute('disabled')).toBe(true)
    expect(option.hasAttribute('hidden')).toBe(true)
  })

  it('stays selectable when placeholderSelectable is set (filter "Any")', () => {
    const option = placeholderOption(mountSelect({ placeholderSelectable: true })).element

    expect(option.hasAttribute('disabled')).toBe(false)
    expect(option.hasAttribute('hidden')).toBe(false)
  })

  it('is not selectable when required, even with placeholderSelectable', () => {
    const option = placeholderOption(
      mountSelect({ placeholderSelectable: true, required: true }),
    ).element

    expect(option.hasAttribute('disabled')).toBe(true)
  })

  it('is not rendered at all when placeholder is empty', () => {
    const values = mountSelect({ placeholder: '' })
      .findAll('option')
      .map((o) => o.element.value)

    expect(values).toEqual(['profile', 'centroid'])
  })
})

describe('IconSelect selected-value display', () => {
  // Chromium 对原生 <select> 强制 overflow:visible，text-overflow 不生效，
  // 长选项（MALDI Matrix 等）会一路画到箭头下面。可见文本改为自绘的 span。
  it('renders the selected label in a truncating span with the full value as title', () => {
    const wrapper = mountSelect({
      modelValue: 'DHB (2,5-Dihydroxybenzoic acid)',
      options: ['DHB (2,5-Dihydroxybenzoic acid)', 'CHCA'],
    })
    const display = wrapper.find('label > span')

    expect(display.text()).toBe('DHB (2,5-Dihydroxybenzoic acid)')
    expect(display.classes()).toContain('truncate')
    expect(display.attributes('title')).toBe('DHB (2,5-Dihydroxybenzoic acid)')
  })

  it('falls back to the placeholder when nothing is selected', () => {
    const wrapper = mountSelect({ modelValue: '', placeholder: 'Select...' })
    const display = wrapper.find('label > span')

    expect(display.text()).toBe('Select...')
    expect(display.attributes('title')).toBeUndefined()
  })

  // SelectWithOther 的自由输入值不在选项里 → 与原生 select 一致显示为空
  // （文本由下方的 Other 输入框承担）
  it('shows nothing when the value is not among the options', () => {
    const wrapper = mountSelect({ modelValue: 'Mouse', options: ['Human', 'Rat'] })

    expect(wrapper.find('label > span').text()).toBe('')
  })

  it('keeps the native select for interaction and the dropdown list', () => {
    const wrapper = mountSelect({ modelValue: 'profile' })
    const select = wrapper.find('select')

    expect(select.classes()).toContain('icon-select-native')
    // 选项列表仍是全称
    expect(select.findAll('option').map((o) => o.text())).toEqual(['Select...', 'profile', 'centroid'])
  })
})

describe('IconSelect focus events', () => {
  it('forwards focus and blur from the native select', async () => {
    const wrapper = mountSelect()

    await wrapper.find('select').trigger('focus')
    await wrapper.find('select').trigger('blur')

    expect(wrapper.emitted('focus')).toHaveLength(1)
    expect(wrapper.emitted('blur')).toHaveLength(1)
  })
})

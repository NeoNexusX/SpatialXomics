import { beforeAll, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CollectionFormCard from '../CollectionFormCard.vue'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'

const mountCard = (props: Record<string, unknown> = {}) =>
  mount(CollectionFormCard, {
    props: { name: '', description: '', ...props },
    global: { plugins: [i18n] },
  })

// 组件模板用 $t：挂载时装上 i18n 实例，并预先加载英文语言包（断言保持英文原文）
beforeAll(() => Promise.all([loadCoreMessages('en'), loadFeatureMessages('collections')]))

describe('CollectionFormCard', () => {
  // 创建页的名称 / 简介上限与编辑表单、保存前校验同源（字段定义表的 maxLength = 后端写入校验）
  it('takes name and description maxlength from the field table', () => {
    const wrapper = mountCard()

    expect(wrapper.find('input[type="text"]').attributes('maxlength')).toBe('128')
    expect(wrapper.find('textarea').attributes('maxlength')).toBe('512')
  })

  it('shows the description character counter from the field table', () => {
    const wrapper = mountCard({ description: 'abc' })

    expect(wrapper.text()).toContain('3/512')
  })

  it('emits name and description edits', async () => {
    const wrapper = mountCard()

    await wrapper.find('input[type="text"]').setValue('Kidney Atlas')
    await wrapper.find('textarea').setValue('A curated set')

    expect(wrapper.emitted('update:name')).toEqual([['Kidney Atlas']])
    expect(wrapper.emitted('update:description')).toEqual([['A curated set']])
  })
})

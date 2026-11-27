import { beforeAll, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import CollectionMetadataPanel from '../CollectionMetadataPanel.vue'
import CollapsibleText from '../CollapsibleText.vue'
import { toMetadataDraft } from '../../utils/metadataPatch'
import { METADATA_FIELDS } from '../../constants/metadataFields'
import type { CollectionMetadata } from '../../types/collection'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'

const metadata: CollectionMetadata = { name: 'Kidney Atlas', doi: ['10.1/x'] }


// 组件模板用 $t：挂载时装上 i18n 实例，并预先加载英文语言包（断言保持英文原文）
beforeAll(() => Promise.all([loadCoreMessages('en'), loadFeatureMessages('collections'), loadFeatureMessages('datasets')]))

describe('CollectionMetadataPanel', () => {
  // 公开只读页 / Overview 非编辑态：表格展示，空字段占位「—」
  it('renders every field read-only when no draft is passed', () => {
    const wrapper = mount(CollectionMetadataPanel, { props: { metadata }, global: { plugins: [i18n] } })
    const text = wrapper.text()

    for (const field of METADATA_FIELDS) expect(text).toContain(field.label())
    expect(text).toContain('10.1/x')
    expect(text).toContain('—')
    expect(text).toContain(`2/${METADATA_FIELDS.length} fields`)
    // 只读态没有任何输入控件
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.find('textarea').exists()).toBe(false)
  })

  // 编辑态：正文换成表驱动表单，只读的 <dl> 让位
  it('swaps its body for the form when a draft is passed', () => {
    const draft = reactive(toMetadataDraft(metadata))
    const wrapper = mount(CollectionMetadataPanel, { props: { metadata, draft }, global: { plugins: [i18n] } })

    expect(wrapper.find('input').exists()).toBe(true)
    expect(wrapper.find('dl').exists()).toBe(false)
    expect(wrapper.find('h2').text()).toBe('Collection Metadata')
  })

  // 计数读草稿：输入时实时更新（N/M 概览跟着动）
  it('counts filled fields from the draft while editing', () => {
    const draft = reactive(toMetadataDraft({ name: 'Kidney Atlas' }))
    const wrapper = mount(CollectionMetadataPanel, { props: { metadata, draft }, global: { plugins: [i18n] } })

    // metadata 里 doi 已填，草稿里为空 → 计数以草稿为准
    expect(wrapper.text()).toContain(`1/${METADATA_FIELDS.length} fields`)
  })

  // 只读态的引用 / 摘要走折叠组件：全文原样交给它，由它决定是否显示「展开全文」；
  // 简介上限只有 512，不走折叠、整段展示
  it('hands collapsible text fields to the collapsible component with the full value', () => {
    const abstract = 'First paragraph.\n\nSecond paragraph.'
    const wrapper = mount(CollectionMetadataPanel, {
      props: { metadata: { ...metadata, abstract, description: 'A short description' } },
      global: { plugins: [i18n] },
    })

    expect(wrapper.findAllComponents(CollapsibleText).map((c) => c.props('value'))).toEqual([
      abstract,
    ])
    expect(wrapper.find('p.whitespace-pre-line').text()).toBe(abstract)
    expect(wrapper.text()).toContain('A short description')
    // jsdom 没有布局，量不出截断，所以不出现展开按钮（截断逻辑由 CollapsibleText 自己的测试覆盖）
    expect(wrapper.find('button').exists()).toBe(false)
  })
})

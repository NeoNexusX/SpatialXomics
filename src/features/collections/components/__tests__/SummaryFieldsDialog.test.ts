import { beforeAll, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SummaryFieldsDialog from '../SummaryFieldsDialog.vue'
import type { DerivedMetadataChange } from '../../utils/deriveCollectionMetadata'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'

const changes: DerivedMetadataChange[] = [
  { key: 'organism', before: ['Mouse'], after: ['Mouse', 'Human (Homo sapiens)'] },
  { key: 'polarity', before: [], after: ['Positive'] },
]

const mountDialog = (props: Record<string, unknown> = {}) =>
  mount(SummaryFieldsDialog, {
    props: { changes: [], updating: false, ...props },
    global: { plugins: [i18n] },
  })

// 组件模板用 $t：挂载时装上 i18n 实例，并预先加载英文语言包（断言保持英文原文）；
// 词表译文在 datasets 命名空间
beforeAll(() =>
  Promise.all([
    loadCoreMessages('en'),
    loadFeatureMessages('collections'),
    loadFeatureMessages('datasets'),
  ]),
)

describe('SummaryFieldsDialog', () => {
  it('stays closed while there is nothing to confirm', () => {
    const wrapper = mountDialog()

    expect(wrapper.find('dialog').classes()).not.toContain('modal-open')
  })

  it('lists each affected field with its current and suggested values', () => {
    const wrapper = mountDialog({ changes })
    const text = wrapper.text()

    expect(wrapper.find('dialog').classes()).toContain('modal-open')
    expect(text).toContain('Update sample and acquisition fields?')
    expect(text).toContain('Organism')
    expect(text).toContain('Mouse')
    expect(text).toContain('Human (Homo sapiens)')
    expect(text).toContain('Polarity')
    expect(text).toContain('Positive')
    // polarity 原来没填：箭头左侧显示占位
    expect(text).toContain('Not filled')
  })

  // 一眼看出这次变化带来了什么，其余取值只是原样带过去
  it('highlights exactly the values the member change brings', () => {
    const wrapper = mountDialog({ changes })

    expect(wrapper.findAll('span.text-primary').map((chip) => chip.text())).toEqual([
      'Human (Homo sapiens)',
      'Positive',
    ])
  })

  it('emits confirm and cancel from its two buttons', async () => {
    const wrapper = mountDialog({ changes })
    const buttons = wrapper.findAll('.modal-action button')

    expect(buttons.map((button) => button.text())).toEqual(['Cancel', 'Update these fields'])

    await buttons[0]!.trigger('click')
    await buttons[1]!.trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })
})

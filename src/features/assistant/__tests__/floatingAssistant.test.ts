import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { t } from '@/i18n'
import FloatingAIAssistant from '../components/FloatingAIAssistant.vue'

vi.mock('../components/AssistantWorkspace.vue', () => {
  throw new Error('chunk failed')
})

describe('FloatingAIAssistant', () => {
  it('offers a way out when the chat chunk fails to load', async () => {
    const wrapper = mount(FloatingAIAssistant, {
      props: { show: true },
      global: { mocks: { $t: (key: string) => key } },
    })
    await vi.waitFor(() =>
      expect(wrapper.text()).toContain(
        t('common.feedback.loadFailed', { target: t('common.assistant.title') }),
      ),
    )
    expect(wrapper.find('.loading-spinner').exists()).toBe(false)

    const close = wrapper.findAll('button').find((b) => b.text() === t('common.action.close'))!
    await close.trigger('click')
    expect(wrapper.emitted('update:show')?.[0]).toEqual([false])
  })
})

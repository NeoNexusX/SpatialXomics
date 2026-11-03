import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentTurn from '../components/chat/AgentTurn.vue'
import type { UiChatItem } from '../plugins/session-transcript'

vi.mock('../components/ai-elements/AgentMarkdown.vue', () => ({
  default: { name: 'AgentMarkdown', props: ['text'], template: '<p>{{ text }}</p>' },
}))

const translate = (key: string, params?: Record<string, unknown>) =>
  params ? `${key} ${JSON.stringify(params)}` : key

function mountTurn(message: Partial<UiChatItem>) {
  return mount(AgentTurn, {
    props: {
      message: { id: 'a', role: 'assistant', content: '', parts: [], ...message },
      canRetry: false,
    },
    global: { mocks: { $t: translate } },
  })
}

describe('AgentTurn', () => {
  it('says it is working while waiting for the model', () => {
    expect(mountTurn({ pending: true }).text()).toContain('common.agent.working')
  })

  it('says which retry it is on during a backoff', () => {
    const text = mountTurn({ pending: true, retrying: { retry: 2, maxRetries: 5 } }).text()
    expect(text).toContain('common.agent.retrying')
    expect(text).toContain('"retry":2')
    expect(text).toContain('"max":5')
    expect(text).not.toContain('common.agent.working')
  })

  describe('usage', () => {
    const answered = (usage?: UiChatItem['usage']): Partial<UiChatItem> => ({
      content: 'done',
      parts: [{ type: 'text', text: 'done' }],
      usage,
    })

    it('shows total input and output, with cache reads counted as input', () => {
      const wrapper = mountTurn(
        answered({
          inputTokens: 200,
          outputTokens: 540,
          cacheReadTokens: 12_000,
          cacheWriteTokens: 100,
        }),
      )
      const label = wrapper.get('span[title]')
      expect(label.text()).toBe('12.3k / 540')
      expect(label.attributes('title')).toContain('common.agent.usage')
      expect(label.attributes('title')).toContain(`"cached":"${(12_000).toLocaleString()}"`)
    })

    it('rounds whole thousands cleanly', () => {
      const wrapper = mountTurn(answered({ inputTokens: 2000, outputTokens: 999 }))
      expect(wrapper.get('span[title]').text()).toBe('2k / 999')
    })

    it('shows nothing when the endpoint reported no usage', () => {
      expect(mountTurn(answered()).find('span[title]').exists()).toBe(false)
    })

    it('waits until the reply is finished', () => {
      const wrapper = mountTurn({
        ...answered({ inputTokens: 1, outputTokens: 1 }),
        pending: true,
      })
      expect(wrapper.find('span[title]').exists()).toBe(false)
    })
  })
})

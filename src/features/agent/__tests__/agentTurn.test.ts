import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentTurn from '../components/chat/AgentTurn.vue'
import type { UiChatItem, UiPart } from '../plugins/session-transcript'
import type { QuestionRecord, QuestionRecords } from '../plugins/user-questions'

vi.mock('../components/ai-elements/AgentMarkdown.vue', () => ({
  default: { name: 'AgentMarkdown', props: ['text'], template: '<p>{{ text }}</p>' },
}))

const translate = (key: string, params?: Record<string, unknown>) =>
  params ? `${key} ${JSON.stringify(params)}` : key

function mountTurn(message: Partial<UiChatItem>, questions?: QuestionRecords) {
  return mount(AgentTurn, {
    props: {
      message: { id: 'a', role: 'assistant', content: '', parts: [], ...message },
      canRetry: false,
      questions,
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

  describe('questions', () => {
    const tool = (id: string, name = 'ask_user_question'): UiPart => ({
      type: 'tool',
      id,
      name,
      input: {},
      state: 'done',
      preview: '',
    })
    const record = (patch: Partial<QuestionRecord> = {}): QuestionRecord => ({
      callKey: '3:1',
      turnId: 't1',
      questions: [
        { id: 'adduct', header: 'Adduct', question: 'Which adduct?', options: [{ label: '[M+H]+ (Recommended)' }] },
        { id: 'regions', question: 'Which regions?', multiSelect: true },
        { id: 'note', question: 'Anything else?' },
      ],
      state: 'answered',
      answers: [
        { id: 'adduct', selected: ['[M+H]+ (Recommended)'], auto: true },
        { id: 'regions', selected: [], custom: 'Cortex, thalamus' },
        { id: 'note', selected: [] },
      ],
      timedOut: true,
      ...patch,
    })
    const parts: UiPart[] = [
      { type: 'reasoning', text: 'plan', active: false },
      tool('3:1'),
      { type: 'reasoning', text: 'next', active: false },
    ]

    it('shows an answered question as a reply that splits the steps around it', () => {
      const wrapper = mountTurn({ parts }, { '3:1': record() })
      expect(wrapper.findAll('[data-slot="trace"]')).toHaveLength(2)
      const reply = wrapper.get('dl')
      expect(reply.text()).toContain('Which adduct?')
      expect(reply.text()).toContain('[M+H]+')
      expect(reply.text()).not.toContain('(Recommended)')
      expect(reply.text()).toContain('common.agent.question.auto')
      expect(reply.text()).toContain('Cortex, thalamus')
      expect(reply.text()).toContain('common.agent.question.skipped')
      expect(wrapper.text()).toContain('common.agent.question.timedOut')
      expect(wrapper.text()).not.toContain('ask_user_question')
    })

    it('keeps waiting and unanswered questions in the steps', () => {
      const waiting = mountTurn({ parts }, { '3:1': record({ state: 'waiting', answers: undefined }) })
      expect(waiting.findAll('[data-slot="trace"]')).toHaveLength(1)
      expect(waiting.text()).toContain('Adduct')
      expect(waiting.text()).toContain('common.agent.question.waiting')
      const unanswered = mountTurn({ parts }, { '3:1': record({ state: 'unanswered', answers: undefined }) })
      expect(unanswered.text()).toContain('common.agent.question.unanswered')
    })

    it('shows a call without a record as an ordinary tool step', () => {
      const wrapper = mountTurn({ parts })
      expect(wrapper.text()).toContain('ask_user_question')
      expect(wrapper.find('dl').exists()).toBe(false)
    })
  })
})

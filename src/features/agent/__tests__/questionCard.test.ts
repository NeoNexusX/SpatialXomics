import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import QuestionCard from '../components/chat/QuestionCard.vue'
import {
  initialDraft,
  type PendingQuestion,
  type Question,
  type QuestionDraft,
} from '../plugins/user-questions'

const { saveDrafts, submit } = vi.hoisted(() => ({ saveDrafts: vi.fn(), submit: vi.fn() }))

vi.mock('vue-i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-i18n')>()),
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}))
vi.mock('../composables/useQuestion', () => ({ useQuestion: () => ({ saveDrafts, submit }) }))

const questions: Question[] = [
  {
    id: 'adduct',
    header: 'Adduct',
    question: 'Which adduct?',
    options: [{ label: '[M+H]+ (Recommended)', description: 'Positive mode.' }, { label: '[M+Na]+' }],
  },
  {
    id: 'regions',
    question: 'Which regions?',
    multiSelect: true,
    options: [{ label: 'Cortex' }, { label: 'Hippocampus' }],
  },
  { id: 'note', question: 'Anything else?' },
]

function pendingOf(drafts: QuestionDraft[] = questions.map(initialDraft)): PendingQuestion {
  return {
    sessionId: 's1',
    callId: 'call-1',
    questions,
    deadline: Date.now() + 600_000,
    timeoutMs: 600_000,
    drafts,
  }
}

let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  saveDrafts.mockReset()
  submit.mockReset()
})

/** 挂载后等 Questionnaire 登记完选项，和真实点击时的状态一致 */
async function mountCard(pending = pendingOf()) {
  wrapper = mount(QuestionCard, { props: { pending }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

const activeQuestion = (card: VueWrapper) => card.get('fieldset[data-active]').get('legend').text()
const choice = (card: VueWrapper, label: string) =>
  card
    .get('fieldset[data-active]')
    .findAll('input')
    .find((input) => (input.element as HTMLInputElement).value === label)!
const button = (card: VueWrapper, label: string) =>
  card.findAll('button').find((item) => item.text() === label && item.isVisible())!
/** 点选会在 change 之后、下一个宏任务里才跳题 */
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await flushPromises()
}
const lastDrafts = () => saveDrafts.mock.lastCall![0] as QuestionDraft[]

describe('QuestionCard', () => {
  it('preselects the recommended option and shows the header and the time left', async () => {
    const card = await mountCard()
    expect(activeQuestion(card)).toBe('Which adduct?')
    expect((choice(card, '[M+H]+ (Recommended)').element as HTMLInputElement).checked).toBe(true)
    const recommended = card.get('fieldset[data-active] label')
    expect(recommended.text()).toContain('[M+H]+')
    expect(recommended.text()).not.toContain('(Recommended)')
    expect(recommended.text()).toContain('common.agent.question.recommended')
    expect(recommended.text()).toContain('Positive mode.')
    expect(card.text()).toContain('Adduct')
    expect(card.text()).toContain('10:00')
  })

  it('moves on after a click on a single-select option but not after a keyboard choice', async () => {
    const card = await mountCard()
    await choice(card, '[M+Na]+').trigger('click')
    await settle()
    expect(activeQuestion(card)).toBe('Which adduct?')
    expect(lastDrafts()[0]).toMatchObject({ selected: ['[M+Na]+'], touched: true })

    await choice(card, '[M+H]+ (Recommended)').trigger('click', { detail: 1 })
    await settle()
    expect(activeQuestion(card)).toBe('Which regions?')
    expect(lastDrafts()[0]).toMatchObject({ selected: ['[M+H]+ (Recommended)'] })
  })

  it('keeps custom text exclusive for single-select and alongside choices for multi-select', async () => {
    const card = await mountCard()
    await card.get('fieldset[data-active] input[type="text"]').setValue('[M+K]+')
    expect(lastDrafts()[0]).toMatchObject({ selected: [], custom: '[M+K]+' })
    expect((choice(card, '[M+H]+ (Recommended)').element as HTMLInputElement).checked).toBe(false)

    await button(card, 'common.agent.question.next').trigger('click')
    await choice(card, 'Hippocampus').setValue(true)
    await card.get('fieldset[data-active] input[type="text"]').setValue('Thalamus')
    expect(lastDrafts()[1]).toMatchObject({ selected: ['Hippocampus'], custom: 'Thalamus' })
  })

  it('submits the answers in question order once every question is answered or skipped', async () => {
    const card = await mountCard()
    await button(card, 'common.agent.question.next').trigger('click')
    await choice(card, 'Cortex').setValue(true)
    await button(card, 'common.agent.question.next').trigger('click')
    expect(activeQuestion(card)).toBe('Anything else?')
    await button(card, 'common.agent.question.skip').trigger('click')
    await settle()
    expect(lastDrafts()[2]).toMatchObject({ selected: [], custom: '', skipped: true })
    expect(submit).toHaveBeenCalledWith({
      answers: [
        { id: 'adduct', selected: ['[M+H]+ (Recommended)'] },
        { id: 'regions', selected: ['Cortex'] },
        { id: 'note', selected: [] },
      ],
    })
  })

  it('does not submit while a question is neither answered nor skipped', async () => {
    const card = await mountCard()
    await button(card, 'common.agent.question.next').trigger('click')
    await choice(card, 'Cortex').setValue(true)
    await button(card, 'common.agent.question.next').trigger('click')
    await card.get('form').trigger('submit')
    await settle()
    expect(submit).not.toHaveBeenCalled()
    expect(card.get('fieldset[data-active] [role="alert"]').text()).toBe(
      'common.agent.question.incomplete',
    )
  })

  it('reopens at the first question the user has not answered yet', async () => {
    const drafts = questions.map(initialDraft)
    const answered = { ...drafts[0]!, touched: true }
    const card = await mountCard(pendingOf([answered, drafts[1]!, { ...drafts[2]!, custom: 'later', touched: true }]))
    expect(activeQuestion(card)).toBe('Which regions?')
  })

  it('shows why a submission was refused and stops the turn on request', async () => {
    submit.mockImplementation(() => {
      throw new Error('this question is no longer waiting for an answer')
    })
    const card = await mountCard(
      pendingOf([initialDraft(questions[0]!), { ...initialDraft(questions[1]!), selected: ['Cortex'] }, { ...initialDraft(questions[2]!), skipped: true }]),
    )
    await card.get('form').trigger('submit')
    await settle()
    expect(card.text()).toContain('common.agent.question.submitFailed')
    expect(card.text()).toContain('this question is no longer waiting for an answer')
    await card.get('button[aria-label="common.agent.stop"]').trigger('click')
    expect(card.emitted('stop')).toHaveLength(1)
  })
})

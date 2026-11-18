import { describe, expect, it } from 'vitest'
import {
  answerBatchOf,
  checkAnswers,
  draftAnswer,
  initialDraft,
  parseRecommendedLabel,
  questionsOf,
  readQuestions,
  recommendedLabels,
  timeoutAnswers,
  type AskUserArgs,
  type Question,
  type QuestionDraft,
} from '..'

const adduct: Question = {
  id: 'adduct',
  question: 'Which adduct should the annotation assume?',
  options: [{ label: '[M+H]+ (Recommended)' }, { label: '[M+Na]+' }],
}
const regions: Question = {
  id: 'regions',
  question: 'Which regions should be compared?',
  multiSelect: true,
  options: [{ label: 'Cortex (Recommended)' }, { label: 'Hippocampus' }, { label: 'Striatum (推荐)' }],
}
const note: Question = { id: 'note', question: 'Anything else to consider?' }

const draft = (patch: Partial<QuestionDraft> = {}): QuestionDraft => ({
  selected: [],
  custom: '',
  skipped: false,
  touched: true,
  ...patch,
})

describe('reading the tool arguments', () => {
  it('maps the model vocabulary to questions and drops absent fields', () => {
    const args: AskUserArgs = {
      questions: [
        {
          id: 'regions',
          question: 'Which regions?',
          header: 'Regions',
          multi_select: true,
          options: [{ label: 'Cortex', description: 'Grey matter.' }, { label: 'Hippocampus' }],
        },
        { id: 'note', question: 'Anything else?' },
      ],
    }
    expect(readQuestions(args)).toEqual([
      {
        id: 'regions',
        question: 'Which regions?',
        header: 'Regions',
        options: [{ label: 'Cortex', description: 'Grey matter.' }, { label: 'Hippocampus' }],
        multiSelect: true,
      },
      { id: 'note', question: 'Anything else?' },
    ])
  })

  it('rejects what the schema cannot express', () => {
    expect(() => readQuestions({ questions: [] })).toThrow(
      'ask_user_question requires at least one question',
    )
    expect(() =>
      readQuestions({ questions: [{ id: 'a', question: 'x' }, { id: 'a', question: 'y' }] }),
    ).toThrow('question id "a" must be unique within this call')
    expect(() =>
      readQuestions({
        questions: [{ id: 'a', question: 'x', options: [{ label: 'Yes' }, { label: 'Yes' }] }],
      }),
    ).toThrow('option labels must be unique within question "a"')
  })

  it('reads logged arguments only when they are valid', () => {
    expect(questionsOf({ questions: [{ id: 'a', question: 'x' }] })).toEqual([
      { id: 'a', question: 'x' },
    ])
    expect(questionsOf({ questions: [{ id: 'a' }] })).toBeNull()
    expect(questionsOf({ questions: [] })).toBeNull()
    expect(questionsOf(null)).toBeNull()
  })
})

describe('recommended options', () => {
  it('strips the marker but keeps the original label for the answer', () => {
    expect(parseRecommendedLabel('[M+H]+ (Recommended)')).toEqual({ label: '[M+H]+', recommended: true })
    expect(parseRecommendedLabel('Cortex (recommended)')).toEqual({ label: 'Cortex', recommended: true })
    expect(parseRecommendedLabel('皮层（推荐）')).toEqual({ label: '皮层', recommended: true })
    expect(parseRecommendedLabel('Striatum (推荐)')).toEqual({ label: 'Striatum', recommended: true })
    expect(parseRecommendedLabel('Recommended reading')).toEqual({
      label: 'Recommended reading',
      recommended: false,
    })
  })

  it('preselects only a marked first choice for single-select and every marked choice for multi-select', () => {
    expect(recommendedLabels(adduct)).toEqual(['[M+H]+ (Recommended)'])
    expect(
      recommendedLabels({ ...adduct, options: [{ label: '[M+Na]+' }, { label: '[M+H]+ (Recommended)' }] }),
    ).toEqual([])
    expect(recommendedLabels(regions)).toEqual(['Cortex (Recommended)', 'Striatum (推荐)'])
    expect(initialDraft(note)).toEqual({ selected: [], custom: '', skipped: false, touched: false })
  })
})

describe('drafts and answers', () => {
  it('turns a draft into an answer once it is answered or skipped', () => {
    expect(draftAnswer(adduct, draft({ selected: ['[M+Na]+'] }))).toEqual({
      id: 'adduct',
      selected: ['[M+Na]+'],
    })
    expect(draftAnswer(adduct, draft({ selected: ['[M+Na]+'], custom: '  [M+K]+ ' }))).toEqual({
      id: 'adduct',
      selected: [],
      custom: '[M+K]+',
    })
    expect(draftAnswer(regions, draft({ selected: ['Hippocampus'], custom: 'Thalamus' }))).toEqual({
      id: 'regions',
      selected: ['Hippocampus'],
      custom: 'Thalamus',
    })
    expect(draftAnswer(note, draft({ skipped: true }))).toEqual({ id: 'note', selected: [] })
    expect(draftAnswer(note, draft({ custom: '   ' }))).toBeUndefined()
  })

  it('fills in untouched questions with the recommendation when the wait runs out', () => {
    const questions = [adduct, regions, note]
    expect(
      timeoutAnswers(questions, [
        initialDraft(adduct),
        draft({ selected: ['Hippocampus'] }),
        draft({ custom: '' }),
      ]),
    ).toEqual([
      { id: 'adduct', selected: ['[M+H]+ (Recommended)'], auto: true },
      { id: 'regions', selected: ['Hippocampus'] },
      { id: 'note', selected: [], auto: true },
    ])
    expect(timeoutAnswers([note], [])).toEqual([{ id: 'note', selected: [], auto: true }])
  })
})

describe('checking a submitted batch', () => {
  const questions = [adduct, regions, note]
  const valid = {
    answers: [
      { id: 'note', selected: [], custom: ' keep it short ' },
      { id: 'adduct', selected: ['[M+Na]+'] },
      { id: 'regions', selected: ['Cortex (Recommended)'], custom: 'Thalamus', auto: true },
    ],
  }

  it('returns the answers in question order, trimmed, without client flags', () => {
    expect(checkAnswers(questions, valid)).toEqual([
      { id: 'adduct', selected: ['[M+Na]+'] },
      { id: 'regions', selected: ['Cortex (Recommended)'], custom: 'Thalamus' },
      { id: 'note', selected: [], custom: 'keep it short' },
    ])
  })

  it.each([
    [{ answers: 'none' }, 'invalid answer: "answer.answers" must be an array'],
    [
      { answers: [{ id: 'adduct', selected: [] }] },
      'the answer batch must name each of its 3 questions exactly once',
    ],
    [
      { answers: [...valid.answers.slice(0, 2), { id: 'adduct', selected: [] }] },
      'the answer batch must name each of its 3 questions exactly once',
    ],
    [
      { answers: [valid.answers[0], { id: 'adduct', selected: ['[M+K]+'] }, valid.answers[2]] },
      'answer "adduct" selects labels that are not its options',
    ],
    [
      {
        answers: [valid.answers[0], { id: 'adduct', selected: ['[M+Na]+', '[M+H]+ (Recommended)'] }, valid.answers[2]],
      },
      'answer "adduct" must select one option or give custom text, not both',
    ],
    [
      { answers: [valid.answers[0], { id: 'adduct', selected: ['[M+Na]+'], custom: 'x' }, valid.answers[2]] },
      'answer "adduct" must select one option or give custom text, not both',
    ],
  ])('rejects %j', (batch, message) => {
    expect(() => checkAnswers(questions, batch)).toThrow(message)
  })
})

describe('reading a recorded result', () => {
  it('reads answer batches and ignores failures', () => {
    expect(answerBatchOf('{"timedOut":true,"answers":[{"id":"a","selected":[],"auto":true}]}')).toEqual({
      timedOut: true,
      answers: [{ id: 'a', selected: [], auto: true }],
    })
    expect(answerBatchOf('Error: tool call aborted')).toBeNull()
    expect(answerBatchOf('{"answers":"x"}')).toBeNull()
  })
})

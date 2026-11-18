/** ask_user_question 的参数和规则：推荐项、草稿、回答的校验与格式，工具、服务、投影和界面共用 */

import {
  compileParameters,
  compileValueSchema,
  validateJsonSchemaValue,
  type InferArgs,
  type ParameterSchemaSpec,
} from '../tools'
import type { AnswerBatch, Question, QuestionAnswer, QuestionDraft } from './types'

export const ASK_USER_QUESTION = 'ask_user_question'

export const askUserParameters = {
  questions: {
    type: 'array',
    required: true,
    description: 'Questions to ask the user before continuing.',
    items: {
      type: 'object',
      additionalProperties: true,
      properties: {
        id: {
          type: 'string',
          required: true,
          description: 'Stable id for this question; echoed in the answer.',
        },
        question: {
          type: 'string',
          required: true,
          description: 'The specific question to ask the user.',
        },
        header: {
          type: 'string',
          description: 'Optional short heading for the question, such as "Confirm" or "Choose Mode".',
        },
        options: {
          type: 'array',
          description:
            'Optional choices to show the user. If you recommend one, put it first and append "(Recommended)" to that label.',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              label: {
                type: 'string',
                required: true,
                description: 'Short user-facing option label.',
              },
              description: {
                type: 'string',
                description: 'One sentence explaining the tradeoff or impact.',
              },
            },
          },
        },
        multi_select: {
          type: 'boolean',
          description: 'Whether the user may select more than one option. Defaults to false.',
        },
      },
    },
  },
} as const satisfies ParameterSchemaSpec

export type AskUserArgs = InferArgs<typeof askUserParameters>

export class UserQuestionError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'UserQuestionError'
  }
}

/** 参数转成提问。DSL 表达不了的检查在这里：至少一道题，题目 id 不重复，同一题的选项标签不重复 */
export function readQuestions(args: AskUserArgs): Question[] {
  if (!args.questions.length) {
    throw new UserQuestionError('ask_user_question requires at least one question', 'EMPTY_QUESTIONS')
  }
  const ids = new Set<string>()
  return args.questions.map((item): Question => {
    if (ids.has(item.id)) {
      throw new UserQuestionError(
        `question id ${JSON.stringify(item.id)} must be unique within this call`,
        'BAD_QUESTIONS',
      )
    }
    ids.add(item.id)
    const options = item.options?.map(({ label, description }) => ({
      label,
      ...(description !== undefined ? { description } : {}),
    }))
    const labels = new Set(options?.map((option) => option.label))
    if (options && labels.size !== options.length) {
      throw new UserQuestionError(
        `option labels must be unique within question ${JSON.stringify(item.id)}`,
        'BAD_QUESTIONS',
      )
    }
    return {
      id: item.id,
      question: item.question,
      ...(item.header !== undefined ? { header: item.header } : {}),
      ...(options ? { options } : {}),
      ...(item.multi_select !== undefined ? { multiSelect: item.multi_select } : {}),
    }
  })
}

const compiledParameters = compileParameters(askUserParameters)

/** 日志里记录的参数：合法时返回提问；不合法的调用没有执行，也就没有问题可显示 */
export function questionsOf(input: unknown): Question[] | null {
  if (validateJsonSchemaValue(compiledParameters, input, '').length) return null
  try {
    return readQuestions(input as AskUserArgs)
  } catch {
    return null
  }
}

const RECOMMENDED = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i

/** 拆出标签末尾的推荐标记；回答里仍用原标签 */
export function parseRecommendedLabel(label: string): { label: string; recommended: boolean } {
  return RECOMMENDED.test(label)
    ? { label: label.replace(RECOMMENDED, ''), recommended: true }
    : { label, recommended: false }
}

/** 预选的选项：单选只看第一个，带推荐标记才选；多选选中所有带标记的 */
export function recommendedLabels(question: Question): string[] {
  const labels = (question.options ?? []).map((option) => option.label)
  return (question.multiSelect ? labels : labels.slice(0, 1)).filter(
    (label) => parseRecommendedLabel(label).recommended,
  )
}

export function initialDraft(question: Question): QuestionDraft {
  return { selected: recommendedLabels(question), custom: '', skipped: false, touched: false }
}

/** 草稿转成回答；还没答也没跳过时返回 undefined */
export function draftAnswer(question: Question, draft: QuestionDraft): QuestionAnswer | undefined {
  if (draft.skipped) return { id: question.id, selected: [] }
  const custom = draft.custom.trim()
  if (custom) {
    return { id: question.id, selected: question.multiSelect ? [...draft.selected] : [], custom }
  }
  return draft.selected.length ? { id: question.id, selected: [...draft.selected] } : undefined
}

/** 到点时的回答：用户动过且答完的题按草稿；其余的按推荐项，没有推荐就跳过，都标 auto */
export function timeoutAnswers(questions: Question[], drafts: QuestionDraft[]): QuestionAnswer[] {
  return questions.map((question, index) => {
    const draft = drafts[index] ?? initialDraft(question)
    const answer = draftAnswer(question, draft)
    if (draft.touched && answer) return answer
    const fallback = draft.touched ? undefined : answer
    return { ...(fallback ?? { id: question.id, selected: [] }), auto: true }
  })
}

const answerBatchSchema = compileValueSchema({
  type: 'object',
  additionalProperties: false,
  properties: {
    timedOut: { type: 'boolean', const: true },
    answers: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          selected: { type: 'array', required: true, items: { type: 'string' } },
          custom: { type: 'string' },
          auto: { type: 'boolean', const: true },
        },
      },
    },
  },
})

function badAnswer(message: string): UserQuestionError {
  return new UserQuestionError(message, 'BAD_ANSWER')
}

/**
 * 校验卡片交来的一批回答：格式正确，每道题恰好一条，选的是这道题的选项，
 * 单选最多选一个、自由文本和选项不能同时给。返回按提问顺序排好的回答。
 */
export function checkAnswers(questions: Question[], batch: unknown): QuestionAnswer[] {
  const violations = validateJsonSchemaValue(answerBatchSchema, batch, 'answer')
  if (violations.length) throw badAnswer(`invalid answer: ${violations.join('; ')}`)
  const { answers } = batch as AnswerBatch
  const byId = new Map(answers.map((answer) => [answer.id, answer]))
  if (
    byId.size !== answers.length ||
    answers.length !== questions.length ||
    !questions.every((question) => byId.has(question.id))
  ) {
    throw badAnswer(`the answer batch must name each of its ${questions.length} questions exactly once`)
  }
  return questions.map((question) => {
    const answer = byId.get(question.id)!
    const labels = new Set(question.options?.map((option) => option.label))
    if (
      new Set(answer.selected).size !== answer.selected.length ||
      answer.selected.some((label) => !labels.has(label))
    ) {
      throw badAnswer(`answer ${JSON.stringify(question.id)} selects labels that are not its options`)
    }
    const custom = answer.custom?.trim()
    if (!question.multiSelect && (answer.selected.length > 1 || (custom && answer.selected.length))) {
      throw badAnswer(
        `answer ${JSON.stringify(question.id)} must select one option or give custom text, not both`,
      )
    }
    return { id: question.id, selected: [...answer.selected], ...(custom ? { custom } : {}) }
  })
}

/** 工具结果里的回答；不是回答（比如失败信息）时返回 null */
export function answerBatchOf(content: string): AnswerBatch | null {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return null
  }
  return validateJsonSchemaValue(answerBatchSchema, value).length ? null : (value as AnswerBatch)
}

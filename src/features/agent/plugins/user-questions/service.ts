/**
 * ctx.userQuestions：工具调用挂起，等用户在卡片上回答。
 *
 * 同一时间只有一个等待中的提问（循环里工具按顺序执行）。计时和草稿都在这里，
 * 不在界面里：面板关着也会到点，重新打开草稿还在。到点时按草稿提交，
 * 用户没动过的题用推荐项，并标出哪些是自动提交的。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { userQuestionsProjection } from './projection'
import { checkAnswers, initialDraft, timeoutAnswers, UserQuestionError } from './questions'
import type { AnswerBatch, PendingQuestion, Question, QuestionDraft } from './types'

/** 默认等待上限：10 分钟 */
export const DEFAULT_QUESTION_TIMEOUT_MS = 600_000

export interface UserQuestionsConfig {
  /** 等待上限（ms），到点按推荐项自动提交 */
  timeoutMs?: number
}

export interface AskRequest {
  sessionId: string
  callId: string
  questions: Question[]
  /** 停止这一轮时取消等待 */
  signal: AbortSignal
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    userQuestions: UserQuestionService
  }
  interface Events {
    /** 出现、回答或取消了等待中的提问 */
    'user-questions/changed': (pending: PendingQuestion | null) => void
  }
}

interface Wait {
  pending: PendingQuestion
  resolve(batch: AnswerBatch): void
  reject(error: Error): void
  release(): void
}

function aborted(): UserQuestionError {
  return new UserQuestionError('ask_user_question was aborted before the user answered', 'ASK_ABORTED')
}

export class UserQuestionService extends Service {
  static inject = ['sessionProjections']

  readonly timeoutMs: number
  private wait?: Wait

  constructor(ctx: Context, config: UserQuestionsConfig = {}) {
    super(ctx, 'userQuestions')
    const timeoutMs = config.timeoutMs ?? DEFAULT_QUESTION_TIMEOUT_MS
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
      throw new Error('userQuestions.timeoutMs must be a positive integer that fits a timer')
    }
    this.timeoutMs = timeoutMs
    ctx.effect(() => ctx.sessionProjections.register(userQuestionsProjection))
    ctx.effect(() => () => this.close(aborted()))
  }

  /** 等待中的提问，没有时为 null；返回副本 */
  current(): PendingQuestion | null {
    return this.wait ? structuredClone(this.wait.pending) : null
  }

  /** 挂起直到用户提交、到点自动提交，或这一轮被停止 */
  ask(request: AskRequest): Promise<AnswerBatch> {
    if (request.signal.aborted) return Promise.reject(aborted())
    if (!request.questions.length) {
      return Promise.reject(
        new UserQuestionError('ask_user_question requires at least one question', 'EMPTY_QUESTIONS'),
      )
    }
    if (this.wait) {
      return Promise.reject(
        new UserQuestionError('another question is still waiting for an answer', 'ASK_BUSY'),
      )
    }
    return new Promise<AnswerBatch>((resolve, reject) => {
      const onAbort = () => this.close(aborted())
      const timer = setTimeout(() => this.expire(), this.timeoutMs)
      request.signal.addEventListener('abort', onAbort, { once: true })
      this.wait = {
        pending: {
          sessionId: request.sessionId,
          callId: request.callId,
          questions: structuredClone(request.questions),
          deadline: Date.now() + this.timeoutMs,
          timeoutMs: this.timeoutMs,
          drafts: request.questions.map(initialDraft),
        },
        resolve,
        reject,
        release: () => {
          clearTimeout(timer)
          request.signal.removeEventListener('abort', onAbort)
        },
      }
      this.changed()
    })
  }

  /** 记下卡片上的草稿，到点时按它提交；不通知界面，界面自己持有同一份 */
  saveDrafts(callId: string, drafts: QuestionDraft[]): void {
    const pending = this.wait?.pending
    if (pending?.callId !== callId || drafts.length !== pending.questions.length) return
    pending.drafts = structuredClone(drafts)
  }

  /** 用户提交。回答不合法时抛 BAD_ANSWER，等待继续 */
  answer(callId: string, batch: unknown): void {
    const pending = this.wait?.pending
    if (pending?.callId !== callId) {
      throw new UserQuestionError('this question is no longer waiting for an answer', 'NOT_WAITING')
    }
    this.settle({ answers: checkAnswers(pending.questions, batch) })
  }

  private expire(): void {
    const pending = this.wait?.pending
    if (pending) this.settle({ timedOut: true, answers: timeoutAnswers(pending.questions, pending.drafts) })
  }

  private settle(batch: AnswerBatch): void {
    const wait = this.wait!
    this.wait = undefined
    wait.release()
    wait.resolve(batch)
    this.changed()
  }

  private close(error: Error): void {
    const wait = this.wait
    if (!wait) return
    this.wait = undefined
    wait.release()
    wait.reject(error)
    this.changed()
  }

  private changed(): void {
    this.ctx.emit('user-questions/changed', this.current())
  }
}

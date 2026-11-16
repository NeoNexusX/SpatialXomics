/**
 * ask_user_question：模型需要用户确认、选择或补充信息时提问，等用户回答后继续。
 * 回答作为普通工具结果回给模型；等待上限由 ctx.userQuestions 决定，到点按推荐项提交。
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, TOOL_RESULT_CHARS_EVIDENCE } from '../tools'
import { ASK_USER_QUESTION, askUserParameters, readQuestions } from '../user-questions'

export const name = 'tool-ask-user'
export const inject = ['tools', 'userQuestions']

/** 计时由服务负责，工具超时只是兜底，比等待上限多留一点余量 */
const TIMEOUT_MARGIN_MS = 10_000

function description(timeoutMs: number): string {
  const minutes = Math.max(1, Math.round(timeoutMs / 60_000))
  return (
    'Ask the user a concise question when you need confirmation, a choice, or missing information before proceeding. ' +
    `Questions left unanswered for ${minutes} minute${minutes === 1 ? '' : 's'} are submitted automatically with the recommended options. ` +
    'An answer item with empty selected and no custom means the user skipped that question: continue without it, do not ask it again, and do not treat the skip as permission. ' +
    'An answer item with "auto": true was filled in automatically, not chosen by the user: say that you proceeded with the default. ' +
    '"timedOut": true means the user did not respond in time: do not ask again in this turn.'
  )
}

export function apply(ctx: Context) {
  const { timeoutMs } = ctx.userQuestions
  ctx.tools.register(
    defineTool({
      name: ASK_USER_QUESTION,
      category: 'interaction',
      description: description(timeoutMs),
      parameters: askUserParameters,
      timeoutMs: timeoutMs + TIMEOUT_MARGIN_MS,
      // 回答是用户的原话，不截断
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE * 4,
      output: { render: (_args, batch) => JSON.stringify(batch) },
      async execute(args, exec) {
        const questions = readQuestions(args)
        if (!exec.session) throw new Error('ask_user_question needs an open conversation')
        return ctx.userQuestions.ask({
          sessionId: exec.session.storage.id,
          callId: exec.callId,
          questions,
          signal: exec.signal,
        })
      },
    }),
  )
}

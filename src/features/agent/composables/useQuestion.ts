/**
 * useQuestion：ctx.userQuestions 的 Vue 桥（模块级单例）。
 * 等待中的提问由服务持有；卡片改了草稿就存回服务，面板关了再打开能接着答，到点也按它提交。
 */

import { shallowRef } from 'vue'
import type {
  AnswerBatch,
  PendingQuestion,
  QuestionDraft,
  UserQuestionService,
} from '../plugins/user-questions'
import { whenAgentReady } from '../bootstrap'

const pending = shallowRef<PendingQuestion | null>(null)
let service: UserQuestionService | undefined
let bound = false

function bind(): void {
  if (bound) return
  bound = true
  void whenAgentReady()
    .then((ctx) => {
      service = ctx.userQuestions
      pending.value = service.current()
      ctx.on('user-questions/changed', (next) => {
        pending.value = next
      })
    })
    // 启动失败由 useAgent 报告
    .catch(() => {})
}

export function useQuestion() {
  bind()

  function saveDrafts(drafts: QuestionDraft[]): void {
    const current = pending.value
    if (!current || !service) return
    service.saveDrafts(current.callId, drafts)
    pending.value = { ...current, drafts }
  }

  /** 交给服务校验；回答不合法时抛错，提问继续等待 */
  function submit(batch: AnswerBatch): void {
    const current = pending.value
    if (!current || !service) throw new Error('No question is waiting for an answer')
    service.answer(current.callId, batch)
  }

  return { pending, saveDrafts, submit }
}

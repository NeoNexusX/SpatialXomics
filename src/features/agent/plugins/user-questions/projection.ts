/** 每次提问在对话里的记录：问题来自工具调用的参数，回答来自工具结果 */

import type { SessionProjectionDefinition } from '../session-projection'
import { answerBatchOf, ASK_USER_QUESTION, questionsOf } from './questions'
import type { QuestionRecord } from './types'

/** 按调用的 callKey 索引，和对话里工具步骤的 id 相同 */
export type QuestionRecords = Record<string, QuestionRecord>

export const userQuestionsProjection: SessionProjectionDefinition<QuestionRecords, QuestionRecords> = {
  key: 'userQuestions',
  init: () => ({}),
  apply: (records, event) => {
    switch (event.type) {
      case 'turn/start':
        // 重新生成的那一轮从对话里消失，它的提问记录也一起去掉
        if (event.retryOf) {
          for (const [key, record] of Object.entries(records)) {
            if (record.turnId === event.retryOf) delete records[key]
          }
        }
        break
      case 'tool/start': {
        if (event.name !== ASK_USER_QUESTION) break
        const questions = questionsOf(event.input)
        if (questions) {
          records[event.callKey] = {
            callKey: event.callKey,
            turnId: event.turnId,
            questions,
            state: 'waiting',
          }
        }
        break
      }
      case 'message': {
        const record = event.callKey ? records[event.callKey] : undefined
        if (!record || event.message.role !== 'tool') break
        const batch = event.message.isError ? null : answerBatchOf(event.message.content)
        records[record.callKey] = batch
          ? {
              ...record,
              state: 'answered',
              answers: batch.answers,
              ...(batch.timedOut ? { timedOut: true } : {}),
            }
          : { ...record, state: 'unanswered' }
        break
      }
      case 'turn/end':
        for (const record of Object.values(records)) {
          if (record.turnId === event.turnId && record.state === 'waiting') record.state = 'unanswered'
        }
        break
    }
    return records
  },
  view: (records) => records,
}

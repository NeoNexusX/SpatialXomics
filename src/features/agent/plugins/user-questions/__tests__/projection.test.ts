import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '../../session'
import { userQuestionsProjection, type QuestionRecords } from '..'

let seq = 0
const event = (payload: Record<string, unknown>) =>
  ({ ...payload, seq: seq++, id: `e${seq}`, time: 0 }) as unknown as SessionEvent

const ask = (callKey: string, input: unknown, turnId = 't1') =>
  event({ type: 'tool/start', turnId, callKey, callId: `id-${callKey}`, name: 'ask_user_question', input })

const result = (callKey: string, content: string, isError = false, turnId = 't1') =>
  event({
    type: 'message',
    turnId,
    callKey,
    message: { role: 'tool', toolCallId: `id-${callKey}`, name: 'ask_user_question', content, isError },
  })

function fold(events: SessionEvent[]): QuestionRecords {
  return events.reduce(userQuestionsProjection.apply, userQuestionsProjection.init())
}

const input = { questions: [{ id: 'k', question: 'How many clusters?', options: [{ label: '5' }] }] }
const questions = [{ id: 'k', question: 'How many clusters?', options: [{ label: '5' }] }]

describe('userQuestions projection', () => {
  it('records a valid call as waiting and fills in the answer from the result', () => {
    expect(fold([ask('3:0', input)])).toEqual({
      '3:0': { callKey: '3:0', turnId: 't1', questions, state: 'waiting' },
    })
    expect(
      fold([
        ask('3:0', input),
        result('3:0', '{"timedOut":true,"answers":[{"id":"k","selected":["5"],"auto":true}]}'),
      ]),
    ).toEqual({
      '3:0': {
        callKey: '3:0',
        turnId: 't1',
        questions,
        state: 'answered',
        answers: [{ id: 'k', selected: ['5'], auto: true }],
        timedOut: true,
      },
    })
  })

  it('marks a call that ended without an answer as unanswered', () => {
    const interrupted = fold([
      ask('3:0', input),
      result('3:0', 'TOOL_OUTCOME_UNKNOWN: interrupted; this operation was not automatically repeated.', true),
    ])
    expect(interrupted['3:0']!.state).toBe('unanswered')
    const stopped = fold([ask('3:0', input), event({ type: 'turn/end', turnId: 't1', reason: 'interrupted' })])
    expect(stopped['3:0']!.state).toBe('unanswered')
  })

  it('ignores calls whose arguments never reached the tool and other tools', () => {
    expect(fold([ask('3:0', { questions: [{ id: 'k' }] })])).toEqual({})
    expect(
      fold([
        event({ type: 'tool/start', turnId: 't1', callKey: '3:0', callId: 'x', name: 'get_page', input: {} }),
        result('3:0', '{"answers":[]}'),
      ]),
    ).toEqual({})
  })

  it('drops the records of a turn that was regenerated', () => {
    const records = fold([
      ask('3:0', input, 't1'),
      result('3:0', '{"answers":[{"id":"k","selected":["5"]}]}', false, 't1'),
      event({ type: 'turn/start', turnId: 't2', retryOf: 't1' }),
      ask('9:0', input, 't2'),
    ])
    expect(Object.keys(records)).toEqual(['9:0'])
  })
})

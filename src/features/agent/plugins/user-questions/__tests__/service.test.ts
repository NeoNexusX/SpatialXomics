import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionProjections } from '../../session-projection'
import { UserQuestionService, type PendingQuestion, type Question } from '..'

const questions: Question[] = [
  {
    id: 'adduct',
    question: 'Which adduct?',
    options: [{ label: '[M+H]+ (Recommended)' }, { label: '[M+Na]+' }],
  },
  { id: 'note', question: 'Anything else?' },
]

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function setup(timeoutMs = 60_000) {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.plugin(SessionProjections)
  ctx.plugin(UserQuestionService, { timeoutMs })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const changes: (PendingQuestion | null)[] = []
  ctx.on('user-questions/changed', (pending) => changes.push(pending))
  return { ctx, service: ctx.userQuestions, changes }
}

function ask(service: UserQuestionService, signal = new AbortController().signal) {
  return service.ask({ sessionId: 's1', callId: 'call-1', questions, signal })
}

describe('UserQuestionService', () => {
  it('waits for the answer and returns it in question order', async () => {
    const { service, changes } = await setup()
    const asked = ask(service)
    const pending = service.current()!
    expect(pending).toMatchObject({ sessionId: 's1', callId: 'call-1', questions, timeoutMs: 60_000 })
    expect(pending.drafts).toEqual([
      { selected: ['[M+H]+ (Recommended)'], custom: '', skipped: false, touched: false },
      { selected: [], custom: '', skipped: false, touched: false },
    ])
    expect(pending.deadline - Date.now()).toBeGreaterThan(59_000)
    service.answer('call-1', {
      answers: [
        { id: 'note', selected: [] },
        { id: 'adduct', selected: ['[M+Na]+'] },
      ],
    })
    await expect(asked).resolves.toEqual({
      answers: [
        { id: 'adduct', selected: ['[M+Na]+'] },
        { id: 'note', selected: [] },
      ],
    })
    expect(service.current()).toBeNull()
    expect(changes.map((change) => change?.callId ?? null)).toEqual(['call-1', null])
  })

  it('keeps waiting after a rejected answer', async () => {
    const { service } = await setup()
    const asked = ask(service)
    expect(() => service.answer('call-1', { answers: [{ id: 'adduct', selected: ['[M+K]+'] }] })).toThrow(
      'the answer batch must name each of its 2 questions exactly once',
    )
    expect(() => service.answer('other', { answers: [] })).toThrow(
      'this question is no longer waiting for an answer',
    )
    expect(service.current()).not.toBeNull()
    service.answer('call-1', {
      answers: [
        { id: 'adduct', selected: [] },
        { id: 'note', selected: [], custom: 'none' },
      ],
    })
    await expect(asked).resolves.toMatchObject({ answers: [{ id: 'adduct' }, { id: 'note' }] })
  })

  it('submits the saved drafts and the recommendations when the wait runs out', async () => {
    const { service } = await setup(20)
    const asked = ask(service)
    service.saveDrafts('call-1', [
      { selected: ['[M+H]+ (Recommended)'], custom: '', skipped: false, touched: false },
      { selected: [], custom: 'only the cortex', skipped: false, touched: true },
    ])
    await expect(asked).resolves.toEqual({
      timedOut: true,
      answers: [
        { id: 'adduct', selected: ['[M+H]+ (Recommended)'], auto: true },
        { id: 'note', selected: [], custom: 'only the cortex' },
      ],
    })
    expect(service.current()).toBeNull()
  })

  it('ignores drafts for another call or of the wrong length', async () => {
    const { service } = await setup()
    ask(service).catch(() => {})
    service.saveDrafts('other', [])
    service.saveDrafts('call-1', [{ selected: [], custom: 'x', skipped: false, touched: true }])
    expect(service.current()!.drafts[1]).toEqual({ selected: [], custom: '', skipped: false, touched: false })
  })

  it('stops waiting when the turn is stopped or the service unloads', async () => {
    const { ctx, service } = await setup()
    const controller = new AbortController()
    const stopped = ask(service, controller.signal)
    controller.abort()
    await expect(stopped).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    expect(service.current()).toBeNull()

    const unloaded = ask(service)
    await ctx.fiber.dispose()
    await expect(unloaded).rejects.toThrow('ask_user_question was aborted before the user answered')
  })

  it('refuses a second question while one is waiting, and an empty one', async () => {
    const { service } = await setup()
    ask(service).catch(() => {})
    await expect(ask(service)).rejects.toMatchObject({ code: 'ASK_BUSY' })
    service.answer('call-1', {
      answers: [
        { id: 'adduct', selected: [] },
        { id: 'note', selected: [] },
      ],
    })
    await expect(
      service.ask({ sessionId: 's1', callId: 'c2', questions: [], signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: 'EMPTY_QUESTIONS' })
  })

  it('does not start with a timeout a timer cannot hold', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    ctx.plugin(SessionProjections)
    const fiber = ctx.plugin(UserQuestionService, { timeoutMs: 0 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    // cordis 的 FiberState.FAILED
    expect(fiber.state).toBe(3)
  })
})

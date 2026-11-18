import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionProjections } from '../../session-projection'
import { SystemPrompt } from '../../system-prompt'
import { ToolRuntime } from '../../tools'
import { UserQuestionService } from '../../user-questions'
import type { Session } from '../../session'
import * as askUser from '..'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function setup(timeoutMs = 600_000) {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.plugin(SystemPrompt)
  ctx.plugin(ToolRuntime)
  ctx.plugin(SessionProjections)
  ctx.plugin(UserQuestionService, { timeoutMs })
  ctx.plugin(askUser)
  await new Promise((resolve) => setTimeout(resolve, 0))
  return ctx
}

const session = { storage: { id: 's1' } } as unknown as Session

function run(ctx: Context, args: unknown, signal = new AbortController().signal) {
  return ctx.tools.execute({ callId: 'call-1', name: 'ask_user_question', arguments: args, signal, session })
}

describe('ask_user_question', () => {
  it('sends the question schema with nested required fields', async () => {
    const ctx = await setup()
    const [schema] = ctx.tools.schemas()
    expect(schema!.description).toContain('submitted automatically with the recommended options')
    expect(schema!.description).toContain('10 minutes')
    expect(schema!.parameters.required).toEqual(['questions'])
    expect(schema!.parameters.properties.questions).toMatchObject({
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        required: ['id', 'question'],
        properties: {
          options: { items: { additionalProperties: true, required: ['label'] } },
          multi_select: { type: 'boolean' },
        },
      },
    })
  })

  it('returns the user answer as compact JSON', async () => {
    const ctx = await setup()
    const running = run(ctx, {
      questions: [{ id: 'k', question: 'How many clusters?', options: [{ label: '5 (Recommended)' }, { label: '8' }] }],
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(ctx.userQuestions.current()).toMatchObject({ sessionId: 's1', callId: 'call-1' })
    ctx.userQuestions.answer('call-1', { answers: [{ id: 'k', selected: ['8'] }] })
    expect(await running).toMatchObject({
      isError: false,
      content: '{"answers":[{"id":"k","selected":["8"]}]}',
    })
  })

  it('submits the recommendation and says so when nobody answers', async () => {
    const ctx = await setup(20)
    const result = await run(ctx, {
      questions: [{ id: 'k', question: 'How many clusters?', options: [{ label: '5 (Recommended)' }] }],
    })
    expect(result.content).toBe('{"timedOut":true,"answers":[{"id":"k","selected":["5 (Recommended)"],"auto":true}]}')
    expect(ctx.tools.schemas()[0]!.description).toContain('1 minute are submitted')
  })

  it('reports invalid questions to the model without asking the user', async () => {
    const ctx = await setup()
    expect((await run(ctx, { questions: [{ id: 'k' }] })).content).toBe(
      'Error: invalid arguments: missing required property "questions[0].question"',
    )
    expect(
      (await run(ctx, { questions: [{ id: 'k', question: 'a' }, { id: 'k', question: 'b' }] })).content,
    ).toBe('Error: question id "k" must be unique within this call')
    expect((await run(ctx, { questions: [] })).content).toBe(
      'Error: ask_user_question requires at least one question',
    )
    expect(ctx.userQuestions.current()).toBeNull()
  })
})

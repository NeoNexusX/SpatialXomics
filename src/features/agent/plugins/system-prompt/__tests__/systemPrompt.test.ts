import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt, type PromptContext } from '../index'

const context = { binding: { datasetId: 'd', generation: 1, page: {} } } as PromptContext

async function setup() {
  const ctx = new Context()
  ctx.plugin(SystemPrompt)
  await new Promise((resolve) => setTimeout(resolve, 0))
  return ctx
}

describe('system prompt registry', () => {
  it('orders sections by order, then key, and drops empty ones', async () => {
    const ctx = await setup()
    ctx.systemPrompt.section({ key: 'b', order: 10, render: () => 'second' })
    ctx.systemPrompt.section({ key: 'a', order: 10, render: () => 'first' })
    ctx.systemPrompt.section({ key: 'empty', order: 5, render: () => '' })
    ctx.systemPrompt.section({ key: 'z', order: 0, render: () => 'zero' })
    expect(ctx.systemPrompt.render(context)).toBe('zero\n\nfirst\n\nsecond')
  })

  it('passes the prompt context to each section', async () => {
    const ctx = await setup()
    ctx.systemPrompt.section({
      key: 'dataset',
      order: 0,
      render: ({ binding }) => binding.datasetId,
    })
    expect(ctx.systemPrompt.render(context)).toBe('d')
  })

  it('rejects a duplicate key', async () => {
    const ctx = await setup()
    ctx.systemPrompt.section({ key: 'a', order: 0, render: () => '' })
    expect(() => ctx.systemPrompt.section({ key: 'a', order: 1, render: () => '' })).toThrow(
      'Duplicate prompt section a',
    )
  })
})

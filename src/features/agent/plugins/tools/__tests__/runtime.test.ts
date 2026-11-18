import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt } from '../../system-prompt'
import { defineTool, ToolRuntime } from '..'

async function setup() {
  const ctx = new Context()
  ctx.plugin(SystemPrompt)
  ctx.plugin(ToolRuntime)
  await new Promise((resolve) => setTimeout(resolve, 0))
  ctx.tools.register(
    defineTool({
      name: 'echo',
      description: '',
      parameters: { value: { type: 'string', required: true } },
      async execute(args) {
        return args.value
      },
    }),
  )
  return ctx
}

function call(name: string, args: unknown, signal = new AbortController().signal) {
  return { callId: 'c1', name, arguments: args, signal }
}

describe('ToolRuntime', () => {
  it('turns every failure into an Error: result the model can act on', async () => {
    const ctx = await setup()
    expect(await ctx.tools.execute(call('missing', {}))).toEqual({
      isError: true,
      error: { message: 'unknown tool "missing"', code: 'UNKNOWN_TOOL' },
      content: 'Error: unknown tool "missing"',
    })
    expect(await ctx.tools.execute(call('echo', { value: 1 }))).toEqual({
      isError: true,
      error: { message: 'invalid arguments: "value" must be a string', code: 'INVALID_ARGS' },
      content: 'Error: invalid arguments: "value" must be a string',
    })
    ctx.tools.register(
      defineTool({
        name: 'broken',
        description: '',
        parameters: {},
        async execute() {
          throw Object.assign(new Error('upstream refused'), { code: 'HTTP_403' })
        },
      }),
    )
    expect(await ctx.tools.execute(call('broken', {}))).toEqual({
      isError: true,
      error: { message: 'upstream refused', code: 'HTTP_403' },
      content: 'Error: upstream refused',
    })
  })

  it('runs the gate before validating, with the same frozen arguments the tool gets', async () => {
    const ctx = await setup()
    const seen: unknown[] = []
    ctx.on('tools/pre-execute', (exec) => {
      seen.push(exec.arguments)
      return { kind: 'deny', reason: 'blocked by policy' }
    })
    const args = { value: 1 }
    expect(await ctx.tools.execute(call('echo', args))).toEqual({
      isError: true,
      error: { message: 'blocked by policy', code: 'DENIED' },
      content: 'Error: blocked by policy',
    })
    expect(seen).toEqual([args])
    expect(seen[0]).not.toBe(args)
    expect(Object.isFrozen(seen[0])).toBe(true)
  })

  it('does not let a tool change its arguments', async () => {
    const ctx = await setup()
    ctx.tools.register(
      defineTool({
        name: 'mutate',
        description: '',
        parameters: { items: { type: 'array', items: { type: 'string' } } },
        async execute(args) {
          ;(args.items as string[]).push('extra')
          return 'changed'
        },
      }),
    )
    const args = { items: ['a'] }
    const result = await ctx.tools.execute(call('mutate', args))
    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/^Error: /)
    expect(args.items).toEqual(['a'])
  })

  it('reports a timeout and each kind of cancellation by its own code', async () => {
    const ctx = await setup()
    let entered!: () => void
    const started = new Promise<void>((resolve) => (entered = resolve))
    ctx.tools.register(
      defineTool({
        name: 'hang',
        description: '',
        parameters: {},
        timeoutMs: 10,
        execute: () => new Promise<never>(() => {}),
      }),
    )
    ctx.tools.register(
      defineTool({
        name: 'block',
        description: '',
        parameters: {},
        execute: () => {
          entered()
          return new Promise<never>(() => {})
        },
      }),
    )
    expect(await ctx.tools.execute(call('hang', {}))).toEqual({
      isError: true,
      error: { message: 'tool call timed out after 10ms', code: 'TOOL_TIMEOUT' },
      content: 'Error: tool call timed out after 10ms',
    })

    const cancelled = new AbortController()
    cancelled.abort()
    expect(await ctx.tools.execute(call('hang', {}, cancelled.signal))).toEqual({
      isError: true,
      error: { message: 'tool call aborted before dispatch', code: 'ABORTED_BEFORE_DISPATCH' },
      content: 'Error: tool call aborted before dispatch',
    })

    const controller = new AbortController()
    const running = ctx.tools.execute(call('block', {}, controller.signal))
    await started
    controller.abort()
    expect(await running).toEqual({
      isError: true,
      error: { message: 'tool call aborted', code: 'ABORTED' },
      content: 'Error: tool call aborted',
    })
  })

  it('truncates a long result and keeps the full text for the archive', async () => {
    const ctx = await setup()
    ctx.tools.register(
      defineTool({
        name: 'long',
        description: '',
        parameters: {},
        maxResultChars: 500,
        async execute() {
          return 'x'.repeat(2000)
        },
      }),
    )
    const result = await ctx.tools.execute(call('long', {}))
    expect(result.isError).toBe(false)
    expect(result.content.length).toBeLessThanOrEqual(500)
    expect(result.content.endsWith('…[truncated]')).toBe(true)
    expect(result.fullContent).toHaveLength(2000)
  })
})

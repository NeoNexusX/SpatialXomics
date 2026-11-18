import { describe, expect, it, vi } from 'vitest'
import { defineTool, toToolSchema, ToolArgsError, type ToolRunContext } from '../defineTool'

const exec: ToolRunContext = {
  signal: new AbortController().signal,
  callId: 'c1',
  name: 'echo',
  arguments: {},
}

describe('defineTool', () => {
  it('compiles the parameter schema once and sends exactly that schema to the model', () => {
    const tool = defineTool({
      name: 'echo',
      description: 'Echo back the input.',
      parameters: {
        message: { type: 'string', required: true, description: 'The message to echo.' },
        repeat: { type: 'integer' },
      },
      async execute(args) {
        return args.message
      },
    })
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The message to echo.' },
        repeat: { type: 'integer' },
      },
      required: ['message'],
    })
    const schema = toToolSchema(tool)
    expect(schema).toEqual({
      name: 'echo',
      description: 'Echo back the input.',
      parameters: tool.parameters,
    })
    // 每次请求拿到的是副本，下游改了也不影响注册表
    expect(schema.parameters).not.toBe(tool.parameters)
  })

  it('fails at definition time when the schema is written wrong', () => {
    expect(() =>
      defineTool({
        name: 'bad',
        description: '',
        parameters: { filter: { type: 'object', properties: {} } } as never,
        async execute() {},
      }),
    ).toThrow('parameters.filter.additionalProperties must be explicitly true or false')
  })

  it('rejects a timeout that is not a positive finite number', () => {
    for (const timeoutMs of [0, -1, Number.POSITIVE_INFINITY]) {
      expect(() =>
        defineTool({ name: 'slow', description: '', parameters: {}, timeoutMs, async execute() {} }),
      ).toThrow('defineTool(slow): timeoutMs must be a positive finite number')
    }
  })

  it('validates arguments before running the body', async () => {
    const body = vi.fn(async (args: { value: string }) => args.value)
    const tool = defineTool({
      name: 'echo',
      description: '',
      parameters: { value: { type: 'string', required: true } },
      execute: body,
    })
    const failure = tool.execute({ value: 1 }, exec)
    await expect(failure).rejects.toBeInstanceOf(ToolArgsError)
    await expect(failure).rejects.toMatchObject({
      message: 'invalid arguments: "value" must be a string',
      code: 'INVALID_ARGS',
      violations: ['"value" must be a string'],
    })
    expect(body).not.toHaveBeenCalled()
    await expect(tool.execute({ value: 'x' }, exec)).resolves.toBe('x')
  })

  it('passes undeclared root keys through to the body', async () => {
    const tool = defineTool({
      name: 'open',
      description: '',
      parameters: {},
      async execute(args) {
        return args
      },
    })
    await expect(tool.execute({ note: 'kept' }, exec)).resolves.toEqual({ note: 'kept' })
  })

  it('gives external evidence tools the same Inline Citation contract the UI renders', () => {
    for (const category of ['chemistry', 'biology', 'literature', 'web'] as const) {
      const tool = defineTool({
        name: 'source',
        category,
        description: 'Look up evidence.',
        parameters: {},
        async execute() {
          return ''
        },
      })
      const schema = toToolSchema(tool)
      expect(schema.description).toContain('[source title](URL)')
      expect(schema.description).toContain('Inline Citation')
      expect(schema.description).toContain('retrieved source URLs or identifiers')
    }
  })
})

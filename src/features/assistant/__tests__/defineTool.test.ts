import { describe, expect, it } from 'vitest'
import { defineTool, validateArgs, toToolSchema, renderBatch } from '../tools/defineTool'

describe('defineTool + validateArgs', () => {
  const echoTool = defineTool({
    name: 'echo',
    description: 'Echo back the input',
    parameters: {
      message: { type: 'string', required: true, description: 'The message to echo' },
    },
    output: { render: (args) => `echo: ${args.message}` },
    async execute(args) {
      return args.message
    },
  })

  it('validates required fields', () => {
    const result = validateArgs(echoTool, {})
    expect(result.valid).toBe(false)
    expect(!result.valid && result.errors[0]!.field).toBe('message')
  })

  it('validates correct args', () => {
    const result = validateArgs(echoTool, { message: 'hello' })
    expect(result.valid).toBe(true)
    expect(result.valid && result.args.message).toBe('hello')
  })

  it('validates enum constraints', () => {
    const tool = defineTool({
      name: 'pick',
      description: 'Pick a color',
      parameters: {
        color: { type: 'string', required: true, enum: ['red', 'blue'] },
      },
      output: { render: (a) => a.color },
      async execute() { return null },
    })

    const ok = validateArgs(tool, { color: 'red' })
    expect(ok.valid).toBe(true)

    const bad = validateArgs(tool, { color: 'green' })
    expect(bad.valid).toBe(false)
  })

  it('validates numeric types', () => {
    const tool = defineTool({
      name: 'add',
      description: 'Add two numbers',
      parameters: {
        a: { type: 'number', required: true },
        b: { type: 'integer', required: false },
      },
      output: { render: () => '' },
      async execute() { return null },
    })

    const ok = validateArgs(tool, { a: 1.5, b: 3.2 })
    expect(ok.valid).toBe(true)
    expect(ok.valid && ok.args.a).toBe(1.5)
    expect(ok.valid && ok.args.b).toBe(3) // integer 截断

    const bad = validateArgs(tool, { a: 'not-a-number' })
    expect(bad.valid).toBe(false)
  })

  it('validates boolean types', () => {
    const tool = defineTool({
      name: 'flag',
      description: 'Toggle',
      parameters: { verbose: { type: 'boolean', required: true } },
      output: { render: () => '' },
      async execute() { return null },
    })

    expect(validateArgs(tool, { verbose: true }).valid).toBe(true)
    expect(validateArgs(tool, { verbose: false }).valid).toBe(true)
    expect(validateArgs(tool, { verbose: 'yes' }).valid).toBe(false)
  })

  it('validates array params: element types, integer flooring, maxItems truncation', () => {
    const tool = defineTool({
      name: 'batch',
      description: 'Batch lookup',
      parameters: {
        names: { type: 'array', items: 'string', required: true, maxItems: 3 },
        rowIds: { type: 'array', items: 'integer' },
      },
      output: { render: () => '' },
      async execute() { return null },
    })

    // 字符串数组 + maxItems 截断（4 → 3，静默）
    const ok = validateArgs(tool, { names: ['a', 'b', 'c', 'd'], rowIds: [1.7, 2] })
    expect(ok.valid).toBe(true)
    expect(ok.valid && ok.args.names).toEqual(['a', 'b', 'c'])
    expect(ok.valid && ok.args.rowIds).toEqual([1, 2]) // integer 逐元素截断

    // 非数组 / 元素类型错误
    expect(validateArgs(tool, { names: 'a' }).valid).toBe(false)
    expect(validateArgs(tool, { names: ['a', 1] }).valid).toBe(false)
    expect(validateArgs(tool, { names: ['a'], rowIds: ['x'] }).valid).toBe(false)
  })

  it('emits JSON Schema array items/maxItems in toToolSchema', () => {
    const tool = defineTool({
      name: 'batch',
      description: 'Batch lookup',
      parameters: {
        names: { type: 'array', items: 'string', required: true, maxItems: 20 },
        mzs: { type: 'array', items: 'number' },
      },
      output: { render: () => '' },
      async execute() { return null },
    })
    const schema = toToolSchema(tool)
    expect(schema.parameters.properties.names).toEqual({
      type: 'array',
      items: { type: 'string' },
      maxItems: 20,
    })
    expect(schema.parameters.properties.mzs).toEqual({ type: 'array', items: { type: 'number' } })
    expect(schema.parameters.required).toContain('names')
  })

  it('converts to ToolSchema for LLM function calling', () => {
    const schema = toToolSchema(echoTool)
    expect(schema.name).toBe('echo')
    expect(schema.description).toBe('Echo back the input')
    expect(schema.parameters.type).toBe('object')
    expect(schema.parameters.required).toContain('message')
    expect(schema.parameters.properties.message?.type).toBe('string')
  })

  it('rejects null/undefined input', () => {
    expect(validateArgs(echoTool, null).valid).toBe(false)
    expect(validateArgs(echoTool, undefined).valid).toBe(false)
  })
})

describe('renderBatch（批量工具输出拼接）', () => {
  it('单项时输出不加节标题（与旧版单查一致）', async () => {
    const out = await renderBatch(['glucose'], (q) => q, (q) => `result of ${q}`)
    expect(out).toBe('result of glucose')
    expect(out).not.toContain('###')
  })

  it('多项时逐项加 ### 节标题', async () => {
    const out = await renderBatch(
      ['glucose', 'palmitic acid'],
      (q) => q,
      (q) => `result of ${q}`,
    )
    expect(out).toBe('### glucose\nresult of glucose\n\n### palmitic acid\nresult of palmitic acid')
  })

  it('多项时单项失败不拖垮整批（错误文本就地成节）', async () => {
    const out = await renderBatch(
      ['ok', 'bad'],
      (q) => q,
      (q) => {
        if (q === 'bad') throw new Error('Not found in database (HTTP 404)')
        return `result of ${q}`
      },
    )
    expect(out).toContain('result of ok')
    expect(out).toContain('### bad')
    expect(out).toContain('Error: Not found in database (HTTP 404)')
  })

  it('单项时 render 抛错原样上抛（全局错误应让整次调用失败）', async () => {
    await expect(
      renderBatch(['only'], (q) => q, () => {
        throw new Error('index missing')
      }),
    ).rejects.toThrow('index missing')
  })
})
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  compileParameters,
  compileValueSchema,
  JsonSchemaError,
  type InferArgs,
  type InferValue,
  type ParameterSchemaSpec,
} from '../schema'
import { validateJsonSchemaValue } from '../json-schema'
import type { JsonValue } from '../json'

const validateArgs = (spec: ParameterSchemaSpec, args: unknown) =>
  validateJsonSchemaValue(compileParameters(spec), args, '')

const questionSpec = {
  questions: {
    type: 'array',
    required: true,
    description: 'Questions to ask.',
    maxItems: 2,
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true },
        options: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: { label: { type: 'string', required: true } },
          },
        },
      },
    },
  },
  mode: { type: 'string', enum: ['fast', 'full'] },
  limit: { type: 'integer' },
  ratio: { type: 'number' },
} as const satisfies ParameterSchemaSpec

describe('compiling the parameter DSL', () => {
  it('collects per-property required flags into required arrays at every level', () => {
    expect(compileParameters(questionSpec)).toEqual({
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: 'Questions to ask.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: true,
                  properties: { label: { type: 'string' } },
                  required: ['label'],
                },
              },
            },
            required: ['id'],
          },
          maxItems: 2,
        },
        mode: { type: 'string', enum: ['fast', 'full'] },
        limit: { type: 'integer' },
        ratio: { type: 'number' },
      },
      required: ['questions'],
    })
  })

  it('writes keys as type, annotations, then constraints so the schema bytes stay stable', () => {
    const node = compileValueSchema({ enum: ['a'], examples: ['a'], title: 't', type: 'string', description: 'd' })
    expect(Object.keys(node)).toEqual(['type', 'description', 'title', 'examples', 'enum'])
  })

  it('compiles json, null, const and oneOf nodes', () => {
    expect(compileValueSchema({ type: 'json', description: 'Any value.' })).toEqual({
      description: 'Any value.',
    })
    expect(compileValueSchema({ oneOf: [{ type: 'string' }, { type: 'null' }] })).toEqual({
      oneOf: [{ type: 'string' }, { type: 'null' }],
    })
    expect(compileValueSchema({ type: 'integer', const: 3, default: 3 })).toEqual({
      type: 'integer',
      default: 3,
      const: 3,
    })
  })

  it('leaves the parameter root open without writing additionalProperties', () => {
    expect(compileParameters({})).toEqual({ type: 'object', properties: {} })
  })

  it('keeps a parameter named __proto__ as an ordinary property', () => {
    // 对象字面量里的 __proto__ 会改原型，JSON.parse 才产出这个名字的普通属性
    const schema = compileParameters(JSON.parse('{"__proto__":{"type":"string"}}'))
    expect(Object.getPrototypeOf(schema.properties)).toBe(Object.prototype)
    expect(Object.keys(schema.properties)).toEqual(['__proto__'])
  })

  it.each([
    [{ x: { type: 'string', required: false } }, 'parameters.x.required must be true when present'],
    [
      { x: { type: 'object', properties: {} } },
      'parameters.x.additionalProperties must be explicitly true or false',
    ],
    [
      { x: { type: 'string', minLength: 1 } },
      'parameters.x.minLength is not supported by the value schema DSL',
    ],
    [
      { x: { type: 'array', items: { type: 'string', required: true } } },
      'parameters.x.items.required is not supported by the value schema DSL',
    ],
    [
      { x: { type: 'tuple' } },
      'parameters.x.type must be string/number/integer/boolean/null/array/object/json, or use oneOf',
    ],
    [
      { x: { oneOf: [{ type: 'string' }] } },
      'parameters.x.oneOf must be an array of at least two value schemas',
    ],
    [
      { x: { type: 'string', oneOf: [{ type: 'string' }, { type: 'null' }] } },
      'parameters.x cannot declare both type and oneOf',
    ],
    [
      { x: { type: 'integer', enum: [1.5] } },
      'parameters.x.enum must be a non-empty array of integer values',
    ],
    [{ x: { type: 'boolean', const: 'yes' } }, 'parameters.x.const must be a boolean value'],
    [
      { x: { type: 'string', enum: ['a'], const: 'b' } },
      'parameters.x.const must be one of parameters.x.enum when both are declared',
    ],
    [{ x: { type: 'array', maxItems: -1 } }, 'parameters.x.maxItems must be a non-negative integer'],
    [{ x: { type: 'string', maxItems: 2 } }, 'parameters.x.maxItems is not supported by the value schema DSL'],
    [{ x: { type: 'string', description: 3 } }, 'parameters.x.description must be a string'],
    [
      { x: { type: 'string', default: undefined } },
      'parameters.x.default annotation must be lossless JSON data',
    ],
  ])('rejects %j', (spec, message) => {
    expect(() => compileParameters(spec as never)).toThrow(new JsonSchemaError([message]))
  })

  it('rejects a circular schema but accepts a node reused in sibling positions', () => {
    const node: Record<string, unknown> = { type: 'array' }
    node.items = node
    expect(() => compileParameters({ x: node } as never)).toThrow('parameters.x.items is circular')
    const label = { type: 'string' } as const
    expect(() => compileParameters({ a: label, b: label })).not.toThrow()
  })
})

describe('validating arguments', () => {
  it('reports every violation with its path, in schema order', () => {
    expect(
      validateArgs(questionSpec, {
        questions: [{ options: [{ label: 1 }, {}], extra: true }],
        mode: 'slow',
      }),
    ).toEqual([
      'missing required property "questions[0].id"',
      '"questions[0].options[0].label" must be a string',
      'missing required property "questions[0].options[1].label"',
      '"questions[0].extra" is not a declared property (additionalProperties: false)',
      '"mode" must be one of ["fast","full"]',
    ])
  })

  it('requires an object at the root', () => {
    for (const args of [[], null, undefined, 'x']) {
      expect(validateArgs({}, args)).toEqual(['"arguments" must be an object'])
    }
  })

  it('does not coerce: null, fractions, non-finite numbers and -0 are errors', () => {
    expect(
      validateArgs(questionSpec, {
        questions: [],
        mode: null,
        limit: 2.5,
        ratio: Number.NaN,
      }),
    ).toEqual([
      '"mode" must be a string',
      '"limit" must be an integer',
      '"ratio" must be a finite JSON number',
    ])
    expect(validateArgs({ x: { type: 'number' } }, { x: -0 })).toEqual([
      '"x" must be a finite JSON number',
    ])
  })

  it('treats undefined as absent', () => {
    expect(validateArgs(questionSpec, { questions: [], mode: undefined })).toEqual([])
    expect(validateArgs(questionSpec, { questions: undefined })).toEqual([
      'missing required property "questions"',
    ])
  })

  it('rejects arrays longer than maxItems instead of truncating them', () => {
    expect(validateArgs(questionSpec, { questions: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] })).toEqual([
      '"questions" must contain at most 2 items',
    ])
  })

  it('accepts undeclared keys at the open root and inside open objects', () => {
    expect(
      validateArgs(questionSpec, {
        questions: [{ id: 'a', options: [{ label: 'x', recommended: true }] }],
        reasoning: 'free text',
      }),
    ).toEqual([])
  })

  it('checks enum and const on every scalar type', () => {
    const schema = compileValueSchema({ type: 'integer', enum: [1, 2], const: 2 })
    expect(validateJsonSchemaValue(schema, 1)).toEqual(['"value" must be 2'])
    expect(validateJsonSchemaValue(schema, 3)).toEqual(['"value" must be one of [1,2]'])
    expect(validateJsonSchemaValue(compileValueSchema({ type: 'null' }), 0)).toEqual([
      '"value" must be null',
    ])
  })

  it('requires exactly one matching oneOf branch', () => {
    const either = compileValueSchema({ oneOf: [{ type: 'string' }, { type: 'null' }] })
    expect(validateJsonSchemaValue(either, null)).toEqual([])
    expect(validateJsonSchemaValue(either, 1)).toEqual([
      '"value" must match exactly one oneOf branch (matched 0)',
    ])
    const overlapping = compileValueSchema({ oneOf: [{ type: 'number' }, { type: 'integer' }] })
    expect(validateJsonSchemaValue(overlapping, 2)).toEqual([
      '"value" must match exactly one oneOf branch (matched 2)',
    ])
  })

  it('accepts any lossless JSON value for a json node and nothing else', () => {
    const any = compileValueSchema({ type: 'json' })
    expect(validateJsonSchemaValue(any, { a: [1, 'b', null] })).toEqual([])
    expect(validateJsonSchemaValue(any, { a: () => 1 })).toEqual([
      '"value" must be a lossless JSON value',
    ])
    const untyped = compileValueSchema({ type: 'array' })
    expect(validateJsonSchemaValue(untyped, [1, Number.POSITIVE_INFINITY])).toEqual([
      '"value[1]" must be a lossless JSON value',
    ])
  })
})

describe('type inference', () => {
  it('makes required keys required, others optional, and keeps literal types', () => {
    type Args = InferArgs<typeof questionSpec>
    expectTypeOf<Args['questions'][number]['id']>().toEqualTypeOf<string>()
    expectTypeOf<Args['mode']>().toEqualTypeOf<'fast' | 'full' | undefined>()
    expectTypeOf<Args['limit']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<Args>().toHaveProperty('questions')
  })

  it('infers json, null, oneOf and const nodes', () => {
    expectTypeOf<InferValue<{ type: 'json' }>>().toEqualTypeOf<JsonValue>()
    expectTypeOf<
      InferValue<{ oneOf: readonly [{ type: 'string' }, { type: 'null' }] }>
    >().toEqualTypeOf<string | null>()
    expectTypeOf<InferValue<{ type: 'integer'; const: 3 }>>().toEqualTypeOf<3>()
  })
})

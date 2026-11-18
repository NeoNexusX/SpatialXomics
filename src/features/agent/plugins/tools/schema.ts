/**
 * 工具参数的作者 DSL：声明、类型推导，以及编译成 `json-schema.ts` 的子集。
 *
 * 每个值是一个节点：`string`、`number`、`integer`、`boolean`、`null`、`array`、`object`、
 * 只给作者用的 `json`（任意 JSON 值），或恰好匹配一个分支的 `oneOf`。对象必须显式写
 * `additionalProperties`；必填写在属性上（`required: true`，只能写 true）。
 * 写法错误在编译时直接抛错，工具所在插件随之启动失败。
 */

import { hasOwn, isJsonValue, isPlainObject, type JsonValue } from './json'
import type {
  JsonSchemaNode,
  JsonSchemaScalar,
  JsonSchemaType,
  ParameterJsonSchema,
} from './json-schema'

/** 每个节点都能带的注解，编译后原样进入 JSON Schema */
export interface ValueSchemaAnnotations {
  description?: string
  title?: string
  /** 只是注解，不参与校验 */
  default?: JsonValue
  /** 只是注解，不参与校验 */
  examples?: JsonValue
}

export interface StringValueSchemaSpec extends ValueSchemaAnnotations {
  type: 'string'
  enum?: readonly string[]
  const?: string
}

export interface NumberValueSchemaSpec extends ValueSchemaAnnotations {
  type: 'number'
  enum?: readonly number[]
  const?: number
}

export interface IntegerValueSchemaSpec extends ValueSchemaAnnotations {
  type: 'integer'
  enum?: readonly number[]
  const?: number
}

export interface BooleanValueSchemaSpec extends ValueSchemaAnnotations {
  type: 'boolean'
  enum?: readonly boolean[]
  const?: boolean
}

export interface NullValueSchemaSpec extends ValueSchemaAnnotations {
  type: 'null'
  enum?: readonly null[]
  const?: null
}

/** 省略 `items` 时元素可以是任意 JSON 值 */
export interface ArrayValueSchemaSpec extends ValueSchemaAnnotations {
  type: 'array'
  items?: ValueSchemaSpec
  /** 超出时报错，不截断 */
  maxItems?: number
}

/** 开放与否必须写明，嵌套对象不会继承 JSON Schema 的默认值 */
export interface ObjectValueSchemaSpec extends ValueSchemaAnnotations {
  type: 'object'
  properties?: ParameterSchemaSpec
  additionalProperties: boolean
}

/** 不加约束的 JSON 值 */
export interface JsonValueSchemaSpec extends ValueSchemaAnnotations {
  type: 'json'
}

/** 恰好一个分支通过，至少两个分支 */
export interface OneOfValueSchemaSpec extends ValueSchemaAnnotations {
  oneOf: readonly [ValueSchemaSpec, ValueSchemaSpec, ...ValueSchemaSpec[]]
}

export type ValueSchemaSpec =
  | StringValueSchemaSpec
  | NumberValueSchemaSpec
  | IntegerValueSchemaSpec
  | BooleanValueSchemaSpec
  | NullValueSchemaSpec
  | ArrayValueSchemaSpec
  | ObjectValueSchemaSpec
  | JsonValueSchemaSpec
  | OneOfValueSchemaSpec

/** 对象的一个属性，可以标成必填 */
export type ParameterPropertySpec = ValueSchemaSpec & { required?: true }

/** 一组属性；工具参数的根就是这样一张表，相当于开放的对象 */
export type ParameterSchemaSpec = {
  [key: string]: ParameterPropertySpec
  [key: symbol]: never
}

// ---- 类型推导 ----

type Simplify<T> = { [K in keyof T]: T[K] } & {}

type StringKeyOf<S> = Extract<keyof S, string>

type RequiredKeys<S> = {
  [K in StringKeyOf<S>]: S[K] extends { required: true } ? K : never
}[StringKeyOf<S>]

type InferProperties<S, Depth extends unknown[]> = Simplify<
  { [K in RequiredKeys<S>]: InferValueAt<S[K], Depth> } & {
    [K in Exclude<StringKeyOf<S>, RequiredKeys<S>>]?: InferValueAt<S[K], Depth>
  }
>

type InferObject<S extends { additionalProperties: boolean }, Depth extends unknown[]> = S extends {
  properties: infer P
}
  ? S['additionalProperties'] extends true
    ? InferProperties<P, Depth> & Record<string, JsonValue>
    : InferProperties<P, Depth>
  : S['additionalProperties'] extends true
    ? Record<string, JsonValue>
    : Record<string, never>

type InferScalar<S, Fallback> = S extends { const: infer C }
  ? C
  : S extends { enum: readonly (infer E)[] }
    ? E
    : Fallback

type Deeper<Depth extends unknown[]> = [unknown, ...Depth]

/** 逐层推导，超过 16 层的容器放宽成 JsonValue */
type InferValueAt<S, Depth extends unknown[]> = Depth['length'] extends 16
  ? JsonValue
  : S extends { type: 'string' }
    ? InferScalar<S, string>
    : S extends { type: 'number' | 'integer' }
      ? InferScalar<S, number>
      : S extends { type: 'boolean' }
        ? InferScalar<S, boolean>
        : S extends { type: 'null' }
          ? null
          : S extends { type: 'array' }
            ? S extends { items: infer I }
              ? InferValueAt<I, Deeper<Depth>>[]
              : JsonValue[]
            : S extends { type: 'object'; additionalProperties: boolean }
              ? InferObject<S, Deeper<Depth>>
              : S extends { type: 'json' }
                ? JsonValue
                : S extends { oneOf: readonly unknown[] }
                  ? InferValueAt<S['oneOf'][number], Deeper<Depth>>
                  : never

/** 一个值节点对应的 TypeScript 类型 */
export type InferValue<S> = InferValueAt<S, []>

/** 工具参数表对应的参数对象类型：`required: true` 的键必填，其余可选 */
export type InferArgs<S> = InferProperties<S, []>

// ---- 编译 ----

/** schema 不在支持的子集里，或作者写法不对 */
export class JsonSchemaError extends Error {
  readonly code = 'UNSUPPORTED_SCHEMA'
  constructor(readonly violations: string[]) {
    super(`unsupported JSON schema: ${violations.join('; ')}`)
    this.name = 'JsonSchemaError'
  }
}

function fail(message: string): never {
  throw new JsonSchemaError([message])
}

const ANNOTATIONS = ['description', 'title', 'default', 'examples'] as const
type ScalarType = 'string' | 'number' | 'integer' | 'boolean' | 'null'

function scalarMatches(type: ScalarType, value: unknown): value is JsonSchemaScalar {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value) && !Object.is(value, -0)
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
  }
}

/** 用 defineProperty 写入，属性名是 `__proto__` 时也不会改原型 */
function define<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true })
}

function assertKeys(input: Record<string, unknown>, path: string, allowed: readonly string[]): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) fail(`${path}.${key} is not supported by the value schema DSL`)
  }
}

function copyAnnotations(input: Record<string, unknown>, path: string, node: JsonSchemaNode): void {
  for (const key of ['description', 'title'] as const) {
    if (!hasOwn(input, key)) continue
    if (typeof input[key] !== 'string') fail(`${path}.${key} must be a string`)
    node[key] = input[key]
  }
  for (const key of ['default', 'examples'] as const) {
    if (!hasOwn(input, key)) continue
    if (!isJsonValue(input[key])) fail(`${path}.${key} annotation must be lossless JSON data`)
    node[key] = input[key]
  }
}

function compileProperties(
  input: unknown,
  path: string,
  seen: Set<object>,
): { properties: Record<string, JsonSchemaNode>; required?: string[] } {
  if (!isPlainObject(input)) fail(`${path} must be an object of value schemas`)
  if (seen.has(input)) fail(`${path} is circular`)
  seen.add(input)
  const properties: Record<string, JsonSchemaNode> = {}
  const required: string[] = []
  for (const [key, property] of Object.entries(input)) {
    const propertyPath = `${path}.${key}`
    if (!isPlainObject(property)) fail(`${propertyPath} must be a value schema object`)
    if (hasOwn(property, 'required')) {
      if (property.required !== true) fail(`${propertyPath}.required must be true when present`)
      required.push(key)
    }
    define(properties, key, compileNode(property, propertyPath, true, seen))
  }
  seen.delete(input)
  return required.length ? { properties, required } : { properties }
}

function compileNode(
  input: unknown,
  path: string,
  inProperty: boolean,
  seen: Set<object>,
): JsonSchemaNode {
  if (!isPlainObject(input)) fail(`${path} must be a value schema object`)
  if (seen.has(input)) fail(`${path} is circular`)
  seen.add(input)
  const common = [...ANNOTATIONS, ...(inProperty ? ['required'] : [])]
  const node: JsonSchemaNode = {}

  if (hasOwn(input, 'oneOf')) {
    assertKeys(input, path, [...common, 'oneOf', 'type'])
    if (hasOwn(input, 'type')) fail(`${path} cannot declare both type and oneOf`)
    const branches = input.oneOf
    if (!Array.isArray(branches) || branches.length < 2) {
      fail(`${path}.oneOf must be an array of at least two value schemas`)
    }
    node.oneOf = branches.map((branch, index) =>
      compileNode(branch, `${path}.oneOf[${index}]`, false, seen),
    )
    copyAnnotations(input, path, node)
    seen.delete(input)
    return node
  }

  // 键序固定为 type、注解、约束：发给模型的 schema 字节稳定，前缀缓存才能复用
  const type = input.type
  switch (type) {
    case 'json':
      assertKeys(input, path, [...common, 'type'])
      copyAnnotations(input, path, node)
      break
    case 'object': {
      assertKeys(input, path, [...common, 'type', 'properties', 'additionalProperties'])
      if (typeof input.additionalProperties !== 'boolean') {
        fail(`${path}.additionalProperties must be explicitly true or false`)
      }
      node.type = 'object'
      copyAnnotations(input, path, node)
      node.additionalProperties = input.additionalProperties
      if (hasOwn(input, 'properties')) {
        Object.assign(node, compileProperties(input.properties, `${path}.properties`, seen))
      }
      break
    }
    case 'array':
      assertKeys(input, path, [...common, 'type', 'items', 'maxItems'])
      node.type = 'array'
      copyAnnotations(input, path, node)
      if (hasOwn(input, 'items')) node.items = compileNode(input.items, `${path}.items`, false, seen)
      if (hasOwn(input, 'maxItems')) {
        const maxItems = input.maxItems
        if (typeof maxItems !== 'number' || !Number.isInteger(maxItems) || maxItems < 0) {
          fail(`${path}.maxItems must be a non-negative integer`)
        }
        node.maxItems = maxItems
      }
      break
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
    case 'null': {
      assertKeys(input, path, [...common, 'type', 'enum', 'const'])
      node.type = type satisfies JsonSchemaType
      copyAnnotations(input, path, node)
      if (hasOwn(input, 'enum')) {
        const values = input.enum
        if (!Array.isArray(values) || !values.length || !values.every((v) => scalarMatches(type, v))) {
          fail(`${path}.enum must be a non-empty array of ${type} values`)
        }
        node.enum = [...values]
      }
      if (hasOwn(input, 'const')) {
        if (!scalarMatches(type, input.const)) fail(`${path}.const must be a ${type} value`)
        if (node.enum && !node.enum.includes(input.const)) {
          fail(`${path}.const must be one of ${path}.enum when both are declared`)
        }
        node.const = input.const
      }
      break
    }
    default:
      fail(`${path}.type must be string/number/integer/boolean/null/array/object/json, or use oneOf`)
  }
  seen.delete(input)
  return node
}

/** 编译一个值节点（任意 JSON 根） */
export function compileValueSchema(spec: ValueSchemaSpec): JsonSchemaNode {
  return compileNode(spec, 'schema', false, new Set())
}

/** 编译工具参数表：根是隐式开放的对象，不写 additionalProperties */
export function compileParameters(spec: ParameterSchemaSpec): ParameterJsonSchema {
  return { type: 'object', ...compileProperties(spec, 'parameters', new Set()) }
}

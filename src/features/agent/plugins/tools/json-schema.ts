/**
 * 工具使用的 JSON Schema 子集，以及按 schema 校验值。
 *
 * 子集：任意 JSON 根；单个 `type`；对象的 `properties`、`required` 和布尔 `additionalProperties`；
 * 数组的 `items` 和 `maxItems`；标量按类型限定的 `enum`、`const`；恰好匹配一个分支的 `oneOf`；
 * 注解 `description`、`title`、`default`、`examples`。只有注解的节点接受任意 JSON 值。
 * 节点由 `schema.ts` 从作者 DSL 编译出来，这里不再重复检查节点本身。
 */

import { hasOwn, isJsonNumber, isJsonValue, isPlainObject, type JsonValue } from './json'

/** `enum` 和 `const` 能取的值 */
export type JsonSchemaScalar = string | number | boolean | null

export type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'

/** 子集里的一个节点。用 type 而不是 interface，才能赋给 llm 层的 Record<string, unknown> */
export type JsonSchemaNode = {
  /** 省略且没有 `oneOf` 时接受任意 JSON 值 */
  type?: JsonSchemaType
  /** 恰好一个分支通过，至少两个分支 */
  oneOf?: JsonSchemaNode[]
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  /** false 时拒绝未声明的键；省略或 true 时接受 */
  additionalProperties?: boolean
  /** 省略时数组元素可以是任意 JSON 值 */
  items?: JsonSchemaNode
  maxItems?: number
  enum?: JsonSchemaScalar[]
  const?: JsonSchemaScalar
  description?: string
  title?: string
  default?: JsonValue
  examples?: JsonValue
}

/** 工具参数的根：隐式开放的对象 */
export type ParameterJsonSchema = {
  type: 'object'
  properties: Record<string, JsonSchemaNode>
  required?: string[]
}

/** 参数校验的根路径写成空串，报错时显示成 arguments */
function shown(path: string): string {
  return path === '' ? 'arguments' : path
}

function childPath(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`
}

function checkScalar(node: JsonSchemaNode, value: JsonSchemaScalar, path: string): string[] {
  if (node.enum !== undefined && !node.enum.includes(value)) {
    return [`"${shown(path)}" must be one of ${JSON.stringify(node.enum)}`]
  }
  if (hasOwn(node, 'const') && value !== node.const) {
    return [`"${shown(path)}" must be ${JSON.stringify(node.const)}`]
  }
  return []
}

function check(node: JsonSchemaNode, value: unknown, path: string, out: string[]): void {
  if (node.oneOf) {
    const matches = node.oneOf.filter((branch) => validateJsonSchemaValue(branch, value, path).length === 0)
    if (matches.length !== 1) {
      out.push(`"${shown(path)}" must match exactly one oneOf branch (matched ${matches.length})`)
    }
    return
  }
  switch (node.type) {
    case undefined:
      if (!isJsonValue(value)) out.push(`"${shown(path)}" must be a lossless JSON value`)
      return
    case 'object': {
      if (!isPlainObject(value)) {
        out.push(`"${shown(path)}" must be an object`)
        return
      }
      // 值为 undefined 的键等于没有这个键，和 JSON 序列化一致
      const present = (key: string) => hasOwn(value, key) && value[key] !== undefined
      const properties = node.properties ?? {}
      for (const key of node.required ?? []) {
        if (!present(key)) out.push(`missing required property "${childPath(path, key)}"`)
      }
      for (const [key, child] of Object.entries(properties)) {
        if (present(key)) check(child, value[key], childPath(path, key), out)
      }
      for (const key of Object.keys(value)) {
        if (!present(key) || hasOwn(properties, key)) continue
        if (node.additionalProperties === false) {
          out.push(`"${childPath(path, key)}" is not a declared property (additionalProperties: false)`)
        } else if (!isJsonValue(value[key])) {
          out.push(`"${childPath(path, key)}" must be a lossless JSON value`)
        }
      }
      return
    }
    case 'array':
      if (!Array.isArray(value)) {
        out.push(`"${shown(path)}" must be an array`)
        return
      }
      if (node.maxItems !== undefined && value.length > node.maxItems) {
        out.push(`"${shown(path)}" must contain at most ${node.maxItems} items`)
      }
      for (let index = 0; index < value.length; index++) {
        const itemPath = `${path}[${index}]`
        if (!hasOwn(value, index)) out.push(`"${itemPath}" must be a lossless JSON value`)
        else if (node.items) check(node.items, value[index], itemPath, out)
        else if (!isJsonValue(value[index])) out.push(`"${itemPath}" must be a lossless JSON value`)
      }
      return
    case 'string':
      out.push(
        ...(typeof value === 'string'
          ? checkScalar(node, value, path)
          : [`"${shown(path)}" must be a string`]),
      )
      return
    case 'number':
      out.push(
        ...(typeof value !== 'number'
          ? [`"${shown(path)}" must be a number`]
          : !isJsonNumber(value)
            ? [`"${shown(path)}" must be a finite JSON number`]
            : checkScalar(node, value, path)),
      )
      return
    case 'integer':
      out.push(
        ...(isJsonNumber(value) && Number.isInteger(value)
          ? checkScalar(node, value, path)
          : [`"${shown(path)}" must be an integer`]),
      )
      return
    case 'boolean':
      out.push(
        ...(typeof value === 'boolean'
          ? checkScalar(node, value, path)
          : [`"${shown(path)}" must be a boolean`]),
      )
      return
    case 'null':
      out.push(...(value === null ? checkScalar(node, value, path) : [`"${shown(path)}" must be null`]))
      return
  }
}

/**
 * 按 schema 校验一个值，返回全部错误，每条带路径；空数组表示通过。
 * @param path - 报错用的根路径；工具参数传空串，显示成 arguments
 */
export function validateJsonSchemaValue(schema: JsonSchemaNode, value: unknown, path = 'value'): string[] {
  const out: string[] = []
  check(schema, value, path, out)
  return out
}

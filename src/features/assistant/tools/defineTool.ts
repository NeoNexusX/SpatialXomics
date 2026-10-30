/**
 * 精简版 defineTool —— 工具定义工厂。
 *
 * 只保留 dsh 形态的骨干（参数 schema、output render、execute），
 * 砍掉 code mode / presentAs / approval / isConcurrencySafe 等
 * 浏览器端不需要的特性。
 */

import type { ToolSchema } from '../agenttypes/assistant'

// ---- 参数 schema DSL ----

export interface ParamSpec {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array'
  /** 必填标记；仅影响 JSON Schema 的 required 与运行时校验，不影响 InferArgs */
  required?: boolean
  description?: string
  /** 仅 string 类型：限定可选值 */
  enum?: string[]
  /** 仅 array 类型：元素类型（缺省 string） */
  items?: 'string' | 'number' | 'integer'
  /** 仅 array 类型：最大元素数（超出静默截断，防模型一次塞几百个） */
  maxItems?: number
}

export interface ParameterSchemaSpec {
  [key: string]: ParamSpec
}

/**
 * 从 ParamSpec 映射推导出参数对象的 TS 类型（工具实现层）。
 *
 * 注意：所有键都标为非可选 —— required 键的存在性由运行时 validateArgs 保证；
 * 可选键模型未传时为 undefined，工具内部自行判空。
 */
export type InferArgs<S extends ParameterSchemaSpec> = {
  [K in keyof S]: S[K]['type'] extends 'array'
    ? S[K]['items'] extends 'number' | 'integer'
      ? number[]
      : string[]
    : S[K]['type'] extends 'string'
      ? string
      : S[K]['type'] extends 'number' | 'integer'
        ? number
        : S[K]['type'] extends 'boolean'
          ? boolean
          : never
}

// ---- 工具执行上下文 ----

export interface ToolRunContext {
  signal: AbortSignal
  callId: string
  name: string
}

// ---- 工具定义 ----

/**
 * 工具分类（仅影响 system prompt 里的分组展示与 UI 归类，不影响执行）：
 * - page       当前页面/数据集的实时状态与统计
 * - files      后端文件/任务/配额
 * - chemistry  化学信息（PubChem / 离线库 / ChEBI）
 * - biology    生物信息（HMDB / KEGG：代谢物→组织/疾病/通路）
 * - literature 文献检索（PubMed / Europe PMC / OpenAlex）
 * - system     助手自身（存档读取等）
 */
export type ToolCategory =
  | 'page'
  | 'files'
  | 'chemistry'
  | 'biology'
  | 'literature'
  | 'system'

export interface ToolDefinition<A extends ParameterSchemaSpec = any, V = any> {
  name: string
  description: string
  /** 分类（见 {@link ToolCategory}）；缺省归入 system 组 */
  category?: ToolCategory
  parameters: A
  /**
   * 将执行结果（value）渲染为模型可见的文本摘要。
   * 可选：缺省为「字符串原样、其余 JSON.stringify」——全部内置工具
   * 用的都是这个默认值，需要自定义格式（如脱敏/截断策略）时才提供。
   */
  output?: {
    render: (args: InferArgs<A>, value: V) => string
  }
  /** 工具执行超时（ms）；缺省 15000 */
  timeoutMs?: number
  /** 单工具结果截断上限（字符）；缺省 TOOL_RESULT_CHARS=2000。
   *  仅给「内容本身就该完整」的工具用（如 skill 加载的 SKILL.md 全文，
   *  10k 级）——被截断会让模型读不到工作流后半段和输出模板。 */
  maxResultChars?: number
  /** 工具的执行体 */
  execute(args: InferArgs<A>, exec: ToolRunContext): Promise<V>
}

// ---- 校验结果 ----

export interface ValidationResult {
  valid: boolean
  errors?: { field: string; message: string }[]
}

// ---- 工厂函数 ----

export function defineTool<A extends ParameterSchemaSpec, V>(
  def: ToolDefinition<A, V>,
): ToolDefinition<A, V> {
  return def
}

// ---- 批量工具输出拼接 ----

/**
 * 批量工具的统一输出形态：单项时与旧版单查输出完全一致（不加节标题，存量
 * 测试/提示词措辞不受影响）；多项时逐项加 `### <label>` 节标题拼接。
 *
 * 单项 render 抛错按原样上抛（索引未构建等全局错误应让整次调用失败）；
 * 多项时单项失败不拖垮整批——错误文本就地成为该节内容（批量 PubChem/ChEBI
 * 查询里一个未知名字不该让其余结果全丢）。
 */
export async function renderBatch<T>(
  items: T[],
  label: (item: T) => string,
  render: (item: T) => string | Promise<string>,
): Promise<string> {
  if (items.length === 1) {
    return await render(items[0]!)
  }
  const sections: string[] = []
  for (const item of items) {
    let body: string
    try {
      body = await render(item)
    } catch (err) {
      body = `Error: ${(err as Error).message}`
    }
    sections.push(`### ${label(item)}\n${body}`)
  }
  return sections.join('\n\n')
}

// ---- 参数校验 ----

export function validateArgs<A extends ParameterSchemaSpec>(
  def: ToolDefinition<A>,
  rawArgs: unknown,
): { valid: true; args: InferArgs<A> } | { valid: false; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = []
  const parsed: Record<string, unknown> = {}

  if (typeof rawArgs !== 'object' || rawArgs === null) {
    return { valid: false, errors: [{ field: '(root)', message: 'arguments must be a JSON object' }] }
  }

  const input = rawArgs as Record<string, unknown>

  for (const [key, spec] of Object.entries(def.parameters)) {
    const value = input[key]

    if (value === undefined || value === null) {
      if (spec.required) {
        errors.push({ field: key, message: `"${key}" is required` })
      }
      continue
    }

    switch (spec.type) {
      case 'string':
        if (typeof value !== 'string') {
          errors.push({ field: key, message: `"${key}" must be a string, got ${typeof value}` })
        } else if (spec.enum && !spec.enum.includes(value)) {
          errors.push({ field: key, message: `"${key}" must be one of ${spec.enum.join(', ')}, got "${value}"` })
        } else {
          parsed[key] = value
        }
        break
      case 'number':
      case 'integer':
        if (typeof value !== 'number' || Number.isNaN(value)) {
          errors.push({ field: key, message: `"${key}" must be a number, got ${typeof value}` })
        } else {
          parsed[key] = spec.type === 'integer' ? Math.floor(value) : value
        }
        break
      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push({ field: key, message: `"${key}" must be a boolean, got ${typeof value}` })
        } else {
          parsed[key] = value
        }
        break
      case 'array': {
        if (!Array.isArray(value)) {
          errors.push({ field: key, message: `"${key}" must be an array, got ${typeof value}` })
          break
        }
        const itemType = spec.items ?? 'string'
        const out: (string | number)[] = []
        let bad = false
        for (const el of value) {
          if (itemType === 'string') {
            if (typeof el !== 'string') {
              errors.push({
                field: key,
                message: `"${key}" must contain only strings, got ${typeof el}`,
              })
              bad = true
              break
            }
            out.push(el)
          } else {
            if (typeof el !== 'number' || Number.isNaN(el)) {
              errors.push({
                field: key,
                message: `"${key}" must contain only numbers, got ${typeof el}`,
              })
              bad = true
              break
            }
            out.push(itemType === 'integer' ? Math.floor(el) : el)
          }
        }
        if (!bad) {
          // maxItems：静默截断（模型侧列表超长不构成错误，只是用不完）
          parsed[key] = spec.maxItems != null ? out.slice(0, spec.maxItems) : out
        }
        break
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }
  return { valid: true, args: parsed as InferArgs<A> }
}

// ---- 工具 schema 转换（供 LLM function calling 使用） ----

export function toToolSchema(def: ToolDefinition): ToolSchema {
  const properties: Record<string, Record<string, unknown>> = {}
  const required: string[] = []

  for (const [key, rawSpec] of Object.entries(def.parameters)) {
    const spec = rawSpec as ParamSpec
    const prop: Record<string, unknown> = {
      type: spec.type === 'integer' ? 'integer' : spec.type,
    }
    if (spec.type === 'array') {
      prop.items = { type: spec.items === 'number' || spec.items === 'integer' ? spec.items : 'string' }
      if (spec.maxItems != null) prop.maxItems = spec.maxItems
    }
    if (spec.description) prop.description = spec.description
    if (spec.enum) prop.enum = spec.enum
    properties[key] = prop
    if (spec.required) required.push(key)
  }

  return {
    name: def.name,
    description: def.description,
    parameters: {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    },
  }
}
/** 工具定义工厂：参数 schema、output render、execute */

import type { ToolSchema, ToolImage } from '../llm'
import type { Session } from '../session'
import { INLINE_CITATION_TOOL_HINT } from '../../citations'

// ---- 参数 schema DSL ----

export interface ParamSpec {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array'
  /** 必填标记；仅影响 JSON Schema 的 required 与运行时校验，不影响 InferArgs */
  required?: boolean
  description?: string
  /** 仅 string 类型：限定可选值 */
  enum?: readonly string[]
  /** 仅 array 类型：元素类型（缺省 string） */
  items?: 'string' | 'number' | 'integer'
  /** 仅 array 类型：最大元素数（超出裁剪并返回警告） */
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
  /** 发起调用的会话 */
  session?: Session
  signal: AbortSignal
  callId: string
  name: string
}

// ---- 工具定义 ----

/**
 * 工具分类（影响说明展示、UI 归类和外部证据引用提示，不影响执行）：
 * - page       当前页面/数据集的实时状态与统计
 * - files      后端文件/任务/配额
 * - chemistry  化学信息（PubChem / 离线库 / ChEBI）
 * - biology    生物信息（HMDB / KEGG：代谢物→组织/疾病/通路）
 * - literature 文献检索（PubMed / Europe PMC / OpenAlex）
 * - web        通用网络搜索和来源发现
 * - system     助手自身（存档读取等）
 */
export type ToolCategory =
  | 'page'
  | 'files'
  | 'chemistry'
  | 'biology'
  | 'literature'
  | 'web'
  | 'system'

export interface ToolDefinition<A extends ParameterSchemaSpec = any, V = any> {
  name: string
  description: string
  /** 分类（见 {@link ToolCategory}）；缺省归入 system 组 */
  category?: ToolCategory
  parameters: A
  /**
   * 将执行结果（value）渲染为模型可见的文本摘要。
   * 可选：缺省为「字符串原样、其余 JSON.stringify」。
   */
  output?: {
    render: (args: InferArgs<A>, value: V) => string
    /**
     * 工具附带的图像。返回 undefined（省略 images 字段）表示本次没有可用图；
     * 绝不要返回空数组——runtime 对真值数组一律调 validateToolImages，
     * 空数组会被「1–4 张」校验拒绝。
     */
    images?: (
      args: InferArgs<A>,
      value: V,
      exec: ToolRunContext,
    ) => ToolImage[] | undefined | Promise<ToolImage[] | undefined>
  }
  /** 工具执行超时（ms）；缺省 15000 */
  timeoutMs?: number
  /** 单工具结果截断上限（字符）；缺省 4000。
   *  仅给「内容本身就该完整」的工具用（如 skill 加载的 SKILL.md 全文，
   *  10k 级）——被截断会让模型读不到工作流后半段和输出模板。 */
  maxResultChars?: number
  /** 工具的执行体 */
  execute(args: InferArgs<A>, exec: ToolRunContext): Promise<V>
}

// ---- 工厂函数 ----

export function defineTool<A extends ParameterSchemaSpec, V>(
  def: ToolDefinition<A, V>,
): ToolDefinition<A, V> {
  return def
}

// ---- 批量工具输出拼接 ----

export const batchPageParameters = {
  offset: {
    type: 'integer',
    description:
      'Zero-based start into the batch query inputs (default 0); continue with nextOffset.',
  },
  limit: {
    type: 'integer',
    description: 'Queries processed per page, default 5, max 8; pages inputs.',
  },
} satisfies ParameterSchemaSpec

/** 证据类批量工具的字符预算（配合 TOOL_RESULT_CHARS_EVIDENCE 的结果上限） */
export const EVIDENCE_BATCH_BUDGET = { maxChars: 11700, maxCharsPerItem: 11000 }

/** 批量参数优先，否则把单值参数变成一项 */
export function batchInput<T>(many: T[] | undefined, one: T | undefined): T[] {
  return many ?? (one != null ? [one] : [])
}

/**
 * 批量工具的统一输出形态：单项时不加节标题，和单查的输出一样；多项时逐项加
 * `### <label>` 节标题拼接。
 *
 * 单项 render 抛错按原样上抛（索引未构建等全局错误应让整次调用失败）；
 * 多项时单项失败不拖垮整批——错误文本就地成为该节内容（批量 PubChem/ChEBI
 * 查询里一个未知名字不该让其余结果全丢）。
 */
export async function renderBatch<T>(
  items: T[],
  label: (item: T) => string,
  render: (item: T) => string | Promise<string>,
  options: {
    offset?: number
    limit?: number
    maxChars?: number
    maxCharsPerItem?: number
    /** false: offset/limit belong to each query's results, never to the input array. */
    paginateInputs?: boolean
    /**
     * Soft wall-clock budget (epoch ms) for slow-network batch tools. An item
     * that would START past it is skipped and left to the nextOffset footer —
     * never degraded in place, which would consume the pagination cursor and
     * get skipped forever when the model follows the footer.
     */
    deadline?: number
    session?: Session
    signal?: AbortSignal
  } = {},
): Promise<string> {
  const paginateInputs = options.paginateInputs ?? true
  const offset = paginateInputs
    ? Math.min(items.length, Math.max(0, Math.floor(options.offset ?? 0)))
    : 0
  const limit = paginateInputs
    ? Math.min(8, Math.max(1, Math.floor(options.limit ?? 5)))
    : items.length
  const budget = options.maxChars ?? 3700
  const itemBudget = options.maxCharsPerItem ?? 700
  const sections: string[] = []
  let used = 0
  let next = offset
  let deadlineHit = false
  for (let index = offset; index < Math.min(items.length, offset + limit); index++) {
    options.signal?.throwIfAborted()
    if (options.deadline != null && Date.now() > options.deadline && sections.length) {
      deadlineHit = true
      break
    }
    const item = items[index]!
    const heading = items.length > 1 ? `### ${label(item).slice(0, 180)}\n` : ''
    // Do not query an item that cannot fit. Leave it for the next page.
    const remaining = budget - 200 - used - heading.length - 2
    if (sections.length && remaining < Math.min(itemBudget, 256)) break
    let body: string
    try {
      body = await render(item)
      options.signal?.throwIfAborted()
    } catch (error) {
      options.signal?.throwIfAborted()
      if (items.length === 1) throw error
      body = `Error: ${error instanceof Error ? error.message : String(error)}`
    }
    // Keep complete evidence items. Long single items remain available in the archive.
    const cap = Math.min(items.length === 1 ? budget : itemBudget, remaining)
    const needsArchive = body.length > cap
    const previewLength = needsArchive ? Math.max(0, cap - 180) : body.length
    if (needsArchive && options.session) {
      const id = await options.session.storage.putArtifact(new Blob([body], { type: 'text/plain' }))
      body =
        body.slice(0, previewLength) +
        `\n[complete item archived; call read_archived_result("${id}")]`
    } else if (needsArchive) {
      // Without session storage return the full item so the runtime can archive it.
      sections.push(heading + body)
      next = index + 1
      break
    }
    sections.push(heading + body)
    used += heading.length + body.length + 2
    next = index + 1
  }
  const footer = deadlineHit
    ? paginateInputs
      ? `\n[${items.length - next} inputs not started: the batch time budget was exhausted by earlier slow responses; nextOffset=${next}; repeat the same query arrays with offset=${next} to continue with a fresh budget.]`
      : `\n[${items.length - next} queries not started because the batch time budget was exhausted by earlier slow responses; retry the remaining queries in a smaller batch.]`
    : next < items.length
      ? paginateInputs
        ? `\n[${items.length - next} more; nextOffset=${next}; repeat the same query arrays with offset=${next}]`
        : `\n[${items.length - next} queries not returned because the result character budget was exhausted; retry the remaining queries in a smaller batch.]`
      : ''
  return sections.join('\n\n') + footer
}

// ---- 参数校验 ----

export function validateArgs<A extends ParameterSchemaSpec>(
  def: ToolDefinition<A>,
  rawArgs: unknown,
):
  | { valid: true; args: InferArgs<A>; warnings: string[] }
  | { valid: false; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = []
  const parsed: Record<string, unknown> = {}
  const warnings: string[] = []

  if (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs)) {
    return {
      valid: false,
      errors: [{ field: '(root)', message: 'arguments must be a JSON object' }],
    }
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
          errors.push({
            field: key,
            message: `"${key}" must be one of ${spec.enum.join(', ')}, got "${value}"`,
          })
        } else {
          parsed[key] = value
        }
        break
      case 'number':
      case 'integer':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
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
            if (typeof el !== 'number' || !Number.isFinite(el)) {
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
          if (spec.maxItems != null && out.length > spec.maxItems) {
            warnings.push(
              `${key}: only the first ${spec.maxItems} of ${out.length} values were used`,
            )
          }
          parsed[key] = spec.maxItems != null ? out.slice(0, spec.maxItems) : out
        }
        break
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }
  return { valid: true, args: parsed as InferArgs<A>, warnings }
}

// ---- 工具 schema 转换（供 LLM function calling 使用） ----

export function toToolSchema(def: ToolDefinition): ToolSchema {
  const properties: Record<string, Record<string, unknown>> = {}
  const required: string[] = []

  for (const [key, rawSpec] of Object.entries(def.parameters)) {
    const spec = rawSpec as ParamSpec
    const prop: Record<string, unknown> = {
      type: spec.type,
    }
    if (spec.type === 'array') {
      prop.items = { type: spec.items ?? 'string' }
      if (spec.maxItems != null) prop.maxItems = spec.maxItems
    }
    if (spec.description) prop.description = spec.description
    if (spec.enum) prop.enum = spec.enum
    properties[key] = prop
    if (spec.required) required.push(key)
  }

  return {
    name: def.name,
    description:
      def.description +
      (['chemistry', 'biology', 'literature', 'web'].includes(def.category ?? '')
        ? INLINE_CITATION_TOOL_HINT
        : ''),
    parameters: {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    },
  }
}

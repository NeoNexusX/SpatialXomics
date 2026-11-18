/**
 * 工具定义。作者用参数 DSL（`schema.ts`）声明参数，`defineTool` 把它编译成 JSON Schema：
 * 发给模型的就是这份 schema，执行前也按它校验参数，不合法就作为普通工具错误回给模型。
 */

import type { ToolSchema, ToolImage } from '../llm'
import type { Session } from '../session'
import { INLINE_CITATION_TOOL_HINT } from '../../citations'
import { validateJsonSchemaValue, type ParameterJsonSchema } from './json-schema'
import { compileParameters, type InferArgs, type ParameterSchemaSpec } from './schema'

export interface ToolRunContext {
  /** 发起调用的会话 */
  session?: Session
  signal: AbortSignal
  callId: string
  name: string
  /** 模型给出的参数，已冻结；执行前闸门也能看到 */
  arguments: unknown
}

/**
 * 工具分类（影响说明展示和外部证据引用提示，不影响执行）：
 * - page        当前页面/数据集的实时状态与统计
 * - files       后端文件/任务/配额
 * - chemistry   化学信息（PubChem / 离线库 / ChEBI）
 * - biology     生物信息（HMDB / KEGG：代谢物→组织/疾病/通路）
 * - literature  文献检索（PubMed / Europe PMC / OpenAlex）
 * - web         通用网络搜索和来源发现
 * - interaction 向用户提问
 * - system      助手自身（存档读取等）
 */
export type ToolCategory =
  | 'page'
  | 'files'
  | 'chemistry'
  | 'biology'
  | 'literature'
  | 'web'
  | 'interaction'
  | 'system'

/** 注册表里的工具：参数 schema 已经编译好，execute 自己校验参数 */
export interface ToolDefinition {
  name: string
  description: string
  category?: ToolCategory
  parameters: ParameterJsonSchema
  output?: {
    render: (args: unknown, value: unknown) => string
    images?: (
      args: unknown,
      value: unknown,
      exec: ToolRunContext,
    ) => ToolImage[] | undefined | Promise<ToolImage[] | undefined>
  }
  /** 执行超时（ms），缺省 15000 */
  timeoutMs?: number
  /** 模型可见结果的字符上限，缺省 4000 */
  maxResultChars?: number
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
}

/** 作者写的工具定义：参数和返回值都有类型 */
export interface DefineToolOptions<S extends ParameterSchemaSpec, V> {
  name: string
  description: string
  /** 分类（见 {@link ToolCategory}），缺省归入 system */
  category?: ToolCategory
  parameters: S
  /** 缺省时字符串原样返回，其余 JSON.stringify */
  output?: {
    /** 把返回值渲染成模型可见的文本 */
    render: (args: InferArgs<S>, value: V) => string
    /**
     * 工具附带的图像。返回 undefined 表示本次没有图；不要返回空数组，
     * 运行时对非空返回值一律做「1–4 张」校验。
     */
    images?: (
      args: InferArgs<S>,
      value: V,
      exec: ToolRunContext,
    ) => ToolImage[] | undefined | Promise<ToolImage[] | undefined>
  }
  /** 执行超时（ms），缺省 15000 */
  timeoutMs?: number
  /**
   * 模型可见结果的字符上限，缺省 4000。只给内容本身就该完整的工具调高
   * （如技能文档全文），被截断会让模型读不到后半段。
   */
  maxResultChars?: number
  execute(args: InferArgs<S>, exec: ToolRunContext): Promise<V>
}

/** 模型给的参数不符合 schema */
export class ToolArgsError extends Error {
  readonly code = 'INVALID_ARGS'
  constructor(readonly violations: string[]) {
    super(`invalid arguments: ${violations.join('; ')}`)
    this.name = 'ToolArgsError'
  }
}

/**
 * 编译参数 schema，返回注册表能用的定义。schema 写法不对时直接抛错。
 * 执行时先校验参数，通过后才调用 execute，所以 execute 和 render 拿到的参数符合类型。
 */
export function defineTool<const S extends ParameterSchemaSpec, V>(
  options: DefineToolOptions<S, V>,
): ToolDefinition {
  const { name, timeoutMs, output } = options
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new Error(`defineTool(${name}): timeoutMs must be a positive finite number`)
  }
  const parameters = compileParameters(options.parameters)
  return {
    name,
    description: options.description,
    ...(options.category ? { category: options.category } : {}),
    parameters,
    ...(output
      ? {
          output: {
            render: (args, value) => output.render(args as InferArgs<S>, value as V),
            ...(output.images
              ? { images: (args, value, exec) => output.images!(args as InferArgs<S>, value as V, exec) }
              : {}),
          },
        }
      : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(options.maxResultChars !== undefined ? { maxResultChars: options.maxResultChars } : {}),
    async execute(args, exec) {
      const violations = validateJsonSchemaValue(parameters, args, '')
      if (violations.length) throw new ToolArgsError(violations)
      return options.execute(args as InferArgs<S>, exec)
    },
  }
}

/** 发给模型的工具描述；外部证据类工具附上引用约定 */
export function toToolSchema(def: ToolDefinition): ToolSchema {
  return {
    name: def.name,
    description:
      def.description +
      (['chemistry', 'biology', 'literature', 'web'].includes(def.category ?? '')
        ? INLINE_CITATION_TOOL_HINT
        : ''),
    parameters: structuredClone(def.parameters),
  }
}

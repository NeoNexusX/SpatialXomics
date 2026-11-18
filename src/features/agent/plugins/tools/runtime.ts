/**
 * ctx.tools 服务：工具注册表和执行管线。
 *
 * 工具通过 `register(def)` 注册，重名抛错，随注册方的 fiber 卸载自动注销。
 * 一次调用：冻结参数 → tools/pre-execute 闸门 → 带超时执行（定义自己先校验参数）→
 * 渲染并截断 → tools/post-execute 改写 → tools/result 通知。
 * 任何失败都变成一条 `Error: <message>` 结果回给模型，不会中断这一轮。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { ToolSchema, ToolImage } from '../llm'
import type { Session } from '../session'
import { toToolSchema, type ToolDefinition, type ToolRunContext } from './defineTool'
import { deepFreeze } from './json'
import { abortable } from '../llm'
import { validateToolImages } from '../attachments'
import { TOOL_RESULT_CHARS_DEFAULT } from './limits'

/** 工具执行超时（ms） */
const TOOL_TIMEOUT_MS = 15000

/** 工具执行结果（管线产出） */
export interface ToolExecutionResult {
  /** 工具执行是否以错误结束 */
  isError: boolean
  /** 原始返回值（非错误时） */
  value?: unknown
  /** 失败原因；code 区分未知工具、参数错误、拒绝、取消、超时等 */
  error?: { message: string; code?: string }
  /** 模型可见的文本摘要（截断到 配置上限） */
  content: string
  /** 截断发生时的完整渲染文本（仅超出 配置上限时存在）。
   *  content 不超过工具的结果上限，调用方不能靠 content.length 判断
   *  是否截断——以本字段为准（存档据此写全文）。 */
  fullContent?: string
  images?: ToolImage[]
  maxResultChars?: number
}

/** pre-execute 闸门的否决决定（放行时不返回） */
export interface ToolGateDecision {
  kind: 'deny'
  reason?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tools: ToolRuntime
  }
  /** 工具执行管线的扩展点事件 */
  interface Events {
    /** 执行前闸门：返回 { kind: 'deny' } 短路（serial） */
    'tools/pre-execute'(
      exec: ToolRunContext,
    ): ToolGateDecision | void | Promise<ToolGateDecision | void>
    /** 执行后改写（waterfall）：可调用 next() 拿默认结果再改写 */
    'tools/post-execute'(exec: ToolRunContext, next: () => ToolExecutionResult): ToolExecutionResult
    /** 结果通知（仅观察，不可变更） */
    'tools/result'(exec: ToolRunContext, result: ToolExecutionResult): void
  }
}

/** 一条失败结果：模型看到 `Error: <message>` */
export function toolError(message: string, code?: string): ToolExecutionResult {
  return {
    isError: true,
    error: { message, ...(code ? { code } : {}) },
    content: `Error: ${message}`,
  }
}

/** 闸门放行前调用方就取消了：工具没有运行 */
function abortedBeforeDispatch(): ToolExecutionResult {
  return toolError('tool call aborted before dispatch', 'ABORTED_BEFORE_DISPATCH')
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    if (typeof error.message === 'string') return error.message
  }
  return String(error)
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

export class ToolRuntime extends Service {
  static inject = ['systemPrompt']

  private registry = new Map<string, ToolDefinition>()

  constructor(ctx: Context) {
    super(ctx, 'tools')
    ctx.systemPrompt.section({
      key: 'tools',
      order: 30,
      render: () =>
        '## Available Tools\n' +
        this.list()
          .sort((a, b) => a.name.localeCompare(b.name))
          // Full descriptions already travel in the model's tool schemas on every request.
          .map((tool) => `- ${tool.name} (${tool.category ?? 'system'})`)
          .join('\n'),
    })
  }

  /** 注册一个工具定义；重名抛错。返回注销函数，也随注册方的 fiber 自动注销。 */
  register(def: ToolDefinition): () => void {
    if (this.registry.has(def.name)) {
      throw new Error(`tool "${def.name}" is already registered`)
    }
    const { registry } = this
    return this.ctx.effect(() => {
      registry.set(def.name, def)
      return () => {
        registry.delete(def.name)
      }
    })
  }

  /** 获取所有已注册工具 schema（供 LLM tools 字段 + system prompt 工具列表） */
  schemas(): ToolSchema[] {
    return [...this.registry.values()].map((d) => toToolSchema(d))
  }

  /** 获取所有已注册工具定义（含 category 等本地元数据，供 prompt 分组展示） */
  list(): ToolDefinition[] {
    return [...this.registry.values()]
  }

  /**
   * 执行一个工具调用。
   *
   * 1. 参数复制一份并冻结，闸门和工具看到同一份；已取消的调用不再派发
   * 2. ctx.serial('tools/pre-execute', exec) → { kind: 'deny', reason } 短路
   * 3. 超时包裹 + def.execute(args, exec)，定义先校验参数，不合法抛 INVALID_ARGS
   * 4. ctx.waterfall('tools/post-execute', exec, result) → 可替换 content
   * 5. ctx.emit('tools/result', exec, result)（仅观察）
   */
  async execute(call: {
    callId: string
    name: string
    arguments: unknown
    signal: AbortSignal
    allowedTools?: string[]
    session?: Session
  }): Promise<ToolExecutionResult> {
    const exec: ToolRunContext = {
      signal: call.signal,
      callId: call.callId,
      name: call.name,
      session: call.session,
      arguments: deepFreeze(structuredClone(call.arguments)),
    }
    const def = this.registry.get(call.name)
    const result = exec.signal.aborted
      ? abortedBeforeDispatch()
      : !def || (call.allowedTools && !call.allowedTools.includes(call.name))
        ? toolError(`unknown tool "${call.name}"`, 'UNKNOWN_TOOL')
        : await this.dispatch(def, exec)

    // cordis waterfall 语义：末参是内置 next 回调；无监听器时 next() 即返回默认值。
    const output = this.ctx.waterfall('tools/post-execute', exec, () => result)
    this.ctx.emit('tools/result', exec, output)
    return output
  }

  private async dispatch(def: ToolDefinition, exec: ToolRunContext): Promise<ToolExecutionResult> {
    let decision: ToolGateDecision | void
    try {
      decision = await abortable(() => this.ctx.serial('tools/pre-execute', exec), exec.signal)
    } catch (error) {
      if (exec.signal.aborted) return abortedBeforeDispatch()
      return toolError(errorMessage(error), errorCode(error))
    }
    if (exec.signal.aborted) return abortedBeforeDispatch()
    if (decision?.kind === 'deny') return toolError(decision.reason || 'tool call denied', 'DENIED')

    const timeoutMs = def.timeoutMs ?? TOOL_TIMEOUT_MS
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), timeoutMs)
    const signal = AbortSignal.any([exec.signal, deadline.signal])
    try {
      const work = async () => {
        const workExec = { ...exec, signal }
        const value = await def.execute(exec.arguments, workExec)
        signal.throwIfAborted()
        const images = await def.output?.images?.(exec.arguments, value, workExec)
        signal.throwIfAborted()
        if (images) validateToolImages(images)
        return { value, images }
      }
      const { value, images } = await abortable(work, signal)
      const rendered = def.output
        ? def.output.render(exec.arguments, value)
        : typeof value === 'string'
          ? value
          : (JSON.stringify(value) ?? 'null')
      const limit = def.maxResultChars ?? TOOL_RESULT_CHARS_DEFAULT
      const truncated = rendered.length > limit
      return {
        isError: false,
        value,
        content: truncated ? truncate(rendered, Math.max(0, limit - 160)) : rendered,
        maxResultChars: limit,
        ...(images?.length ? { images } : {}),
        ...(truncated ? { fullContent: rendered } : {}),
      }
    } catch (error) {
      if (exec.signal.aborted) return toolError('tool call aborted', 'ABORTED')
      if (deadline.signal.aborted) {
        return toolError(`tool call timed out after ${timeoutMs}ms`, 'TOOL_TIMEOUT')
      }
      return toolError(errorMessage(error), errorCode(error))
    } finally {
      clearTimeout(timer)
    }
  }
}

/** 截断文本到最大字符数 */
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const suffix = '…[truncated]'
  return text.slice(0, Math.max(0, maxChars - suffix.length)) + suffix.slice(0, maxChars)
}

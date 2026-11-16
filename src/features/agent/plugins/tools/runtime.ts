/**
 * ctx.tools 服务：工具注册表 + 执行管线。
 *
 * 工具通过 `register(def)` 注册，重名抛错；随 fiber 卸载自动注销。
 * 执行管线：validateArgs → pre-execute(bail) → execute(超时) → post-execute(waterfall) → result(emit)。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { ToolSchema, ToolImage } from '../llm'
import type { Session } from '../session'
import { validateArgs, toToolSchema, type ToolDefinition, type ToolRunContext } from './defineTool'
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
  /** 错误信息（isError 时） */
  error?: { message: string }
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
  /** 工具执行管线的扩展点事件（此前未声明，宽索引签名掩盖了拼写检查） */
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
      throw new Error(`Tool "${def.name}" is already registered`)
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
   * 管线（全部经 ctx 事件，插件可扩展）：
   * 1. validateArgs → 失败返回 INVALID_ARGS 错误结果
   * 2. ctx.serial('tools/pre-execute', exec) → { kind: 'deny', reason } 短路
   * 3. 超时包裹 + def.execute(args, exec)
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
    call.signal.throwIfAborted()
    const def = this.registry.get(call.name)
    if (!def || (call.allowedTools && !call.allowedTools.includes(call.name))) {
      return {
        isError: true,
        error: { message: `Unknown tool: "${call.name}"` },
        content: `Error: Unknown tool "${call.name}"`,
      }
    }

    const exec: ToolRunContext = {
      signal: call.signal,
      callId: call.callId,
      name: call.name,
      session: call.session,
    }

    // 1. 参数校验
    const validated = validateArgs(def, call.arguments)
    if (!validated.valid) {
      const msg = validated.errors!.map((e) => `${e.field}: ${e.message}`).join('; ')
      return {
        isError: true,
        error: { message: msg },
        content: `Invalid arguments for "${call.name}": ${msg}`,
      }
    }

    // 2. pre-execute 闸门
    // serial 返回 Promise；如果插件返回 { kind: 'deny' }，则短路
    const decision = await abortable(() => this.ctx.serial('tools/pre-execute', exec), call.signal)
    call.signal.throwIfAborted()
    if (decision && decision.kind === 'deny') {
      return {
        isError: true,
        error: { message: decision.reason || 'Denied' },
        content: `Tool "${call.name}" was denied: ${decision.reason || 'user denied'}`,
      }
    }

    // 3. 执行 + 超时
    const timeoutMs = def.timeoutMs ?? TOOL_TIMEOUT_MS
    let result: ToolExecutionResult

    try {
      const controller = new AbortController()
      const timeout = setTimeout(
        () => controller.abort(new Error(`Tool execution timed out after ${timeoutMs}ms`)),
        timeoutMs,
      )
      const workSignal = AbortSignal.any([call.signal, controller.signal])
      const work = async () => {
        const workExec = { ...exec, signal: workSignal }
        const value = await def.execute(validated.args, workExec)
        workSignal.throwIfAborted()
        const images = await def.output?.images?.(validated.args, value, workExec)
        workSignal.throwIfAborted()
        if (images) validateToolImages(images)
        return { value, images }
      }
      let completed: Awaited<ReturnType<typeof work>>
      try {
        completed = await abortable(work, workSignal)
      } finally {
        clearTimeout(timeout)
      }
      const { value, images } = completed
      const rendered = def.output?.render
        ? def.output.render(validated.args, value)
        : typeof value === 'string'
          ? value
          : (JSON.stringify(value) ?? 'null')
      const warnings = validated.warnings.length ? `\n[${validated.warnings.join('; ')}]` : ''
      const limit = def.maxResultChars ?? TOOL_RESULT_CHARS_DEFAULT
      const needsTruncation = rendered.length + warnings.length > limit
      const capped =
        truncate(rendered, Math.max(0, limit - warnings.length - (needsTruncation ? 160 : 0))) +
        warnings
      result = {
        isError: false,
        value,
        content: capped,
        maxResultChars: limit,
        ...(images?.length ? { images } : {}),
        fullContent: needsTruncation ? rendered : undefined,
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || call.signal.aborted) {
        result = {
          isError: true,
          error: { message: 'Aborted' },
          content: `Tool "${call.name}" was aborted`,
        }
      } else {
        const msg = err?.message || 'Unknown error'
        result = {
          isError: true,
          error: { message: msg },
          content: `Error executing "${call.name}": ${msg}`,
        }
      }
    }

    // 4. post-execute waterfall（可替换 content）
    // cordis waterfall 语义：末参是内置 next 回调；无监听器时 next() 即返回默认值。
    // 监听器签名为 (exec, next)，可调用 next() 拿默认结果再改写后返回。
    const output = this.ctx.waterfall('tools/post-execute', exec, () => result)

    // 5. result 通知（仅观察）
    this.ctx.emit('tools/result', exec, output)

    return output
  }
}

/** 截断文本到最大字符数 */
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const suffix = '…[truncated]'
  return text.slice(0, Math.max(0, maxChars - suffix.length)) + suffix.slice(0, maxChars)
}

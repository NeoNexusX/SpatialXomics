/**
 * ctx.tools 服务：工具注册表 + 执行管线。
 *
 * 工具通过 `register(def)` 注册，重名抛错；随 fiber 卸载自动注销。
 * 执行管线：validateArgs → pre-execute(bail) → execute(超时) → post-execute(waterfall) → result(emit)。
 */

import { Context, Service } from 'cordis'
import type { ToolSchema } from '../agenttypes/assistant'
import {
  defineTool,
  validateArgs,
  toToolSchema,
  type ToolDefinition,
  type ToolRunContext,
} from '../tools/defineTool'
import { TOOL_RESULT_CHARS, TOOL_TIMEOUT_MS } from '../agentconfig/defaults'

// re-export for consumers
export { defineTool, validateArgs, toToolSchema }
export type { ToolDefinition, ToolRunContext }

/** 工具执行结果（管线产出） */
export interface ToolExecutionResult {
  /** 工具执行是否以错误结束 */
  isError: boolean
  /** 原始返回值（非错误时） */
  value?: unknown
  /** 错误信息（isError 时） */
  error?: { message: string }
  /** 模型可见的文本摘要（截断到 TOOL_RESULT_CHARS） */
  content: string
  /** 截断发生时的完整渲染文本（仅超出 TOOL_RESULT_CHARS 时存在）。
   *  content 永远 ≤ TOOL_RESULT_CHARS，调用方不能靠 content.length 判断
   *  是否截断——以本字段为准（agentLoop 据此写 OPFS 存档）。 */
  fullContent?: string
}

/** pre-execute 闸门的否决决定（放行时不返回） */
export interface ToolGateDecision {
  kind: 'deny'
  reason?: string
}

declare module 'cordis' {
  interface Context {
    tools: ToolRuntime
  }
  /** 工具执行管线的扩展点事件（此前未声明，宽索引签名掩盖了拼写检查） */
  interface Events {
    /** 执行前闸门：返回 { kind: 'deny' } 短路（serial） */
    'tools/pre-execute'(exec: ToolRunContext): ToolGateDecision | void
    /** 执行后改写（waterfall）：可调用 next() 拿默认结果再改写 */
    'tools/post-execute'(
      exec: ToolRunContext,
      next: () => ToolExecutionResult,
    ): ToolExecutionResult
    /** 结果通知（仅观察，不可变更） */
    'tools/result'(exec: ToolRunContext, result: ToolExecutionResult): void
  }
}

export class ToolRuntime extends Service {
  private registry = new Map<string, ToolDefinition>()

  constructor(ctx: Context) {
    super(ctx, 'tools')
  }

  /** 注册一个工具定义；重名抛错。返回注销函数（随 fiber 自动回收）。 */
  register(def: ToolDefinition): () => void {
    if (this.registry.has(def.name)) {
      throw new Error(`Tool "${def.name}" is already registered`)
    }
    this.registry.set(def.name, def)
    return () => {
      this.registry.delete(def.name)
    }
  }

  /** 获取所有已注册工具 schema（供 LLM tools 字段 + system prompt 工具列表） */
  schemas(): ToolSchema[] {
    return [...this.registry.values()].map((d) => toToolSchema(d))
  }

  /** 获取所有已注册工具定义（含 category 等本地元数据，供 prompt 分组展示） */
  list(): ToolDefinition[] {
    return [...this.registry.values()]
  }

  /** 获取单个工具定义 */
  get(name: string): ToolDefinition | undefined {
    return this.registry.get(name)
  }

  /**
   * 执行一个工具调用。
   *
   * 管线（对应 dsh 事件流，全部经 ctx 事件，插件可扩展）：
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
  }): Promise<ToolExecutionResult> {
    const def = this.registry.get(call.name)
    if (!def) {
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
    const decision = await this.ctx.serial('tools/pre-execute', exec)
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
      const value = await withTimeout(
        def.execute(validated.args, exec),
        timeoutMs,
        call.signal,
      )
      // output.render 缺省：字符串原样、其余 JSON.stringify（全部内置工具同此）。
      // 自定义 render 的产出不再被一刀切——render 本身就是工具对「模型可见文本」
      // 的完整控制点（read_archived_result 的取回指引都在 render 里处理），仍需
      // 截断的工具在自己的 render 里截。默认渲染按工具自己的 maxResultChars
      // （缺省 TOOL_RESULT_CHARS=2000）截断——skill 加载的 SKILL.md 全文是
      // 3k-10k 字符的工作流文档，必须放宽：被截到 2k 会让模型读不到工作流后半段
      //（生物化学工具编排）和输出模板，此前已发生。
      const customRender = def.output?.render
      const rendered = customRender
        ? customRender(validated.args, value)
        : typeof value === 'string'
          ? value
          : JSON.stringify(value)
      const limit = def.maxResultChars ?? TOOL_RESULT_CHARS
      const capped = customRender ? rendered : truncate(rendered, limit)
      result = {
        isError: false,
        value,
        content: capped,
        // fullContent 只在管线真的截断时存在（否则全文会被重复写档）；
        // 自定义 render 豁免截断后由 render 自己负责内容完整性。
        fullContent: capped.length < rendered.length ? rendered : undefined,
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

/** 带超时 + 外部 abort 的 Promise 包装 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Tool execution timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })

    promise
      .then((value) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      })
      .catch((err) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        reject(err)
      })
  })
}

/** 截断文本到最大字符数 */
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars - 14) + '…[truncated]'
}

/**
 * 工具提供者插件：注册 ToolRuntime 服务。
 */
export const toolsProvider = (ctx: Context) => {
  new ToolRuntime(ctx)
}
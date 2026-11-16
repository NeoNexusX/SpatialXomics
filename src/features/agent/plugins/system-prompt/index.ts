/**
 * ctx.systemPrompt 服务：系统提示词的段注册表。
 *
 * 每段由负责它的插件注册，按 order 排序后拼接；返回空字符串的段不输出。
 * 外部指令文档原样输出。同样的输入必须渲染出同样的字节，否则端点的提示词缓存会失效。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { AnalysisBinding, Session } from '../session'

declare module '@deepseek-ai/cordis' {
  interface Context {
    systemPrompt: SystemPrompt
  }
}

export interface PromptContext {
  session: Session
  binding: AnalysisBinding
}

export interface PromptSection {
  key: string
  order: number
  render(context: PromptContext): string
}

export class SystemPrompt extends Service {
  private sections: PromptSection[] = []

  constructor(ctx: Context) {
    super(ctx, 'systemPrompt')
  }

  /** 注册一段，随注册方的 fiber 卸载；key 重复抛错 */
  section(section: PromptSection): void {
    if (this.sections.some((item) => item.key === section.key))
      throw new Error(`Duplicate prompt section ${section.key}`)
    const { sections } = this
    this.ctx.effect(() => {
      sections.push(section)
      return () => {
        sections.splice(sections.indexOf(section), 1)
      }
    })
  }

  render(context: PromptContext): string {
    return [...this.sections]
      .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
      .map((section) => section.render(context))
      .filter(Boolean)
      .join('\n\n')
  }
}

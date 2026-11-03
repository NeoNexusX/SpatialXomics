/** ctx.skills 服务：技能注册表。本身不含技能内容，由来源插件注册 provider */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SkillSummary } from './types'

export type { SkillSummary }

declare module '@deepseek-ai/cordis' {
  interface Context {
    skills: SkillsRegistry
  }
}

// ---- Provider 接口 ----

export interface SkillProvider {
  name: string
  list(): SkillSummary[]
  load(name: string): Promise<string>
}

// ---- SkillsRegistry 服务 ----

export class SkillsRegistry extends Service {
  private providers = new Map<string, SkillProvider>()

  constructor(ctx: Context) {
    super(ctx, 'skills')
  }

  /** 注册一个 skill provider */
  registerProvider(name: string, provider: SkillProvider): () => void {
    if (this.providers.has(name)) throw new Error(`Skill provider "${name}" is already registered`)
    return this.ctx.effect(() => {
      this.providers.set(name, provider)
      return () => {
        this.providers.delete(name)
      }
    })
  }

  /** 返回所有已注册技能的目录（name + description + whenToUse） */
  catalog(): SkillSummary[] {
    const result: SkillSummary[] = []
    for (const p of this.providers.values()) {
      result.push(...p.list())
    }
    return result
  }

  /** 按名称加载技能正文 */
  async load(name: string): Promise<string> {
    for (const p of this.providers.values()) {
      if (!p.list().some((skill) => skill.name === name)) continue
      const body = await p.load(name)
      if (!body.trim()) throw new Error(`Skill "${name}" is empty in provider "${p.name}"`)
      return body
    }
    throw new Error(`Skill "${name}" not found in any provider`)
  }
}

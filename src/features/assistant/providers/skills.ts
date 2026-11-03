/**
 * ctx.skills 服务：技能注册表 + import.meta.glob 内置 provider。
 *
 * 技能 SKILL.md 文件位于 ../skills/<name>/SKILL.md，frontmatter 格式：
 * ```
 * ---
 * name: msi-analysis
 * description: MSI data analysis workflow
 * whenToUse: When the user asks about analyzing MSI data
 * ---
 * # Body content
 * ```
 *
 * 前端手写正则解析 frontmatter（~30 行，不引 yaml 依赖）。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SkillSummary } from '../agenttypes/assistant'

declare module '@deepseek-ai/cordis' {
  interface Context {
    skills: SkillsRegistry
  }
}

// ---- Frontmatter 解析 ----

interface SkillFrontmatter {
  name: string
  description: string
  whenToUse?: string
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n/

function parseSkillMd(raw: string): { frontmatter: SkillFrontmatter; body: string } | null {
  const match = raw.match(FRONTMATTER_RE)
  if (!match) return null

  const fm: SkillFrontmatter = { name: '', description: '' }
  for (const line of match[1]!.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx < 0) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()
    if (key === 'name' || key === 'description' || key === 'whenToUse') {
      ;(fm as any)[key] = value
    }
  }
  if (!fm.name || !fm.description) return null

  const body = raw.slice(match[0].length).trim()
  return { frontmatter: fm, body }
}

// ---- Provider 接口 ----

export interface SkillProvider {
  name: string
  list(): SkillSummary[]
  load(name: string): Promise<string>
}

// ---- 内置 glob provider ----

/**
 * 应用内打包的 skills provider。
 *
 * 使用 Vite import.meta.glob 在构建时扫描 ../skills/* /SKILL.md，
 * 前端无需文件系统访问，所有技能内容随应用打包。
 */
export function createGlobSkillProvider(): SkillProvider {
  // import.meta.glob eager 内联（文件仅几 KB）：目录在构造时同步就绪。
  // 此前懒加载 + 无启动初始化，catalog 永远为空 —— 系统提示的
  // "Available Skills" 段永远不渲染，模型无从得知技能名（技能系统不可达）。
  const modules = import.meta.glob<string>('../skills/*/SKILL.md', {
    query: '?raw',
    import: 'default',
    eager: true,
  })

  const catalog: SkillSummary[] = []
  const bodyCache = new Map<string, string>()

  for (const raw of Object.values(modules)) {
    const parsed = parseSkillMd(raw)
    if (parsed) {
      catalog.push({
        name: parsed.frontmatter.name,
        description: parsed.frontmatter.description,
        whenToUse: parsed.frontmatter.whenToUse,
      })
      bodyCache.set(parsed.frontmatter.name, parsed.body)
    }
  }

  return {
    name: 'bundled',
    list(): SkillSummary[] {
      return catalog
    },
    async load(name: string): Promise<string> {
      const body = bodyCache.get(name)
      if (!body) throw new Error(`Skill "${name}" not found`)
      return body
    },
  }
}

// ---- SkillsRegistry 服务 ----

export class SkillsRegistry extends Service {
  private providers = new Map<string, SkillProvider>()

  constructor(ctx: Context) {
    super(ctx, 'skills')
  }

  /** 注册一个 skill provider */
  registerProvider(name: string, provider: SkillProvider): () => void {
    this.providers.set(name, provider)
    return () => {
      this.providers.delete(name)
    }
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
      try {
        const body = await p.load(name)
        if (body) return body
      } catch {
        // 继续尝试下一个 provider
      }
    }
    throw new Error(`Skill "${name}" not found in any provider`)
  }
}

// ---- 插件入口 ----

export const skillsProvider = (ctx: Context) => {
  const registry = new SkillsRegistry(ctx)
  const globProvider = createGlobSkillProvider()
  registry.registerProvider('bundled', globProvider)
}
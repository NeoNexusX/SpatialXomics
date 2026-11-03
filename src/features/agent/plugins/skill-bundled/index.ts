/**
 * 随应用打包的技能来源。
 *
 * 技能文件位于 ./skills/<name>/SKILL.md，frontmatter 格式：
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

import type { Context } from '@deepseek-ai/cordis'
import type { SkillProvider, SkillSummary } from '../skill'

export const name = 'skill-bundled'
export const inject = ['skills']

export function apply(ctx: Context) {
  ctx.skills.registerProvider('bundled', createBundledSkillProvider())
}

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
      fm[key] = value
    }
  }
  if (!fm.name || !fm.description) return null

  const body = raw.slice(match[0].length).trim()
  return { frontmatter: fm, body }
}

/**
 * 应用内打包的 skills provider。
 *
 * 使用 Vite import.meta.glob 在构建时扫描 ./skills/* /SKILL.md，
 * 前端无需文件系统访问，所有技能内容随应用打包。
 */
export function createBundledSkillProvider(): SkillProvider {
  // import.meta.glob eager 内联（文件仅几 KB）：目录在构造时同步就绪。
  // 此前懒加载 + 无启动初始化，catalog 永远为空 —— 系统提示的
  // "Available Skills" 段永远不渲染，模型无从得知技能名（技能系统不可达）。
  const modules = import.meta.glob<string>('./skills/*/SKILL.md', {
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

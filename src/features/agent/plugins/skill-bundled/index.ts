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

interface BundledSkillResource {
  skill: string
  load: () => Promise<string>
}

const REPORT_TEMPLATE_RESOURCES: Record<string, { skill: string; path: string }> = {
  'report-template:annotation-review:en': {
    skill: 'report-writing',
    path: './skills/report-writing/references/report-templates/annotation-review.en.md',
  },
}

/**
 * 应用内打包的 skills provider。
 *
 * 使用 Vite import.meta.glob 在构建时扫描 Skill 正文；报告模板等参考资源
 * 通过独立的动态 glob 按需载入，不随正文一起进上下文。
 *
 * 只注册英文模板：中文译本仅供本地阅读，不入库、不注册，Skill 正文也不得引用它。
 * 报告语言由「用用户的语言写」这条规则决定，与模板本身的语言无关。
 */
export function createBundledSkillProvider(): SkillProvider {
  const modules = import.meta.glob<string>('./skills/*/SKILL.md', {
    query: '?raw',
    import: 'default',
    eager: true,
  })
  const resourceModules = import.meta.glob<string>('./skills/report-writing/references/report-templates/*.md', {
    query: '?raw',
    import: 'default',
  })

  const catalog: SkillSummary[] = []
  const bodyCache = new Map<string, string>()
  const resources = new Map<string, BundledSkillResource>()

  for (const [resourceId, definition] of Object.entries(REPORT_TEMPLATE_RESOURCES)) {
    const load = resourceModules[definition.path]
    if (load) resources.set(resourceId, { skill: definition.skill, load })
  }

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
    async loadResource(name: string, resourceId: string): Promise<string> {
      const resource = resources.get(resourceId)
      if (!resource || resource.skill !== name) {
        throw new Error(`Resource "${resourceId}" is not available for skill "${name}"`)
      }
      return (await resource.load()).trim()
    },
  }
}

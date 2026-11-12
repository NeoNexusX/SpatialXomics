/** 让模型发现和加载技能：提示词里列目录，`skill` 工具按名称取正文 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '../tools'

export const name = 'tool-skill'
export const inject = ['tools', 'skills', 'systemPrompt']

export function apply(ctx: Context) {
  ctx.systemPrompt.section({
    key: 'skills',
    order: 20,
    render: () => {
      const skills = ctx.skills.catalog()
      return skills.length
        ? '## Available Skills\n' +
            skills
              .map(
                (skill) =>
                  `- ${skill.name}: ${skill.description}${skill.whenToUse ? ` (${skill.whenToUse})` : ''}`,
              )
              .join('\n')
        : ''
    },
  })

  /**
   * skill —— 按名称加载领域技能正文。
   *
   * 作用：返回该技能的完整 SKILL.md（maxResultChars 提到 12k，保证末尾的工作流与
   * 输出模板不被截断）。可用技能名录由 system prompt 的 skills 节列出。
   *
   * 参数：
   * - name (string, 必填)：目录中的技能名
   */
  ctx.tools.register(
    defineTool({
      category: 'system',
      name: 'skill',
      // Keep the complete workflow visible, including instructions near its end.
      maxResultChars: 12_000,
      description:
        'Load a domain skill by name when its detailed workflow or output guidance is relevant to the ' +
        'current task. Returns the skill text for this turn. Use names exactly as listed in the system ' +
        'prompt; do not guess names or load unrelated skills for simple tasks.',
      parameters: {
        name: {
          type: 'string',
          required: true,
          description: 'Exact skill name from the system-prompt catalog.',
        },
      },
      async execute(args) {
        return await ctx.skills.load(args.name!)
      },
    }),
  )
}

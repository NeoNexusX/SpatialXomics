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

  ctx.tools.register(
    defineTool({
      category: 'system',
      name: 'skill',
      // Keep the complete workflow visible, including instructions near its end.
      maxResultChars: 12_000,
      description:
        'Load a domain skill by name to get detailed analysis instructions. Available skill names are listed in the system prompt.',
      parameters: {
        name: { type: 'string', required: true, description: 'Skill name from the catalog' },
      },
      async execute(args) {
        return await ctx.skills.load(args.name!)
      },
    }),
  )
}

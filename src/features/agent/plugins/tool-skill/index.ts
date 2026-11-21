/** 让模型发现和加载技能：提示词里列目录，`skill` 工具按名称取正文 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, TOOL_RESULT_CHARS_EVIDENCE } from '../tools'

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
   * 作用：返回该技能的完整 SKILL.md（maxResultChars 提到证据上限，保证完整说明可读）；
   * 如果传入 resourceId，则仅返回对应的参考资源，避免同时注入所有模板正文。
   *
   * - name (string, 必填)：目录中的技能名
   * - resourceId (string, 可选)：该技能提供的精确资源 ID；选择模板时只返回所选模板
   */
  ctx.tools.register(
    defineTool({
      category: 'system',
      name: 'skill',
      // Keep the complete workflow visible, including instructions near its end.
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      description:
        'Load a domain skill by name when its detailed workflow or output guidance is relevant to the ' +
        'current task. Returns the skill text for this turn. For a skill that advertises resource IDs, ' +
        'pass the exact resourceId to load only that supporting reference. Use names and resource IDs ' +
        'exactly as listed in the loaded skill; do not guess names or load unrelated skills for simple tasks.',
      parameters: {
        name: {
          type: 'string',
          required: true,
          description: 'Exact skill name from the system-prompt catalog.',
        },
        resourceId: {
          type: 'string',
          description: 'Optional exact supporting resource ID documented by the selected skill.',
        },
      },
      async execute(args) {
        if (args.resourceId !== undefined) {
          return await ctx.skills.loadResource(args.name!, args.resourceId)
        }
        return await ctx.skills.load(args.name!)
      },
    }),
  )
}

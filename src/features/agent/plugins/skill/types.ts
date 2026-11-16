/** 技能目录条目（system prompt 只注入目录，正文经 skill 工具按需加载） */
export interface SkillSummary {
  name: string
  description: string
  whenToUse?: string
}

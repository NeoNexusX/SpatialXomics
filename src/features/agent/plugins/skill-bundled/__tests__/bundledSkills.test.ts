import { expect, it } from 'vitest'
import { createBundledSkillProvider } from '../index'

// import.meta.glob 的 key 与 REPORT_TEMPLATE_RESOURCES.path 必须逐字相符，
// 否则 resources.set 被静默跳过，运行时才报 "Resource ... is not available"。
// 这里走真实 provider（不 mock），把该注册路径锁住。
const provider = createBundledSkillProvider()

it('registers the annotation-review report template', async () => {
  const en = await provider.loadResource!('report-writing', 'report-template:annotation-review:en')
  for (const heading of [
    '## 1. General information',
    '## 2. Credible ions and annotations',
    '## 3. Evidence conclusions for each judged molecule',
    '## 4. Association analysis',
    '## 5. Unresolved identities and recommendations',
  ]) {
    expect(en).toContain(heading)
  }
})

// 中文译本只供本地阅读：不入库、不注册，Skill 正文也不得引用。
it('does not register a Chinese template resource', async () => {
  await expect(
    provider.loadResource!('report-writing', 'report-template:annotation-review:zh-CN'),
  ).rejects.toThrow('is not available for skill')
})

it('rejects a template requested through a skill that does not own it', async () => {
  await expect(
    provider.loadResource!('annotation-review', 'report-template:annotation-review:en'),
  ).rejects.toThrow('is not available for skill')
})

it('lists the skills the review workflow depends on', () => {
  const names = provider.list().map((s) => s.name)
  expect(names).toContain('annotation-review')
  expect(names).toContain('report-writing')
})

it('tells the review skill to load the report template before writing', async () => {
  const body = await provider.load('annotation-review')
  expect(body).toContain('report-template:annotation-review:en')
  expect(body).not.toContain('zh-CN')

  const writing = await provider.load('report-writing')
  expect(writing).toContain('report-template:annotation-review:en')
  expect(writing).not.toContain('zh-CN')
})

// 提问只用在三个工具定不了的环节，且推荐项必须是保守默认——
// 超时会自动提交推荐项，推荐「是同一分子」等于凭空捏造一次确认。
it.each(['annotation-review', 'msi-analysis'])('%s asks only at the three weak links', async (skill) => {
  const body = await provider.load(skill)
  expect(body).toContain('ask_user_question')
  expect(body).toContain('(Recommended)')
  expect(body).toContain('user-provided')
  // 提问在证据收集之后、结论之前，且不阻塞中途核查
  expect(body.indexOf('ask_user_question')).toBeGreaterThan(body.indexOf('## Confirm the weak links'))
  expect(body).toMatch(/never block in the middle of a check/i)
  // 读得到的元数据不许问
  expect(body).toContain('dataset.sourceFile')
})

it('puts the confirmation checkpoint before the verdicts in the review skill', async () => {
  const body = await provider.load('annotation-review')
  expect(body.indexOf('## Confirm the weak links')).toBeLessThan(body.indexOf('## Verdicts'))
})
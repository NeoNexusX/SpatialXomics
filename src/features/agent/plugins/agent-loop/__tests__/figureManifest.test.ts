import { describe, expect, it } from 'vitest'
import { withFigureManifest } from '../driver'
import type { ImageAttachment } from '../../llm'
import type { Session } from '../../session/session'

const ref = (id: string, label: string): ImageAttachment => ({ id, mime: 'image/png', bytes: 1, label })

function sessionWith(count: number, label = 'Tool image'): Session {
  const attachments = Array.from({ length: count }, (_, i) =>
    ref(`aaaaaaaa-${String(i).padStart(4, '0')}-4111-8111-111111111111`, label),
  )
  return {
    events: [{ type: 'message', message: { role: 'tool', attachments } }],
  } as unknown as Session
}

describe('figure manifest', () => {
  it('leaves a session without figures untouched', () => {
    const system = 'base system'
    expect(withFigureManifest(system, { events: [] } as unknown as Session)).toBe(system)
  })

  it('never truncates the system prompt, however long the manifest gets', () => {
    // 用户指令可达 64 KiB，后面还排着数据集上下文 / 技能目录 / 工具清单。
    const system = `${'x'.repeat(40_000)}\n## Available Tools\ntail marker`
    const out = withFigureManifest(system, sessionWith(80, 'y'.repeat(400)))
    expect(out.startsWith(system)).toBe(true)
    expect(out).toContain('## Available Tools\ntail marker')
    expect(out).toContain('## Session figures')
  })

  it('drops whole lines from the oldest end, never cutting a handle in half', () => {
    const out = withFigureManifest('base', sessionWith(80, 'z'.repeat(400)))
    const handles = [...out.matchAll(/session-artifact:(fig-\d+)/g)].map((m) => m[1]!)
    expect(handles.length).toBeGreaterThan(0)
    expect(handles.length).toBeLessThan(80)
    // 保留的必须是最新的连续一段，且每个句柄都完整。
    expect(handles).toEqual(
      Array.from({ length: handles.length }, (_, i) => `fig-${80 - handles.length + i + 1}`),
    )
    expect(out).toContain('earlier figure references omitted')
    expect(out).not.toMatch(/session-artifact:fig-\d+\]/)
  })

  it('keeps every reference when they all fit', () => {
    const out = withFigureManifest('base', sessionWith(3))
    expect(out).toContain('fig-1')
    expect(out).toContain('fig-3')
    expect(out).not.toContain('omitted')
  })
})
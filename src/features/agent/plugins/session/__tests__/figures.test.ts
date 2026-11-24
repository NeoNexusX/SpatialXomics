import { describe, expect, it } from 'vitest'
import { figureHandle, resolveFigureHandle, sessionFigures } from '../figures'
import type { ImageAttachment } from '../../llm'
import type { Session } from '../session'

const ref = (id: string, label = id): ImageAttachment => ({ id, mime: 'image/png', bytes: 1, label })
const A = 'aaaaaaaa-1111-4111-8111-111111111111'
const B = 'aaaaaaaa-2222-4222-8222-222222222222'
const C = 'cccccccc-3333-4333-8333-333333333333'
const figures = [ref(A, 'Heme [M-H]-'), ref(B, 'Heme [M+Cl]-'), ref(C)]

describe('session figure handles', () => {
  it('lists tool attachments in event order, deduplicated by id, skipping user messages', () => {
    const session = {
      events: [
        { type: 'message', message: { role: 'user', content: 'hi', attachments: [ref(C)] } },
        { type: 'message', message: { role: 'tool', attachments: [ref(A), ref(B)] } },
        { type: 'step/end' },
        { type: 'message', message: { role: 'tool', attachments: [ref(A), ref(C)] } },
      ],
    } as unknown as Session
    expect(sessionFigures(session).map((figure) => figure.id)).toEqual([A, B, C])
  })

  it('numbers handles from 1 in list order and resolves them back', () => {
    expect(figures.map((_, index) => figureHandle(index))).toEqual(['fig-1', 'fig-2', 'fig-3'])
    expect(resolveFigureHandle('fig-1', figures)).toBe(A)
    expect(resolveFigureHandle('FIG-3', figures)).toBe(C)
    expect(resolveFigureHandle('fig-4', figures)).toBeUndefined()
    expect(resolveFigureHandle('fig-0', figures)).toBeUndefined()
    expect(resolveFigureHandle('fig-', figures)).toBeUndefined()
  })

  it('still accepts an exact UUID but not one outside the conversation', () => {
    expect(resolveFigureHandle(B, figures)).toBe(B)
    expect(resolveFigureHandle('dddddddd-4444-4444-8444-444444444444', figures)).toBeUndefined()
  })

  it('resolves a truncated UUID prefix only when it is unambiguous', () => {
    // 模型抄长 id 截成前 8 位：A、B 共享前缀，不能猜
    expect(resolveFigureHandle('aaaaaaaa', figures)).toBeUndefined()
    expect(resolveFigureHandle('aaaaaaaa-1111', figures)).toBe(A)
    expect(resolveFigureHandle('CCCCCCCC', figures)).toBe(C)
    // 7 位太短，不算引用
    expect(resolveFigureHandle('ccccccc', figures)).toBeUndefined()
    expect(resolveFigureHandle('not-a-handle', figures)).toBeUndefined()
    expect(resolveFigureHandle('   cccccccc  ', figures)).toBe(C)
  })
})

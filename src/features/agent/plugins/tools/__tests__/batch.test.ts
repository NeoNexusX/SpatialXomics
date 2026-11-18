import { describe, expect, it, vi } from 'vitest'
import { renderBatch } from '../batch'

describe('renderBatch（批量工具输出拼接）', () => {
  it('单项时输出不加节标题（与单查一致）', async () => {
    const out = await renderBatch(
      ['glucose'],
      (q) => q,
      (q) => `result of ${q}`,
    )
    expect(out).toBe('result of glucose')
    expect(out).not.toContain('###')
  })

  it('多项时逐项加 ### 节标题', async () => {
    const out = await renderBatch(
      ['glucose', 'palmitic acid'],
      (q) => q,
      (q) => `result of ${q}`,
    )
    expect(out).toBe('### glucose\nresult of glucose\n\n### palmitic acid\nresult of palmitic acid')
  })

  it('多项时单项失败不拖垮整批（错误文本就地成节）', async () => {
    const out = await renderBatch(
      ['ok', 'bad'],
      (q) => q,
      (q) => {
        if (q === 'bad') throw new Error('Not found in database (HTTP 404)')
        return `result of ${q}`
      },
    )
    expect(out).toContain('result of ok')
    expect(out).toContain('### bad')
    expect(out).toContain('Error: Not found in database (HTTP 404)')
  })

  it('单项时 render 抛错原样上抛（全局错误应让整次调用失败）', async () => {
    await expect(
      renderBatch(
        ['only'],
        (q) => q,
        () => {
          throw new Error('index missing')
        },
      ),
    ).rejects.toThrow('index missing')
  })

  it('bounds default batch work and continues from the returned offset', async () => {
    const items = Array.from({ length: 25 }, (_, i) => i)
    const render = vi.fn((value: number) => `result ${value}`)
    const first = await renderBatch(items, String, render)
    expect(render).toHaveBeenCalledTimes(5)
    expect(first).toContain('nextOffset=5')
    const second = await renderBatch(items, String, render, { offset: 5, limit: 100 })
    expect(second).toContain('result 5')
    expect(second).toContain('result 12')
    expect(second).not.toContain('result 13')
    expect(second).toContain('nextOffset=13')
  })
})

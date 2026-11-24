import { describe, expect, it } from 'vitest'
import { createMemoryStorage } from '../../session-persistence'
import { Attachments } from '../index'
import { Context } from '@deepseek-ai/cordis'
import type { ToolImage } from '../../llm'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg=='

function makeImage(label: string): ToolImage {
  return { dataUrl: png, mime: 'image/png', width: 1, height: 1, label }
}

describe('session figure attachments', () => {
  it('saves tool image references with labels and resolves only artifacts in the session', async () => {
    const ctx = new Context()
    const attachments = new Attachments(ctx)
    const storage = createMemoryStorage()
    const refs = await attachments.saveTools(storage, [makeImage('m/z 100')], new AbortController().signal)
    expect(refs[0]?.label).toBe('m/z 100')
    const url = await attachments.load(storage, refs[0]!.id)
    expect(url).toMatch(/^(blob:|data:image\/png;base64,)/)
    await expect(storage.getArtifact('unknown-artifact-id')).rejects.toThrow()
    attachments.release(storage)
    await storage.close()
    await ctx.fiber.dispose()
  })
})

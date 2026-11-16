import { describe, expect, it } from 'vitest'
import { BlockAssembler } from '../assembler'
import type { StreamChunk } from '../types'

function assemble(chunks: StreamChunk[]): BlockAssembler {
  const assembler = new BlockAssembler()
  for (const chunk of chunks) assembler.push(chunk)
  return assembler
}

const stop: StreamChunk = { type: 'finish', reason: { kind: 'stop' } }

describe('BlockAssembler', () => {
  it('assembles blocks by index, in the order they first appear', () => {
    const assembler = assemble([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: 'wor' },
      { type: 'reasoning-delta', index: 0, text: 'pl' },
      { type: 'text-delta', index: 1, text: 'ld' },
      { type: 'reasoning-delta', index: 0, text: 'an' },
      stop,
    ])
    expect(assembler.blocks()).toEqual([
      { type: 'reasoning', text: 'plan' },
      { type: 'text', text: 'world' },
    ])
  })

  it('assembles a delta-only stream with no block markers', () => {
    const assembler = assemble([
      { type: 'text-delta', index: 3, text: 'a' },
      { type: 'tool-call-delta', index: 7, id: 'c1', name: 'x', argumentsDelta: '{"a"' },
      { type: 'tool-call-delta', index: 7, id: 'c1', argumentsDelta: ':1}' },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ])
    expect(assembler.blocks()).toEqual([
      { type: 'text', text: 'a' },
      { type: 'tool-call', id: 'c1', name: 'x', arguments: '{"a":1}' },
    ])
  })

  it('names a tool call that never got an id', () => {
    const assembler = assemble([
      { type: 'tool-call-delta', index: 2, id: '', argumentsDelta: '{}' },
      stop,
    ])
    expect(assembler.blocks()).toEqual([
      { type: 'tool-call', id: 'call-2', name: '', arguments: '{}' },
    ])
  })

  it('keeps a tool call id when a later delta omits it', () => {
    const assembler = assemble([
      { type: 'tool-call-delta', index: 0, id: 'real', name: 'x', argumentsDelta: '{' },
      { type: 'tool-call-delta', index: 0, id: '', argumentsDelta: '}' },
      stop,
    ])
    expect(assembler.blocks()[0]).toMatchObject({ id: 'real', arguments: '{}' })
  })

  it('takes the final block over the accumulated deltas', () => {
    const assembler = assemble([
      { type: 'text-delta', index: 0, text: 'draft' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'final' } },
      stop,
    ])
    expect(assembler.blocks()).toEqual([{ type: 'text', text: 'final' }])
  })

  it('accepts a block that only ever appears at its end', () => {
    const assembler = assemble([
      {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id: 'c', name: 'x', arguments: '{}' },
      },
      stop,
    ])
    expect(assembler.blocks()).toEqual([{ type: 'tool-call', id: 'c', name: 'x', arguments: '{}' }])
  })

  it('ignores stragglers and re-closes once a block has ended', () => {
    const assembler = assemble([
      { type: 'text-delta', index: 0, text: 'done' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } },
      { type: 'text-delta', index: 0, text: ' late' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'rewritten' } },
      { type: 'tool-call-delta', index: 1, id: 'c', name: 'x', argumentsDelta: '{}' },
      {
        type: 'block-end',
        index: 1,
        block: { type: 'tool-call', id: 'c', name: 'x', arguments: '{}' },
      },
      { type: 'tool-call-delta', index: 1, id: 'other', name: 'y', argumentsDelta: 'junk' },
      stop,
    ])
    expect(assembler.blocks()).toEqual([
      { type: 'text', text: 'done' },
      { type: 'tool-call', id: 'c', name: 'x', arguments: '{}' },
    ])
  })

  it('does not reset a block on a repeated start', () => {
    const assembler = assemble([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'kept' },
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      stop,
    ])
    expect(assembler.blocks()).toEqual([{ type: 'text', text: 'kept' }])
  })

  describe('finish', () => {
    it('is stop until a finish arrives', () => {
      expect(new BlockAssembler().finish).toEqual({ kind: 'stop' })
    })

    it('keeps the failure of a failed stream', () => {
      const failure = { message: 'x', code: 'SERVER' }
      expect(assemble([{ type: 'finish', reason: { kind: 'error', failure } }]).finish).toEqual({
        kind: 'error',
        failure,
      })
    })
  })

  describe('usage', () => {
    it('reports the last one', () => {
      const assembler = assemble([
        { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
        { type: 'usage', usage: { inputTokens: 1, outputTokens: 9 } },
        stop,
      ])
      expect(assembler.usage).toEqual({ inputTokens: 1, outputTokens: 9 })
    })

    it('is undefined until one arrives', () => {
      expect(assemble([stop]).usage).toBeUndefined()
    })
  })

  describe('max-tokens', () => {
    const truncated = (replayState?: Extract<StreamChunk, { type: 'finish' }>['replayState']) =>
      assemble([
        { type: 'reasoning-delta', index: 0, text: 'plan' },
        { type: 'text-delta', index: 1, text: 'answer' },
        { type: 'tool-call-delta', index: 2, id: 'c', name: 'x', argumentsDelta: '{"a":' },
        { type: 'finish', reason: { kind: 'max-tokens' }, replayState },
      ])

    it('drops tool calls, whose arguments may be cut off, and keeps the rest', () => {
      expect(truncated().blocks()).toEqual([
        { type: 'reasoning', text: 'plan' },
        { type: 'text', text: 'answer' },
      ])
    })

    it('prunes replay entries in step with the blocks', () => {
      const replay = truncated({
        response: { model: 'm' },
        blocks: [{ type: 'reasoning', signature: 's' }, { type: 'text' }, { type: 'tool-call' }],
      }).replayState
      expect(replay).toEqual({
        response: { model: 'm' },
        blocks: [{ type: 'reasoning', signature: 's' }, { type: 'text' }],
      })
    })

    it('keeps tool calls on any other finish', () => {
      const assembler = assemble([
        { type: 'tool-call-delta', index: 0, id: 'c', name: 'x', argumentsDelta: '{}' },
        { type: 'finish', reason: { kind: 'tool-calls' } },
      ])
      expect(assembler.blocks()).toHaveLength(1)
    })
  })

  describe('replayState', () => {
    it('passes an aligned envelope through untouched', () => {
      const replayState = { response: { model: 'm' }, blocks: [{ type: 'text' }] }
      const assembler = assemble([
        { type: 'text-delta', index: 0, text: 'a' },
        { type: 'finish', reason: { kind: 'stop' }, replayState },
      ])
      expect(assembler.replayState).toBe(replayState)
    })

    it('passes a response-only envelope through', () => {
      const replayState = { response: { model: 'm' } }
      expect(
        assemble([{ type: 'finish', reason: { kind: 'stop' }, replayState }]).replayState,
      ).toBe(replayState)
    })

    it('drops an envelope whose entries do not line up with the blocks', () => {
      const assembler = assemble([
        { type: 'text-delta', index: 0, text: 'a' },
        { type: 'text-delta', index: 1, text: 'b' },
        {
          type: 'finish',
          reason: { kind: 'stop' },
          replayState: { response: {}, blocks: [{ type: 'text' }] },
        },
      ])
      expect(assembler.replayState).toBeUndefined()
      expect(assembler.blocks()).toHaveLength(2)
    })
  })

  describe('interruptedBlocks', () => {
    it('keeps closed and open text and thinking with real content', () => {
      const assembler = assemble([
        { type: 'reasoning-delta', index: 0, text: 'plan' },
        { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'plan' } },
        { type: 'text-delta', index: 1, text: 'half' },
      ])
      expect(assembler.interruptedBlocks()).toEqual([
        { type: 'reasoning', text: 'plan' },
        { type: 'text', text: 'half' },
      ])
    })

    it('omits tool calls, which never ran, and blank blocks', () => {
      const assembler = assemble([
        { type: 'text-delta', index: 0, text: '  \n' },
        { type: 'tool-call-delta', index: 1, id: 'c', name: 'x', argumentsDelta: '{}' },
        {
          type: 'block-end',
          index: 2,
          block: { type: 'tool-call', id: 'd', name: 'y', arguments: '{}' },
        },
        { type: 'block-start', index: 3, blockType: 'text' },
      ])
      expect(assembler.interruptedBlocks()).toEqual([])
    })
  })
})

import { expect, it } from 'vitest'
import { transcriptProjection } from '../index'

it('shows no marker for a compaction that did not shrink the context', () => {
  const state = transcriptProjection.init()
  transcriptProjection.apply(state, {
    type: 'compaction/end',
    compactionId: 'c',
    beforeTokens: 100,
    afterTokens: 100,
    seq: 0,
    id: 'e',
    time: 0,
  })
  expect(transcriptProjection.view(state)).toEqual([])
})

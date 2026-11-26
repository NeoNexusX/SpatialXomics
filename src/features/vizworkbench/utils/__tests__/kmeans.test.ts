import { describe, expect, it } from 'vitest'
import { embeddingWithin } from '../kmeans'

describe('embeddingWithin', () => {
  it('keeps the points inside the mask with their coordinates and vectors', () => {
    // 3×2 grid with points at (0, 0), (2, 0) and (1, 1)
    const embedding = {
      coordinates: Uint32Array.of(0, 0, 2, 0, 1, 1),
      scaledEmbedding: Float32Array.of(0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9),
      count: 3,
    }
    const subset = embeddingWithin(embedding, Uint8Array.of(0, 0, 1, 0, 1, 0), 3)

    expect(subset.count).toBe(2)
    expect(Array.from(subset.coordinates)).toEqual([2, 0, 1, 1])
    expect(subset.scaledEmbedding).toEqual(embedding.scaledEmbedding.slice(3))
  })
})

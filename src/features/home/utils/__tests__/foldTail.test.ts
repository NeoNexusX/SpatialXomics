import { describe, expect, it } from 'vitest'
import { foldTail } from '../foldTail'

const items = (...counts: number[]) => counts.map((count, i) => ({ category: `c${i}`, count }))

describe('foldTail', () => {
  it('keeps the head and folds the rest into one "other" row', () => {
    expect(foldTail(items(9, 7, 5, 3, 2, 1), 3, 'Other')).toEqual([
      { category: 'c0', count: 9 },
      { category: 'c1', count: 7 },
      { category: 'c2', count: 5 },
      { category: 'Other', count: 6, other: true },
    ])
  })

  it('folds even a single item beyond the six named categories', () => {
    expect(foldTail(items(9, 8, 7, 6, 5, 4, 3), 6, 'Others')).toEqual([
      ...items(9, 8, 7, 6, 5, 4),
      { category: 'Others', count: 3, other: true },
    ])
  })

  it('keeps six named categories and preserves the total without mutating the source', () => {
    const source = items(12, 10, 8, 6, 4, 3, 2, 1, 1)
    const before = structuredClone(source)
    const rows = foldTail(source, 6, 'Others')
    expect(rows).toHaveLength(7)
    expect(rows[rows.length - 1]).toEqual({ category: 'Others', count: 4, other: true })
    expect(rows.reduce((sum, row) => sum + row.count, 0)).toBe(47)
    expect(source).toEqual(before)
  })

  it('returns short lists unchanged', () => {
    expect(foldTail(items(4, 2), 5, 'Other')).toEqual(items(4, 2))
    expect(foldTail([], 5, 'Other')).toEqual([])
  })
})

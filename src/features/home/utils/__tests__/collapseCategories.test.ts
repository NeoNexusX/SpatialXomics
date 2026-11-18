import { describe, expect, it } from 'vitest'
import { collapseTopCategories, TOP_CATEGORY_LIMIT } from '../collapseCategories'
import type { DatasetCategoryItem } from '@/features/home/types/stats'

/** 生成 count 严格降序的 n 个分类 */
function makeItems(n: number, prefix = 'C'): DatasetCategoryItem[] {
  return Array.from({ length: n }, (_, i) => ({
    category: `${prefix}${String(i + 1).padStart(2, '0')}`,
    count: n - i,
  }))
}

describe('collapseTopCategories', () => {
  it('returns the input unchanged when there are at most N items', () => {
    const items = makeItems(TOP_CATEGORY_LIMIT)
    expect(collapseTopCategories(items, 'Other')).toBe(items)
  })

  it('keeps the top N and merges the rest into a trailing Other', () => {
    const result = collapseTopCategories(makeItems(12), 'Other')

    expect(result).toHaveLength(TOP_CATEGORY_LIMIT + 1)
    expect(result.slice(0, TOP_CATEGORY_LIMIT).map((i) => i.category)).toEqual(
      Array.from({ length: TOP_CATEGORY_LIMIT }, (_, i) => `C${String(i + 1).padStart(2, '0')}`),
    )
    // 被截掉的是 count 2 和 1
    expect(result[result.length - 1]).toEqual({ category: 'Other', count: 3 })
  })

  it('uses the localized Other label', () => {
    const result = collapseTopCategories(makeItems(11), '其他')
    expect(result[result.length - 1]?.category).toBe('其他')
  })

  it('merges into an existing Other category and moves it last', () => {
    const items: DatasetCategoryItem[] = [
      { category: 'Other', count: 100 },
      ...Array.from({ length: 10 }, (_, i) => ({ category: `C${i}`, count: 50 - i })),
    ]

    const result = collapseTopCategories(items, 'Other')

    expect(result[result.length - 1]).toEqual({ category: 'Other', count: 141 })
    expect(result.filter((i) => i.category === 'Other')).toHaveLength(1)
  })

  it('sorts by count descending and does not mutate the input', () => {
    const items = makeItems(12).reverse()
    const snapshot = items.map((i) => ({ ...i }))

    const result = collapseTopCategories(items, 'Other')

    expect(result[0]).toEqual({ category: 'C01', count: 12 })
    expect(result[result.length - 1]).toEqual({ category: 'Other', count: 3 })
    expect(items).toEqual(snapshot)
  })
})
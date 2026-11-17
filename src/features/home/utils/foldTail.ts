import type { DatasetCategoryItem } from '@/features/home/types/stats'

export interface CategoryRow extends DatasetCategoryItem {
  /** 由长尾合并出来的「其他」 */
  other?: boolean
}

/**
 * 分布图只画前 keep 项，其余合并成一项「其他」。
 * items 须已按数量从多到少排好（statsApi 已排序）。
 */
export function foldTail(
  items: DatasetCategoryItem[],
  keep: number,
  otherLabel: string,
): CategoryRow[] {
  if (items.length <= keep) return items.map((item) => ({ ...item }))
  const rest = items.slice(keep).reduce((sum, item) => sum + item.count, 0)
  return [...items.slice(0, keep), { category: otherLabel, count: rest, other: true }]
}

import type { DatasetCategoryItem } from '@/features/home/types/stats'

/** 环形图最多显示的分类数；超出部分合并成一个 Other 分段 */
export const TOP_CATEGORY_LIMIT = 10

/**
 * 只保留计数最高的前 N 项，其余合并为 Other。
 *
 * - 输入会先按计数降序排序（同分按名称排序，保证结果稳定），不改动原数组；
 * - 合并后的 Other 计数 = 所有被截掉分段之和，因此环形图总量与 tooltip 占比仍准确；
 * - 若前 N 项里已有 Other（后端可能本来就有该分类），把剩余计数并入它，
 *   并把它移到末位，避免出现两个同名分段。
 *
 * @param otherLabel Other 分段的显示文字（调用方传入 i18n 译文）
 */
export function collapseTopCategories(
  items: DatasetCategoryItem[],
  otherLabel: string,
  limit = TOP_CATEGORY_LIMIT,
): DatasetCategoryItem[] {
  if (items.length <= limit) return items

  const sorted = [...items].sort(
    (a, b) => b.count - a.count || a.category.localeCompare(b.category),
  )
  const top = sorted.slice(0, limit).map((item) => ({ ...item }))
  const restCount = sorted.slice(limit).reduce((sum, item) => sum + item.count, 0)

  const isOther = (category: string) => category === 'Other' || category === otherLabel
  const otherIndex = top.findIndex((item) => isOther(item.category))

  if (otherIndex >= 0) {
    const other = top[otherIndex]!
    top.splice(otherIndex, 1)
    top.push({ ...other, count: other.count + restCount })
    return top
  }

  top.push({ category: otherLabel, count: restCount })
  return top
}
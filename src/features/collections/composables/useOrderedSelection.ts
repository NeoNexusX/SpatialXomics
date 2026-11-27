import { computed, shallowRef } from 'vue'

/** 可选上限：数字，或每次求值的 getter（剩余名额随集合已有成员变化时用） */
export type SelectionMax = number | (() => number)

export interface OrderedSelectionOptions {
  /**
   * 可追加项数的上限（含初始项）。达到后 toggle 只允许取消已有项，不会追加。
   * 未设置时不限制。每次 toggle 时求值，便于按实时剩余名额拦截（如「300 − 现有成员数」）。
   */
  max?: SelectionMax
}

/**
 * 有序多选状态机（纯逻辑，无外部依赖）。
 *
 * Create Collection 页的核心选择状态：选中项以「选择顺序」存储（toggle 追加到
 * 尾部），下方已选列表按此顺序渲染，reorder 就是移动这个数组。选择状态独立于
 * 数据集列表的分页/搜索（那边的 datasets 每次 fetch 整页替换），因此跨页/跨
 * 搜索的选择天然持久。
 *
 * 泛型约束只需 { publicId }（文件域统一 16 位字符串标识），与组件外的桩对象
 * 都兼容；可在组件外直接调用（无生命周期钩子），便于单测。内部用 shallowRef
 * 整体替换（而非原地 splice）：既绕开泛型 ref 的 UnwrapRef 摊平问题，也让每次
 * 变更语义清晰。
 */
export function useOrderedSelection<T extends { publicId: string }>(
  initial: T[] = [],
  options: OrderedSelectionOptions = {},
) {
  const selected = shallowRef<T[]>([...initial])
  const selectedIds = computed(() => new Set(selected.value.map((d) => d.publicId)))

  function isSelected(publicId: string): boolean {
    return selectedIds.value.has(publicId)
  }

  /** 当前上限；未设置时为 Infinity（每次调用都求值，getter 形式能跟随实时名额） */
  function limit(): number {
    const raw = typeof options.max === 'function' ? options.max() : options.max
    return raw ?? Number.POSITIVE_INFINITY
  }

  /**
   * 选中（追加到尾部，选择序 = 显示序）；已选中则移除。
   * 返回是否发生了变更：达到上限时追加被拒绝（false），取消选中始终允许。
   */
  function toggle(item: T): boolean {
    const arr = selected.value
    const idx = arr.findIndex((d) => d.publicId === item.publicId)
    if (idx >= 0) {
      selected.value = arr.filter((_, i) => i !== idx)
      return true
    }
    if (arr.length >= limit()) return false
    selected.value = [...arr, item]
    return true
  }

  /** splice 语义：把 from 的项移到 to 位置。越界或相同索引时 no-op。 */
  function move(from: number, to: number): void {
    const arr = selected.value
    if (from === to) return
    if (from < 0 || from >= arr.length || to < 0 || to >= arr.length) return
    const next = [...arr]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item!)
    selected.value = next
  }

  function moveUp(index: number): void {
    move(index, index - 1)
  }

  function moveDown(index: number): void {
    move(index, index + 1)
  }

  function removeById(publicId: string): void {
    selected.value = selected.value.filter((d) => d.publicId !== publicId)
  }

  function clear(): void {
    selected.value = []
  }

  return { selected, isSelected, toggle, move, moveUp, moveDown, removeById, clear }
}

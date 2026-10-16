<script setup lang="ts">
/**
 * 通用数据库表格：列、搜索提示、数据来源提示全部来自 DatabaseSource 描述符，
 * 组件不硬编码任何具体数据库。骨架与 UserTable 一致（卡片容器 / 骨架屏 / 空态 /
 * PaginationFooter compact）；长文本列（expandable）额外提供行展开 + 复制全文。
 */
import { computed, ref, watch } from 'vue'
import PaginationFooter from '@/shared/components/PaginationFooter.vue'
import SearchInput from '@/shared/components/SearchInput.vue'
import { useToast } from '@/shared/composables/useToast'
import { t } from '@/i18n'
import type { DatabaseColumn, DatabaseRow, DatabaseSource } from '../types/database'

const props = defineProps<{
  source: DatabaseSource
  rows: DatabaseRow[]
  loading: boolean
  keyword: string
  currentPage: number
  totalPages: number
  totalItems: number
  pageSize: number
  pageRange: (number | string)[]
}>()

const emit = defineEmits<{
  (e: 'update:keyword', value: string): void
  (e: 'search'): void
  (e: 'reset'): void
  (e: 'go-to-page', page: number): void
  (e: 'change-size', size: number): void
}>()

const { showToast } = useToast()

/** 行 key：source 指定的列（缺省第一列） */
const rowKeyOf = (row: DatabaseRow): string =>
  String(row[props.source.rowKey ?? props.source.columns[0]!.key] ?? '')

const cellText = (row: DatabaseRow, col: DatabaseColumn): string => {
  const v = row[col.key]
  if (v == null || v === '') return '—'
  return col.format ? col.format(v) : String(v)
}

/** expandable 列（一个 source 至多一个；展开显示它的完整值） */
const expandedColumn = computed(() => props.source.columns.find((c) => c.expandable) ?? null)

const expandedKey = ref<string | null>(null)
const expandedValue = computed(() => {
  if (!expandedKey.value || !expandedColumn.value) return ''
  const row = props.rows.find((r) => rowKeyOf(r) === expandedKey.value)
  return row ? String(row[expandedColumn.value.key] ?? '') : ''
})

// 翻页 / 切库后展开的行可能已不在当前页，收起展开态
watch(
  () => props.rows,
  (rows) => {
    if (expandedKey.value && !rows.some((r) => rowKeyOf(r) === expandedKey.value)) {
      expandedKey.value = null
    }
  },
)

const toggleExpand = (key: string) => {
  expandedKey.value = expandedKey.value === key ? null : key
}

const copyExpanded = async () => {
  try {
    await navigator.clipboard.writeText(expandedValue.value)
    showToast(t('common.feedback.copied'), 'success')
  } catch {
    showToast(t('common.feedback.copyFailed'), 'error')
  }
}
</script>

<template>
  <div
    class="bg-base-100 rounded-2xl shadow-sm border border-base-200/60 flex flex-col overflow-hidden"
  >
    <!-- 工具栏：关键词搜索 + 数据来源提示 -->
    <div class="p-4 border-b border-base-200 flex flex-wrap items-center gap-3 bg-base-100">
      <SearchInput
        :model-value="keyword"
        :placeholder="source.searchPlaceholder()"
        class="w-full sm:w-72"
        @update:model-value="(v) => $emit('update:keyword', v)"
        @search="$emit('search')"
      />

      <button
        @click="$emit('search')"
        class="btn btn-primary rounded-lg font-medium shadow-sm flex-1 sm:flex-none kawaru-text-87"
      >
        {{ $t('common.action.search') }}
      </button>

      <button
        v-if="keyword"
        @click="$emit('reset')"
        class="btn btn-outline border border-base-300 text-base-content/70 hover:bg-base-200 font-medium flex-1 sm:flex-none kawaru-text-87"
      >
        {{ $t('common.action.clear') }}
      </button>

      <div class="flex-1"></div>

      <span
        v-if="source.note"
        class="text-sm text-base-content/50 kawaru-text-100 whitespace-nowrap"
      >
        {{ source.note() }}
      </span>
    </div>

    <!-- 手机端允许横向滚动：min-w 让表格保持可读列宽，而不是被压成几条竖线 -->
    <div class="overflow-x-auto w-full">
      <table class="table table-fixed w-full min-w-[640px]">
        <colgroup>
          <col v-for="col in source.columns" :key="col.key" :style="{ width: `${100 / source.columns.length}%` }" />
        </colgroup>
        <thead>
          <tr class="bg-base-200 text-base-content/60 border-b border-base-200 kawaru-text-112">
            <th v-for="col in source.columns" :key="col.key" class="font-medium py-3 px-4 text-center">
              {{ col.label() }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!loading && rows.length === 0">
            <td :colspan="source.columns.length" class="py-20 text-center text-base-content/40 kawaru-text-112">
              <div class="flex flex-col items-center justify-center">
                <SvgIcon type="circle_stack" class="h-10 w-10 mb-3 opacity-30" />
                <span>{{ $t('databases.table.empty') }}</span>
              </div>
            </td>
          </tr>

          <template v-if="loading">
            <tr v-for="index in 3" :key="`skel-${index}`" class="border-b border-base-200/50">
              <td v-for="col in source.columns" :key="col.key" class="py-4 px-4">
                <div class="skeleton h-5 w-4/5 rounded mx-auto"></div>
              </td>
            </tr>
          </template>

          <template v-else>
            <template v-for="row in rows" :key="rowKeyOf(row)">
              <tr
                class="hover:bg-base-200/40 group transition-colors duration-150 border-b border-base-200/50 kawaru-text-112"
              >
                <td
                  v-for="col in source.columns"
                  :key="col.key"
                  class="py-3 px-4 text-center"
                  :class="{ 'font-mono': col.mono }"
                >
                  <div v-if="col.expandable" class="flex items-center justify-center gap-1 min-w-0">
                    <span
                      class="truncate inline-block max-w-[12rem] text-base-content/80"
                      :title="cellText(row, col)"
                    >
                      {{ cellText(row, col) }}
                    </span>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs btn-circle text-base-content/40 hover:text-base-content shrink-0"
                      :aria-label="col.label()"
                      @click="toggleExpand(rowKeyOf(row))"
                    >
                      <SvgIcon :type="expandedKey === rowKeyOf(row) ? 'chevron_up' : 'chevron_down'" />
                    </button>
                  </div>
                  <template v-else>{{ cellText(row, col) }}</template>
                </td>
              </tr>
              <!-- 长文本列的展开行：完整值 + 复制 -->
              <tr
                v-if="expandedColumn && expandedKey === rowKeyOf(row)"
                class="bg-base-200/30 border-b border-base-200/50"
              >
                <td :colspan="source.columns.length" class="py-3 px-4">
                  <div class="flex items-start gap-3">
                    <div class="flex-1 min-w-0">
                      <div class="text-base-content/50 mb-1 kawaru-text-100">
                        {{ expandedColumn.label() }}
                      </div>
                      <div class="break-all font-mono text-xs leading-relaxed text-base-content/80">
                        {{ expandedValue }}
                      </div>
                    </div>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm rounded-lg kawaru-text-100 shrink-0"
                      @click="copyExpanded"
                    >
                      <SvgIcon type="duplicate" class="h-4 w-4" />
                      {{ $t('common.action.copy') }}
                    </button>
                  </div>
                </td>
              </tr>
            </template>
          </template>
        </tbody>
      </table>
    </div>

    <PaginationFooter
      variant="compact"
      :current-page="currentPage"
      :total-pages="totalPages"
      :total-items="totalItems"
      :size="pageSize"
      :page-range="pageRange"
      @go-to-page="(p) => $emit('go-to-page', p)"
      @change-size="(s) => $emit('change-size', s)"
    />
  </div>
</template>

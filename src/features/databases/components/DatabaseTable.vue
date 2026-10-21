<script setup lang="ts">
/**
 * 通用数据库表格：列、搜索提示、筛选控件、数据来源提示全部来自 DatabaseSource
 * 描述符，组件不硬编码任何具体数据库。骨架与 UserTable 一致（卡片容器 / 骨架屏 /
 * 空态 / PaginationFooter compact）；名称 / InChI 这类长文本列可复制，外链列与
 * PubChem 检索列复用注释面板的 PubChemDialog / compoundUrl 逻辑。
 */
import { ref } from 'vue'
import PaginationFooter from '@/shared/components/PaginationFooter.vue'
import SearchInput from '@/shared/components/SearchInput.vue'
import PubChemDialog from '@/features/vizworkbench/components/PubChemDialog.vue'
import { useCopyToClipboard } from '@/shared/composables/useCopyToClipboard'
import { useToast } from '@/shared/composables/useToast'
import { t } from '@/i18n'
import type {
  DatabaseColumn,
  DatabaseFilterControl,
  DatabaseFilterValue,
  DatabaseFilterValues,
  DatabaseRow,
  DatabaseSelectControl,
  DatabaseSource,
} from '../types/database'

const props = defineProps<{
  source: DatabaseSource
  rows: DatabaseRow[]
  loading: boolean
  keyword: string
  filterValues: DatabaseFilterValues
  filtersActive: boolean
  currentPage: number
  totalPages: number
  totalItems: number
  pageSize: number
  pageSizeOptions: number[]
  pageRange: (number | string)[]
}>()

const emit = defineEmits<{
  (e: 'update:keyword', value: string): void
  (e: 'update:filter', key: string, value: DatabaseFilterValue): void
  (e: 'search'): void
  (e: 'reset'): void
  (e: 'go-to-page', page: number): void
  (e: 'change-size', size: number): void
}>()

const { showToast } = useToast()
const { copy } = useCopyToClipboard()

/** 行 key：source 指定的列（缺省第一列） */
const rowKeyOf = (row: DatabaseRow): string =>
  String(row[props.source.rowKey ?? props.source.columns[0]!.key] ?? '')

const cellText = (row: DatabaseRow, col: DatabaseColumn): string => {
  const v = row[col.key]
  if (v == null || v === '') return '—'
  return col.format ? col.format(v) : String(v)
}

/** 复制按钮只对非空单元格出现；空值没啥可复制 */
const copyableValue = (row: DatabaseRow, col: DatabaseColumn): string | null => {
  const v = row[col.key]
  return v == null || v === '' ? null : String(v)
}

const copyCell = (row: DatabaseRow, col: DatabaseColumn) => {
  const text = copyableValue(row, col)
  if (text) void copy(text)
}

const linkOf = (row: DatabaseRow, col: DatabaseColumn): string | null =>
  col.link ? col.link(row) : null

// --- PubChem 检索（与注释面板同一个对话框组件） --------------------------

const pubchemOpen = ref(false)
const pubchemQuery = ref('')

const openPubChem = (row: DatabaseRow, col: DatabaseColumn) => {
  const field = col.pubchemField
  const query = field ? String(row[field] ?? '').trim() : ''
  if (!query) return
  pubchemQuery.value = query
  pubchemOpen.value = true
}

// --- 筛选控件 -------------------------------------------------------------
// select 即选即搜（离散选项无需确认）；number-range 随「搜索」/回车提交，避免每敲
// 一个数字就打一次后端。

const selectValue = (ctl: DatabaseSelectControl): string => {
  const v = props.filterValues[ctl.key]
  return typeof v === 'string' ? v : ''
}

const onSelect = (ctl: DatabaseSelectControl, event: Event) => {
  emit('update:filter', ctl.key, (event.target as HTMLSelectElement).value)
  emit('search')
}

const rangeValue = (ctl: DatabaseFilterControl): { min?: number; max?: number } => {
  const v = props.filterValues[ctl.key]
  return v && typeof v === 'object' ? v : {}
}

const onRangeInput = (ctl: DatabaseFilterControl, part: 'min' | 'max', event: Event) => {
  const raw = (event.target as HTMLInputElement).value.trim()
  const n = raw === '' ? undefined : Number(raw)
  // 输入到一半的 "1e" 之类暂不入态；能 parse 成有限数才更新
  if (n !== undefined && !Number.isFinite(n)) return
  emit('update:filter', ctl.key, { ...rangeValue(ctl), [part]: n })
}

// --- 整库下载 -------------------------------------------------------------

const downloading = ref(false)
const handleDownload = async () => {
  const download = props.source.download
  if (!download || downloading.value) return
  downloading.value = true
  try {
    await download.run()
  } catch (e) {
    // run 抛的是已本地化的一句话文案；原始错误只在 run 内部 console.error
    console.error('Database full download failed:', e)
    showToast(e instanceof Error && e.message ? e.message : t('databases.table.downloadFailed'), 'error')
  } finally {
    downloading.value = false
  }
}
</script>

<template>
  <div
    class="bg-base-100 rounded-2xl shadow-sm border border-base-200/60 flex flex-col overflow-hidden"
  >
    <!-- 工具栏：关键词搜索 + 额外筛选控件 + 整库下载 + 数据来源提示 -->
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
        v-if="keyword || filtersActive"
        @click="$emit('reset')"
        class="btn btn-outline border border-base-300 text-base-content/70 hover:bg-base-200 font-medium flex-1 sm:flex-none kawaru-text-87"
      >
        {{ $t('common.action.clear') }}
      </button>

      <!-- select 即选即搜；number-range 随「搜索」提交（见 script 注释）。
           shrink-0 + 固定宽度：筛选控件不参与弹性压缩，否则输入框会被挤窄、占位符显示不全 -->
      <template v-for="ctl in source.filterControls ?? []" :key="ctl.key">
        <select
          v-if="ctl.kind === 'select'"
          class="select select-bordered select-sm w-auto shrink-0 kawaru-text-100"
          :value="selectValue(ctl)"
          :aria-label="ctl.label()"
          @change="onSelect(ctl, $event)"
        >
          <option value="">{{ ctl.allLabel() }}</option>
          <option v-for="opt in ctl.options" :key="opt.value" :value="opt.value">
            {{ opt.label() }}
          </option>
        </select>
        <div v-else class="flex shrink-0 items-center gap-1.5">
          <span class="whitespace-nowrap text-base-content/60 kawaru-text-87">{{ ctl.label() }}</span>
          <input
            type="number"
            inputmode="decimal"
            min="0"
            step="any"
            class="input input-bordered input-sm w-32 kawaru-text-100"
            :placeholder="ctl.minPlaceholder()"
            :value="rangeValue(ctl).min ?? ''"
            :aria-label="ctl.minPlaceholder()"
            @input="onRangeInput(ctl, 'min', $event)"
            @keydown.enter.prevent="$emit('search')"
          />
          <span class="text-base-content/40 kawaru-text-87">–</span>
          <input
            type="number"
            inputmode="decimal"
            min="0"
            step="any"
            class="input input-bordered input-sm w-32 kawaru-text-100"
            :placeholder="ctl.maxPlaceholder()"
            :value="rangeValue(ctl).max ?? ''"
            :aria-label="ctl.maxPlaceholder()"
            @input="onRangeInput(ctl, 'max', $event)"
            @keydown.enter.prevent="$emit('search')"
          />
        </div>
      </template>

      <div class="flex-1"></div>

      <button
        v-if="source.download"
        class="btn btn-primary rounded-lg font-medium shadow-sm kawaru-text-87"
        :disabled="downloading"
        @click="handleDownload"
      >
        <span v-if="downloading" class="loading loading-spinner loading-sm"></span>
        <SvgIcon v-else type="download" class="h-4 w-4" />
        {{ source.download.label() }}
      </button>

      <span
        v-if="source.note"
        class="text-base-content/50 kawaru-text-100 whitespace-nowrap"
      >
        {{ source.note() }}
      </span>
    </div>

    <!-- 手机端允许横向滚动：min-w 让表格保持可读列宽，而不是被压成几条竖线 -->
    <div class="overflow-x-auto w-full">
      <table class="table table-fixed w-full min-w-[1100px]">
        <colgroup>
          <!-- 列宽由描述符指定；缺省各列均分 -->
          <col
            v-for="col in source.columns"
            :key="col.key"
            :style="{ width: col.width ?? `${100 / source.columns.length}%` }"
          />
        </colgroup>
        <thead>
          <tr class="bg-base-200 text-base-content/60 border-b border-base-200 kawaru-text-112">
            <th v-for="col in source.columns" :key="col.key" class="font-medium py-3 px-2 text-center">
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
            <tr
              v-for="row in rows"
              :key="rowKeyOf(row)"
              class="hover:bg-base-200/40 group transition-colors duration-150 border-b border-base-200/50 kawaru-text-112"
            >
              <td
                v-for="col in source.columns"
                :key="col.key"
                class="py-3 px-2 text-center"
                :class="{ 'font-mono': col.mono }"
              >
                <!-- PubChem 列：按名称检索，复用注释面板的对话框。图标按钮：
                     列宽有限，文字会和相邻的 HMDB 列挤在一起 -->
                <button
                  v-if="col.pubchemField"
                  type="button"
                  class="btn btn-ghost btn-sm btn-circle text-primary"
                  :title="$t('databases.hmdb.pubchemHint')"
                  :aria-label="col.label()"
                  @click="openPubChem(row, col)"
                >
                  <SvgIcon type="search" class="h-5 w-5" />
                </button>

                <!-- 外链列：条目页新窗口打开；算不出 URL 时显示占位 -->
                <template v-else-if="col.link">
                  <a
                    v-if="linkOf(row, col)"
                    :href="linkOf(row, col)!"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="btn btn-ghost btn-sm btn-circle text-primary"
                    :title="$t('databases.hmdb.openEntry')"
                    :aria-label="col.label()"
                  >
                    <SvgIcon type="share" class="h-5 w-5" />
                  </a>
                  <span v-else>—</span>
                </template>

                <!-- 可复制列：截断显示 + 复制按钮（名称 / InChI） -->
                <div v-else-if="col.copyable" class="flex min-w-0 items-center justify-center gap-1">
                  <span class="truncate text-base-content/80" :title="cellText(row, col)">
                    {{ cellText(row, col) }}
                  </span>
                  <button
                    v-if="copyableValue(row, col)"
                    type="button"
                    class="btn btn-ghost btn-xs btn-circle shrink-0 text-base-content/40 hover:text-base-content"
                    :title="$t('common.action.copy')"
                    :aria-label="$t('common.action.copy')"
                    @click="copyCell(row, col)"
                  >
                    <SvgIcon type="duplicate" class="h-4 w-4" />
                  </button>
                </div>

                <span v-else class="block truncate" :title="cellText(row, col)">
                  {{ cellText(row, col) }}
                </span>
              </td>
            </tr>
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
      :page-size-options="pageSizeOptions"
      :page-range="pageRange"
      @go-to-page="(p) => $emit('go-to-page', p)"
      @change-size="(s) => $emit('change-size', s)"
    />

    <!-- 与注释面板同一个 PubChem 对话框：打开时按行内名称检索 -->
    <PubChemDialog :open="pubchemOpen" :query="pubchemQuery" @close="pubchemOpen = false" />
  </div>
</template>

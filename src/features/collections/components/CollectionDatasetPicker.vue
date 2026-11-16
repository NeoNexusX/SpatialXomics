<template>
  <!-- Step 1 选择区卡片：搜索 + 紧凑行列表（checkbox 多选）+ 分页。
       行风格参照分析向导 DataSourceStep（max-h 滚动容器 + li 行），
       多选状态由父级持有，跨页/跨搜索的已选项经 isSelected 回显。 -->
  <section
    class="bg-base-100 dark:bg-slate-800 rounded-xl shadow-sm border border-base-300 p-4 sm:p-6"
  >
    <div class="flex items-center justify-between gap-3 mb-4">
      <h2 class="kawaru-text-125 font-bold text-base-content">{{ title ?? $t('collections.picker.step1') }}</h2>
      <span class="badge badge-primary badge-sm gap-1 font-medium whitespace-nowrap kawaru-text-75">
        <SvgIcon type="check" class="w-[0.9em] h-[0.9em]" />
        {{ $t('collections.picker.selected', { count: selectedCount }) }}
      </span>
    </div>

    <!-- 搜索：实时防抖（300ms），由 composable 侧 watch 处理。 -->
    <SearchInput
      :model-value="query"
:placeholder="$t('collections.picker.searchPlaceholder')"
      class="mb-3"
      @update:model-value="emit('update:query', $event)"
    />

    <!-- 行列表 -->
    <div class="max-h-72 overflow-auto border border-base-200 dark:border-slate-700 bg-base-100 dark:bg-slate-800 rounded-md p-2">
      <div v-if="loading" class="flex items-center justify-center p-6">
        <span class="loading loading-spinner loading-md"></span>
      </div>
      <template v-else>
        <div v-if="error" class="text-error p-3">{{ error }}</div>
        <ul v-else-if="datasets.length" class="flex flex-col gap-1">
          <li
            v-for="dataset in datasets"
            :key="dataset.publicId"
            :class="[
              'px-3 py-2 rounded-lg flex items-center gap-3 transition-colors',
              isExcluded(dataset.publicId)
                ? 'opacity-50 cursor-not-allowed'
                : isSelected(dataset.publicId)
                  ? 'bg-primary/10 dark:bg-primary/20 cursor-pointer'
                  : 'hover:bg-base-200 dark:hover:bg-slate-700 cursor-pointer',
            ]"
            @click="!isExcluded(dataset.publicId) && emit('toggle', dataset)"
          >
            <input
              type="checkbox"
              class="checkbox checkbox-sm checkbox-primary shrink-0"
              :checked="isSelected(dataset.publicId)"
              :disabled="isExcluded(dataset.publicId)"
              :aria-label="$t('collections.picker.selectAria', { name: dataset.name })"
              tabindex="-1"
              @click.stop
              @change="!isExcluded(dataset.publicId) && emit('toggle', dataset)"
            />
            <div class="w-10 h-10 shrink-0">
              <DatasetThumb :image-path="dataset.imagePath" :alt="$t('collections.picker.previewAlt', { name: dataset.name })" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="font-medium truncate text-base-content" :title="dataset.name">
                {{ dataset.name }}
              </div>
              <div class="kawaru-text-87 text-base-content/60 truncate">
                {{ [vocabLabel(dataset.organism), dataset.submitter].filter(Boolean).join(' · ') || '–' }}
              </div>
            </div>
            <!-- 已是集合成员：禁选并标注 -->
            <span
              v-if="isExcluded(dataset.publicId)"
              class="badge badge-sm border border-base-300 bg-base-200 text-base-content/60 whitespace-nowrap shrink-0 kawaru-text-75"
            >
              {{ $t('collections.picker.alreadyIn') }}
            </span>
            <div v-else class="kawaru-text-87 text-base-content/60 whitespace-nowrap tabular-nums shrink-0">
              {{ formatBytes(dataset.sizeBytes) }}
            </div>
          </li>
        </ul>
        <div v-else class="text-base-content/60 p-6 text-center">
          {{ $t('collections.picker.empty') }}
        </div>
      </template>
    </div>

    <!-- 分页：复用全站 PaginationFooter（含每页条数切换） -->
    <PaginationFooter
      v-if="datasets.length"
      class="mt-3"
      :current-page="meta.current_page"
      :total-pages="meta.total_pages"
      :total-items="meta.total_records"
      :size="size"
      :page-range="pagination"
      variant="compact"
      @go-to-page="(p) => emit('go-to-page', p)"
      @change-size="(s) => emit('change-size', s)"
    />
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PropType } from 'vue'
import DatasetThumb from '@/features/collections/components/DatasetThumb.vue'
import SearchInput from '@/shared/components/SearchInput.vue'
import PaginationFooter from '@/shared/components/PaginationFooter.vue'
import { formatBytes } from '@/shared/utils/format'
import { vocabLabel } from '@/features/datasets/constants/vocabLabels'
import type { File } from '@/features/datasets/types/dataset'
import type { PageMeta } from '@/shared/api/response'

const props = defineProps({
  datasets: { type: Array as PropType<File[]>, required: true },
  loading: { type: Boolean, required: true },
  error: { type: String, required: true },
  meta: { type: Object as PropType<PageMeta>, required: true },
  size: { type: Number, required: true },
  pagination: { type: Array as PropType<(number | string)[]>, required: true },
  query: { type: String, required: true },
  /** 逐行判定已选（跨页已选项在回到当前页时回显勾选态） */
  isSelected: { type: Function as PropType<(id: string) => boolean>, required: true },
  selectedCount: { type: Number, required: true },
  /** 卡片标题（Create 流程为 Step 1，overview 加成员弹窗为 Add Members） */
  title: { type: String, default: undefined },
  /** 已在集合中的成员 public_id（文件域统一 16 位字符串标识）。命中的行禁选并标注 "Already in collection"。 */
  excludePublicIds: { type: Array as PropType<string[]>, default: () => [] },
})

const excludeKeySet = computed(() => new Set(props.excludePublicIds))

function isExcluded(publicId: string): boolean {
  return excludeKeySet.value.has(publicId)
}

const emit = defineEmits<{
  (e: 'update:query', value: string): void
  (e: 'toggle', dataset: File): void
  (e: 'go-to-page', page: number): void
  (e: 'change-size', size: number): void
}>()
</script>

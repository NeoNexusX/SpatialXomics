<script setup lang="ts">
import type { PropType } from 'vue'
import DatasetCard from '@/features/datasets/components/DatasetCard.vue'
import PaginationFooter from '@/shared/components/PaginationFooter.vue'
import type { File } from '@/features/datasets/types/dataset'

defineProps({
  datasets: { type: Array as PropType<File[]>, required: true },
  loading: { type: Boolean, required: true },
  error: { type: String, required: true },
  meta: { type: Object as PropType<Record<string, any>>, required: true },
  size: { type: Number, required: true },
  pagination: { type: Array as PropType<(number | string)[]>, required: true },
  isMyDataset: { type: Boolean, required: false, default: false },
  deletingId: { type: String as PropType<string | null>, required: false, default: null },
  packingIds: { type: Object as PropType<Set<string>>, required: false, default: () => new Set() },
})

const emit = defineEmits<{
  (e: 'view-overview', publicId: string): void
  (e: 'download', publicId: string): void
  (e: 'delete', publicId: string): void
  (e: 'explore', publicId: string): void
  (e: 'edit', publicId: string): void
  (e: 'change-size', size: number): void
  (e: 'go-to-page', page: number): void
}>()

const onChangeSize = (v: number) => emit('change-size', v)
const onGoToPage = (p: number) => emit('go-to-page', p)
</script>

<template>
  <div>
    <!-- Loading state -->
    <div v-if="loading" class="flex flex-col gap-4">
      <div class="skeleton h-40 rounded-xl"></div>
      <div class="skeleton h-40 rounded-xl"></div>
    </div>

    <!-- Error state -->
    <div
      v-else-if="error"
      class="p-4 bg-error/10 rounded mb-4 border border-error/20 text-error kawaru-text-100"
    >
      {{ error }}
    </div>

    <!-- Empty state -->
    <div
      v-else-if="!datasets.length"
      class="p-6 bg-base-100 dark:bg-slate-800 rounded-xl text-base-content mb-4 kawaru-text-100"
    >
      <slot name="empty">{{ $t('datasets.list.empty') }}</slot>
    </div>

    <!-- Data list -->
    <div v-else class="flex flex-wrap gap-6 justify-start">
      <div
        v-for="dataset in datasets"
        :key="dataset.publicId"
        class="w-full md:w-[calc(50%-12px)] flex-shrink-0"
        :class="{ 'opacity-50 pointer-events-none': deletingId === dataset.publicId }"
      >
        <DatasetCard
          :dataset="dataset"
          :is-my-dataset="isMyDataset"
          :packing="packingIds.has(dataset.publicId)"
          @view-overview="$emit('view-overview', $event)"
          @download="$emit('download', $event)"
          @delete="$emit('delete', $event)"
          @explore="$emit('explore', $event)"
          @edit="$emit('edit', $event)"
        />
      </div>
    </div>

    <!-- Pagination -->
    <PaginationFooter
      v-if="datasets.length"
      :current-page="meta.current_page"
      :total-pages="meta.total_pages"
      :total-items="meta.total_records"
      :size="size"
      :page-range="pagination"
      @go-to-page="onGoToPage"
      @change-size="onChangeSize"
    />
  </div>
</template>

<style scoped>
/* Styles handled by Tailwind/daisyUI */
</style>

<script setup lang="ts">
import type { PropType } from 'vue'
import CollectionCard from '@/features/collections/components/CollectionCard.vue'
import PaginationFooter from '@/shared/components/PaginationFooter.vue'
import type { CollectionListMeta, CollectionSummary } from '@/features/collections/types/collection'

defineProps({
  collections: { type: Array as PropType<CollectionSummary[]>, required: true },
  loading: { type: Boolean, required: true },
  error: { type: String, required: true },
  meta: { type: Object as PropType<CollectionListMeta>, required: true },
  size: { type: Number, required: true },
  pagination: { type: Array as PropType<(number | string)[]>, required: true },
  /** 当前已应用的搜索词（区分「还没有集合」与「搜索无结果」两种空态） */
  searchApplied: { type: String, required: true },
  /** 逐卡片判定 Delete 显隐（所有者或管理员；列表含他人集合） */
  canEdit: {
    type: Function as PropType<(collection: CollectionSummary) => boolean>,
    required: true,
  },
  /** 逐卡片判定归属徽标（严格归属，不含管理员） */
  isMine: {
    type: Function as PropType<(collection: CollectionSummary) => boolean>,
    required: true,
  },
  /** 集合 public_id → 成员 imagePath（列表接口不带 members，由 useCollectionCovers 补） */
  memberImagePaths: {
    type: Object as PropType<Record<string, (string | null)[]>>,
    default: () => ({}),
  },
  /** 集合 public_id → 封面是否仍在拉取（补齐期间卡片封面显示骨架） */
  coverLoading: {
    type: Object as PropType<Record<string, boolean>>,
    default: () => ({}),
  },
})

defineEmits<{
  (e: 'view', publicId: string): void
  (e: 'delete', publicId: string): void
  (e: 'create'): void
  (e: 'clear-search'): void
  (e: 'change-size', size: number): void
  (e: 'go-to-page', page: number): void
}>()
</script>

<template>
  <div>
    <!-- Loading：与数据集列表同构的脉冲骨架（每行两个） -->
    <div v-if="loading" class="flex flex-col gap-6">
      <div v-for="i in 3" :key="i" class="skeleton w-full h-56 rounded-xl"></div>
    </div>

    <!-- Error state -->
    <div
      v-else-if="error"
      class="p-4 bg-error/10 dark:bg-error/10/30 rounded mb-4 border border-error/20 text-error"
    >
      {{ error }}
    </div>

    <!-- Empty state：还没有任何集合 -->
    <div
      v-else-if="!collections.length && !searchApplied"
      class="p-12 bg-base-100 dark:bg-slate-800 rounded-xl border border-base-300 text-center"
    >
      <SvgIcon type="circle_stack" class="h-12 w-12 mx-auto text-base-content/30 mb-4" />
      <h3 class="kawaru-text-112 font-bold text-base-content">{{ $t('collections.list.emptyTitle') }}</h3>
      <p class="mt-2 text-base-content/60">
        {{ $t('collections.list.emptyDesc') }}
      </p>
      <button class="btn btn-primary mt-6 kawaru-text-95" @click="$emit('create')">
        <SvgIcon type="plus" class="w-[1em] h-[1em]" />
        {{ $t('collections.list.create') }}
      </button>
    </div>

    <!-- Empty state：搜索无结果 -->
    <div
      v-else-if="!collections.length"
      class="p-12 bg-base-100 dark:bg-slate-800 rounded-xl border border-base-300 text-center"
    >
      <SvgIcon type="search" class="h-12 w-12 mx-auto text-base-content/30 mb-4" />
      <h3 class="kawaru-text-112 font-bold text-base-content">{{ $t('collections.list.noResultsTitle') }}</h3>
      <p class="mt-2 text-base-content/60">
        {{ $t('collections.list.noResultsDesc', { query: searchApplied }) }}
      </p>
      <button
        class="btn btn-outline border-base-300 hover:bg-base-300 mt-6 kawaru-text-95"
        @click="$emit('clear-search')"
      >
        {{ $t('collections.list.clearSearch') }}
      </button>
    </div>

    <!-- 集合列表：整行一张卡（单列）——卡片内容多（封面轮播 + 元数据 + Access），
         两列会把每栏挤窄，反而看不清 -->
    <div v-else class="flex flex-col gap-5">
      <CollectionCard
        v-for="collection in collections"
        :key="collection.publicId"
        :collection="collection"
        :can-edit="canEdit(collection)"
        :is-mine="isMine(collection)"
        :image-paths="memberImagePaths[collection.publicId]"
        :cover-loading="coverLoading[collection.publicId]"
        @view="$emit('view', $event)"
        @delete="$emit('delete', $event)"
      />
    </div>

    <!-- 分页：复用全站 PaginationFooter（Page x of y — z records + Per page + 页码条），
         每页条数走全局 config（与数据集列表一致） -->
    <PaginationFooter
      v-if="collections.length"
      :current-page="meta.current_page"
      :total-pages="meta.total_pages"
      :total-items="meta.total_records"
      :size="size"
      :page-range="pagination"
      @go-to-page="(p) => $emit('go-to-page', p)"
      @change-size="(s) => $emit('change-size', s)"
    />
  </div>
</template>

<style scoped>
/* Styles handled by Tailwind/daisyUI */
</style>

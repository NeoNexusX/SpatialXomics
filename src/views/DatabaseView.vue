<script setup lang="ts">
/**
 * 通用数据库浏览页（/database）：顶部 tab 切换已注册的数据源（sources/index.ts），
 * 首个数据源是 HMDB 代谢物库。页面本身对具体数据库一无所知——列、文案、取数
 * 全部来自 DatabaseSource 描述符，见 features/databases/types/database.ts。
 */
import DatabaseTable from '@/features/databases/components/DatabaseTable.vue'
import { useDatabaseList } from '@/features/databases/composables/useDatabaseList'

const {
  sources,
  activeId,
  activeSource,
  rows,
  loading,
  error,
  keyword,
  currentPage,
  pageSize,
  meta,
  pageRange,
  fetchPage,
  switchSource,
  handleSearch,
  resetKeyword,
  goToPage,
  changeSize,
} = useDatabaseList()
</script>

<template>
  <div class="min-h-screen bg-base-200 font-sans kawaru-text-100">
    <div class="container mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-6">
      <!-- 1. Top Banner -->
      <div class="flex flex-col sm:flex-row items-start justify-between gap-4">
        <div>
          <h1 class="kawaru-text-page-title leading-[1.15] font-semibold text-base-content">
            {{ $t('databases.title') }}
          </h1>
          <p class="kawaru-text-100 text-base-content/60 mt-1">{{ $t('databases.subtitle') }}</p>
        </div>
        <button
          class="btn btn-primary rounded-lg shadow-sm border-none kawaru-text-87"
          @click="fetchPage"
          :disabled="loading"
        >
          <span v-if="loading" class="loading loading-spinner loading-sm"></span>
          <SvgIcon v-else type="refresh" class="h-4 w-4" />
          {{ $t('common.action.refresh') }}
        </button>
      </div>

      <!-- 数据源 tab：顺序即 sources/index.ts 的注册顺序，新库注册即出现 -->
      <div role="tablist" class="tabs tabs-box w-fit">
        <button
          v-for="s in sources"
          :key="s.id"
          role="tab"
          class="tab kawaru-text-112"
          :class="{ 'tab-active': s.id === activeId }"
          @click="switchSource(s.id)"
        >
          {{ s.label() }}
        </button>
      </div>

      <!-- Error State -->
      <div
        v-if="error"
        class="alert alert-error alert-soft rounded-2xl shadow-sm border border-error/20"
      >
        <SvgIcon type="error" class="stroke-current shrink-0 h-6 w-6" />
        <div class="flex-1">
          <h3 class="font-bold">
            {{ $t('common.feedback.loadFailed', { target: activeSource.label() }) }}
          </h3>
          <div class="kawaru-text-87 opacity-80">{{ error }}</div>
        </div>
        <button class="btn btn-sm btn-ghost kawaru-text-75" @click="fetchPage">
          {{ $t('common.action.retry') }}
        </button>
      </div>

      <DatabaseTable
        :source="activeSource"
        :rows="rows"
        :loading="loading"
        v-model:keyword="keyword"
        :current-page="currentPage"
        :total-pages="meta.total_pages"
        :total-items="meta.total_records"
        :page-size="pageSize"
        :page-range="pageRange"
        @search="handleSearch"
        @reset="resetKeyword"
        @go-to-page="goToPage"
        @change-size="changeSize"
      />
    </div>
  </div>
</template>

<style scoped></style>

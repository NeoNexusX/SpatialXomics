<script setup lang="ts">
/**
 * 通用数据库浏览页（/database）：顶部 tab 切换已注册的数据源（sources/index.ts），
 * 首个数据源是 HMDB 代谢物库。页面本身对具体数据库一无所知——列、文案、取数
 * 全部来自 DatabaseSource 描述符，见 features/databases/types/database.ts。
 *
 * 浏览参考库要求登录：与其它受保护页一致，由路由守卫（meta.requiresAuth）
 * 未登录时跳 /login?redirect=/database。
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
  filterValues,
  filtersActive,
  setFilter,
  currentPage,
  pageSize,
  pageSizeOptions,
  meta,
  pageRange,
  fetchPage,
  switchSource,
  handleSearch,
  resetSearch,
  goToPage,
  changeSize,
} = useDatabaseList()
</script>

<template>
  <div class="min-h-screen bg-base-200 font-sans kawaru-text-100">
    <!-- 数据密集页：不套全站 container（1280 封顶），放宽到 1800 让 8 列有足够横向空间 -->
    <div class="mx-auto w-full max-w-[1800px] px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-6">
      <!-- 1. Top Banner：标题与数据源 tab 同一行 -->
      <div class="flex flex-wrap items-center gap-4">
        <h1 class="kawaru-text-page-title leading-[1.15] font-semibold text-base-content">
          {{ $t('databases.title') }}
        </h1>

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
        :filter-values="filterValues"
        :filters-active="filtersActive"
        :current-page="currentPage"
        :total-pages="meta.total_pages"
        :total-items="meta.total_records"
        :page-size="pageSize"
        :page-size-options="pageSizeOptions"
        :page-range="pageRange"
        @update:filter="setFilter"
        @search="handleSearch"
        @reset="resetSearch"
        @go-to-page="goToPage"
        @change-size="changeSize"
      />
    </div>
  </div>
</template>

<style scoped></style>

<template>
  <div
    class="container mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 pb-24 box-border overflow-x-hidden kawaru-text-100"
  >
    <!-- Header: Title + actions -->
    <div class="flex flex-col sm:flex-row items-start justify-between mb-6 gap-4">
      <div>
        <h1 class="kawaru-text-page-title leading-[1.15] font-semibold">
          {{ $t('workspace.dashboard.title') }}
        </h1>
        <p class="kawaru-text-100 text-base-content/60 mt-1">
          {{ $t('workspace.dashboard.subtitle') }}
        </p>
      </div>
      <div class="flex flex-col sm:flex-row items-center gap-3 flex-shrink-0 w-full sm:w-auto">
        <router-link
          to="/mydatasets"
          class="btn btn-ghost btn-md sm:btn-lg w-full sm:w-auto kawaru-text-87"
          >{{ $t('workspace.dashboard.goToMyDatasets') }}</router-link
        >
        <button
          type="button"
          class="btn btn-primary btn-md sm:btn-lg w-full sm:w-auto kawaru-text-87"
          :disabled="checking"
          @click="onNewTask"
        >
          <span v-if="checking" class="loading loading-spinner loading-sm"></span>
          {{ $t('workspace.dashboard.newTask') }}
        </button>
      </div>
    </div>

    <!-- Summary: moved to top, horizontal cards -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
      <SummaryCard
        :title="$t('common.status.running')"
        :count="summary.running"
        :subtitle="$t('workspace.dashboard.runningHint')"
        variant="info"
      />
      <SummaryCard
        :title="$t('common.status.completed')"
        :count="summary.completed"
        :subtitle="$t('workspace.dashboard.completedHint')"
        variant="success"
      />
      <SummaryCard
        :title="$t('common.status.failed')"
        :count="summary.failed"
        :subtitle="$t('workspace.dashboard.failedHint')"
        variant="error"
      />
    </div>

    <!-- Main content -->
    <section class="bg-base-100 rounded-lg border border-base-200 shadow-sm p-3 sm:p-4 lg:p-6">
      <div
        class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3 sm:mb-4"
      >
        <h2 class="kawaru-text-125 sm:kawaru-text-150 font-medium">
          {{ $t('workspace.dashboard.recentResults') }}
        </h2>
        <!-- 搜索：只按源文件名模糊匹配（服务端 RunFilter.filename），与数据集页一致。
             回车或点 Search 提交；清空输入框立即取消筛选。 -->
        <div class="flex items-center gap-2 w-full sm:w-auto">
          <SearchInput
            v-model="searchQuery"
            :placeholder="$t('common.input.searchDatasets')"
            class="flex-1 sm:w-72 sm:flex-none"
            @update:model-value="onQueryInput"
            @search="onSearch"
          />
          <button class="btn btn-primary shrink-0 kawaru-text-100" @click="onSearch">
            {{ $t('common.action.search') }}
          </button>
        </div>
      </div>
      <ResultTable
        :results="recentResults"
        :loading="loading"
        @delete="onDeleteClick"
        @view-error="showErrorModal"
      />
    </section>

    <!-- Pagination -->
    <PaginationFooter
      :current-page="meta.current_page"
      :total-pages="meta.total_pages"
      :total-items="meta.total_records"
      :size="size"
      :page-range="pagination"
      @go-to-page="goToPage"
      @change-size="changeSize"
    />

    <!-- Delete Confirmation Modal -->

    <ConfirmDialog
      :open="deleteConfirm.isOpen"
      :title="$t('workspace.dashboard.deleteTitle')"
      :message="$t('workspace.dashboard.deleteMessage')"
      :confirm-label="$t('common.action.delete')"
      :danger="true"
      :loading="deleteConfirm.deleting"
      @confirm="deleteConfirm.confirm"
      @cancel="deleteConfirm.cancel"
    />

    <!-- Error Modal for failed processes -->
    <ConfirmDialog
      :open="isErrorModalOpen"
      :title="$t('workspace.dashboard.failedTitle')"
      hide-confirm
      @cancel="isErrorModalOpen = false"
    >
      <div>
        <p class="font-medium">{{ $t('workspace.dashboard.errorDetails') }}</p>
        <p class="mt-2 kawaru-text-87 text-base-content/70 whitespace-pre-wrap break-all">
          {{ errorModalMessage }}
        </p>
      </div>
    </ConfirmDialog>

    <!-- Analysis quota limit -->
    <ConfirmDialog
      :open="isLimitDialogOpen"
      :title="$t('workspace.dashboard.analysisLimitTitle')"
      :message="$t('workspace.dashboard.analysisLimitMessage', { limit })"
      :confirm-label="$t('common.action.close')"
      hide-cancel
      @confirm="isLimitDialogOpen = false"
      @cancel="isLimitDialogOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ResultTable from '@/features/workspace/dashboard/components/ResultTable.vue'
import SummaryCard from '@/features/workspace/dashboard/components/SummaryCard.vue'
import ConfirmDialog from '@/shared/components/ConfirmDialog.vue'
import PaginationFooter from '@/shared/components/PaginationFooter.vue'
import SearchInput from '@/shared/components/SearchInput.vue'
import { useWorkspaceDashboard } from '@/features/workspace/dashboard/composables/useWorkspaceDashboard'
import { useAnalysisQuota } from '@/features/workspace/dashboard/composables/useAnalysisQuota'
import { useConfirmDelete } from '@/shared/composables/useConfirmDelete'

const router = useRouter()
const route = useRoute()

const {
  recentResults,
  summary,
  loading,
  size,
  meta,
  pagination,
  goToPage,
  changeSize,
  deleteResult,
  applySearch,
} = useWorkspaceDashboard()

// ---- 结果列表搜索（服务端按源文件名模糊匹配） ----
// 输入框内容先落在 searchQuery，回车或点 Search 才提交给 composable，
// 因此只在提交后触发请求；清空输入框（✕）立即取消筛选。
const searchQuery = ref('')

function onSearch() {
  applySearch(searchQuery.value)
}

function onQueryInput(v: string) {
  searchQuery.value = v
  if (!v) applySearch('')
}

// Delete — shared composable
const deleteConfirm = useConfirmDelete({
  onDelete: async (id) => {
    await deleteResult(id)
  },
})

// Error modal for failed processes
const isErrorModalOpen = ref(false)
const errorModalMessage = ref('')

function showErrorModal(message: string) {
  errorModalMessage.value = message
  isErrorModalOpen.value = true
}

function onDeleteClick(id: string) {
  deleteConfirm.open(id)
}

// ---- 新建分析前的配额检查 ----
// 检查已经前移到 /workspace/new 的路由守卫，工作台按钮和导航栏入口共用。
// 守卫拦截时会带 analysisLimit=1 回到工作台，这里只负责打开同一个提示框。
const { checking, limit } = useAnalysisQuota()
const isLimitDialogOpen = ref(false)

function onNewTask() {
  void router.push({ name: 'NewAnalysis' })
}

watch(
  () => route.query.analysisLimit,
  (flagged) => {
    if (!flagged) return
    isLimitDialogOpen.value = true
    const query = { ...route.query }
    delete query.analysisLimit
    // 清掉标记，刷新或返回时不再重复弹窗。
    void router.replace({ query })
  },
  { immediate: true },
)
</script>

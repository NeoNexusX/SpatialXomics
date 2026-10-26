<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import DatasetList from '@/features/datasets/components/DatasetList.vue'
import DatasetFilterBar from '@/features/datasets/components/DatasetFilterBar.vue'
import ExploreConfirmDialog from '@/features/datasets/components/ExploreConfirmDialog.vue'
import { listFiles, type FileListSort } from '@/features/datasets/api/datasetApi'
import { useDownloadProgress } from '@/features/datasets/composables/useDownloadProgress'
import { useDatasetListPage } from '@/features/datasets/composables/useDatasetListPage'
import { useExploreDataset } from '@/features/datasets/composables/useExploreDataset'
import { useRequireAuth } from '@/shared/composables/useRequireAuth'
import { createDefaultDatasetFilters } from '@/features/datasets/constants/datasetMetadata'

// 上传流程（表单/解析/OSS 分片上传）约 60KB，只读列表页多数访客用不到。
// 懒加载 + 下面的 uploadModalMounted 守卫，把它推迟到用户真的点「上传」时才下载。
const UploadModal = defineAsyncComponent(
  () => import('@/features/upload/components/UploadModal.vue'),
)

// Use composable for datasets (fetch/map/pagination/sort)
const initialFilters = createDefaultDatasetFilters()

const fetcher = async (f: Record<string, any>, p: number, s: number, sort?: FileListSort) => {
  return await listFiles(f, p, s, true, sort) // 列表加载不需要登录
}

const {
  datasets,
  loading,
  error,
  meta,
  size,
  pagination,
  handleSort,
  handleSearch,
  handleApplyFilters,
  goToPage,
  changeSize,
  refreshCurrentPage,
  viewOverview,
} = useDatasetListPage(fetcher, {
  source: 'public',
  defaultFilters: initialFilters,
})

// shared download progress composable
const { handleDownloadRaw, packingIds } = useDownloadProgress()

// Explore composable
const explore = useExploreDataset()
const { showExploreConfirm, isConverting } = explore

/** 需要登录的操作：未登录则跳转登录页 */
const { requireAuth } = useRequireAuth('/datasets')

// Upload modal state
const isUploadOpen = ref(false)
// 只翻一次的挂载标志：UploadModal 内部 onBeforeUnmount 会中止进行中的上传，
// 且 useUploadFlow 持有断点续传/表单状态，所以关闭时不能卸载。
// 首次打开挂上之后就常驻，此后开关行为与改动前完全一致（含 modal 动画）。
const uploadModalMounted = ref(false)

// Card actions
const handleDownload = (id?: string) => {
  if (!id) return
  if (!requireAuth()) return
  handleDownloadRaw(id)
}

const handleExplore = (id?: string) => {
  if (!id) return
  if (!requireAuth()) return
  explore.handleExplore(id, datasets.value)
}

const handleUpload = () => {
  if (!requireAuth()) return
  uploadModalMounted.value = true
  isUploadOpen.value = true
}

const handleUploadSuccess = (_datasetName: string) => {
  isUploadOpen.value = false
  refreshCurrentPage()
}
</script>

<template>
  <div class="min-h-screen bg-base-200">
    <div class="max-w-[1680px] mx-auto p-4 md:p-8 kawaru-text-100">
      <h1 class="kawaru-text-page-title leading-[1.15] font-bold text-base-content mb-6">{{ $t('common.page.publicDatasets') }}</h1>

      <DatasetFilterBar
        :show-add-filter="true"
        :show-upload="true"
        :show-collections-link="true"
        :search-placeholder="$t('common.input.searchDatasets')"
        @upload="handleUpload"
        @search="handleSearch"
        @apply-filters="handleApplyFilters"
        @sort="handleSort"
      />

      <UploadModal
        v-if="uploadModalMounted"
        :is-open="isUploadOpen"
        @close="isUploadOpen = false"
        @upload-success="handleUploadSuccess"
      />

      <DatasetList
        :datasets="datasets"
        :loading="loading"
        :error="error"
        :meta="meta"
        :size="size"
        :pagination="pagination"
        :packingIds="packingIds"
        @view-overview="viewOverview"
        @download="handleDownload"
        @explore="handleExplore"
        @change-size="changeSize"
        @go-to-page="goToPage"
      >
        <template #empty>{{ $t('datasets.list.publicEmpty') }}</template>
      </DatasetList>

      <!-- Explore / Raw-Convert Confirmation -->
      <ExploreConfirmDialog
        :open="showExploreConfirm"
        :loading="isConverting"
        @confirm="explore.confirmExplore"
        @cancel="explore.cancelExplore"
      />
    </div>
  </div>
</template>

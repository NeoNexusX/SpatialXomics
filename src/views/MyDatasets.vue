<template>
  <div class="min-h-screen bg-base-200">
    <div class="max-w-[1680px] mx-auto p-4 md:p-8 kawaru-text-100">
      <h1 class="kawaru-text-page-title leading-[1.15] font-bold text-base-content mb-6 px-3">{{ $t('common.page.myDatasets') }}</h1>

      <div
        v-if="quota"
        class="flex flex-col md:flex-row md:flex-wrap items-start md:items-center gap-3 md:gap-6 mb-4 kawaru-text-100 text-base-content/80"
      >
        <span class="px-3 whitespace-nowrap"
          >{{ $t('datasets.my.storage') }}
          <strong class="text-base-content"
            >{{ quota.uploadUsed }} / {{ quota.uploadMax }}</strong
          ></span
        >
        <span class="px-3 whitespace-nowrap"
          >{{ $t('common.stat.files') }}
          <strong class="text-base-content"
            >{{ quota.fileCount }} / {{ quota.maxFiles }}</strong
          ></span
        >
        <span class="px-3 whitespace-nowrap"
          >{{ $t('common.stat.processing') }}
          <strong class="text-base-content"
            >{{ quota.procUsed }} / {{ quota.procMax }}</strong
          ></span
        >
        <span class="px-3 whitespace-nowrap"
          >{{ $t('common.stat.downloads') }}
          <strong class="text-base-content"
            >{{ quota.downloadUsed }} / {{ quota.downloadMax }}</strong
          ></span
        >
        <button
          class="btn btn-ghost kawaru-text-100 md:ml-auto"
          :class="{ loading: checkingFiles }"
          :disabled="checkingFiles"
          @click="refreshFileStatus"
:title="$t('datasets.my.refreshStatusHint')"
        >
          <SvgIcon v-if="!checkingFiles" type="refresh" class="w-[1.2em] h-[1.2em]" />
          {{ $t('datasets.my.refreshStatus') }}
        </button>
      </div>

      <DatasetFilterBar
        :show-add-filter="true"
        :show-upload="true"
        :show-collections-link="true"
        :search-placeholder="$t('datasets.my.searchPlaceholder')"
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

      <!-- Delete Confirmation Modal -->
      <ConfirmDialog
        :open="deleteConfirm.isOpen"
:title="$t('datasets.my.deleteTitle')"
        :message="$t('datasets.my.deleteMessage')"
        :confirm-label="$t('common.action.delete')"
        :danger="true"
        :loading="deleteConfirm.deleting"
        @confirm="deleteConfirm.confirm"
        @cancel="deleteConfirm.cancel"
      />

      <!-- Explore / Raw-Convert Confirmation -->
      <ExploreConfirmDialog
        :open="showExploreConfirm"
        :loading="isConverting"
        @confirm="explore.confirmExplore"
        @cancel="explore.cancelExplore"
      />

      <!-- 元信息编辑弹窗：由卡片右侧的 Edit 触发（Overview 页已移除该入口，避免两处入口） -->
      <FileMetadataDialog
        :open="!!editingDataset"
        :dataset="editingDataset"
        @close="editingDataset = null"
        @saved="handleMetadataSaved"
      />

      <DatasetList
        :datasets="datasets"
        :loading="loading"
        :error="error"
        :meta="meta"
        :size="size"
        :pagination="pagination"
        :is-my-dataset="true"
        :deletingId="deleteConfirm.deletingId"
        :packingIds="packingIds"
        @view-overview="viewOverview"
        @download="handleDownloadRaw"
        @delete="handleDelete"
        @explore="handleExplore"
        @edit="handleEdit"
        @change-size="changeSize"
        @go-to-page="goToPage"
      >
        <template #empty>{{ $t('datasets.list.myEmpty') }}</template>
      </DatasetList>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import DatasetList from '@/features/datasets/components/DatasetList.vue'
import DatasetFilterBar from '@/features/datasets/components/DatasetFilterBar.vue'
import ConfirmDialog from '@/shared/components/ConfirmDialog.vue'
import ExploreConfirmDialog from '@/features/datasets/components/ExploreConfirmDialog.vue'
import FileMetadataDialog from '@/features/datasets/components/FileMetadataDialog.vue'
import type { File } from '@/features/datasets/types/dataset'
import { listUserFiles, deleteFile, type FileListSort } from '@/features/datasets/api/datasetApi'
import { useConfirmDelete } from '@/shared/composables/useConfirmDelete'
import { useDownloadProgress } from '@/features/datasets/composables/useDownloadProgress'
import { useDatasetListPage } from '@/features/datasets/composables/useDatasetListPage'
import { useExploreDataset } from '@/features/datasets/composables/useExploreDataset'
import { useAuthStore } from '@/shared/auth/authStore'
import { useUserQuota } from '@/shared/composables/useUserQuota'
import { createDefaultDatasetFilters } from '@/features/datasets/constants/datasetMetadata'

// 上传流程（表单/解析/OSS 分片上传）约 60KB，列表页首屏用不到。
// 懒加载 + 下面的 uploadModalMounted 守卫，推迟到用户真的要上传时才下载。
const UploadModal = defineAsyncComponent(
  () => import('@/features/upload/components/UploadModal.vue'),
)

// Use composable for datasets (fetch/map/pagination/sort)
const initialFilters = createDefaultDatasetFilters()

const auth = useAuthStore()

const fetcher = async (f: Record<string, any>, p: number, s: number, sort?: FileListSort) => {
  // ensure username is set for MyDatasets
  const username = auth.user?.username || ''
  const body = { ...f, username }
  return await listUserFiles(body, p, s, sort)
}

// Quota
const { quota, fetchQuota } = useUserQuota()

// 列表装配（取数/筛选/分页/Overview 跳转）；`handleSort` 由模板直接使用
const {
  datasets,
  loading,
  error,
  meta,
  page,
  size,
  pagination,
  fetchFiles,
  handleSort,
  handleSearch,
  handleApplyFilters,
  goToPage,
  changeSize,
  refreshCurrentPage,
  viewOverview,
} = useDatasetListPage(fetcher, {
  source: 'my',
  defaultFilters: initialFilters,
  onMountedReady: fetchQuota,
})

const router = useRouter()
const route = useRoute()

// UI handlers used by the filter bar and cards
const isUploadOpen = ref(false)
// 只翻一次的挂载标志：UploadModal 内部 onBeforeUnmount 会中止进行中的上传，
// 且 useUploadFlow 持有断点续传/表单状态，所以关闭时不能卸载。
// 首次打开挂上之后就常驻，此后开关行为与改动前完全一致（含 modal 动画）。
const uploadModalMounted = ref(false)
const openUploadModal = () => {
  uploadModalMounted.value = true
  isUploadOpen.value = true
}
const handleUpload = openUploadModal

// Auto-open the upload modal when arriving from the New Analysis page (?upload=1)
onMounted(() => {
  if (route.query.upload === '1') {
    openUploadModal()
    // Strip the query param so a refresh doesn't reopen the modal
    router.replace({ name: 'MyDatasets' })
  }
})

// Download progress handler (shared via composable)
const { handleDownloadRaw, packingIds } = useDownloadProgress()

// Upload success: refresh list to get backend status
const handleUploadSuccess = (_datasetName: string) => {
  isUploadOpen.value = false
  refreshCurrentPage()
  fetchQuota()
}

// Refresh file status: re-fetch current page from backend
const checkingFiles = ref(false)

async function refreshFileStatus() {
  if (checkingFiles.value) return
  checkingFiles.value = true
  await fetchFiles({ page: page.value, size: size.value })
  fetchQuota()
  checkingFiles.value = false
}

const deleteConfirm = useConfirmDelete({
  onDelete: async (id) => {
    await deleteFile(id)
    fetchFiles({ page: page.value, size: size.value })
    fetchQuota()
  },
})

const explore = useExploreDataset()
const { showExploreConfirm, isConverting } = explore

// ---- 元信息编辑：卡片 Edit → 弹窗，保存后按 id 就地替换该行（不整页重拉）----
const editingDataset = ref<File | null>(null)

function handleEdit(id: string) {
  editingDataset.value = datasets.value.find((d) => d.publicId === id) ?? null
}

function handleMetadataSaved(file: File) {
  const index = datasets.value.findIndex((d) => d.publicId === file.publicId)
  if (index !== -1) datasets.value[index] = file
}

const handleExplore = (id?: string) => {
  if (!id) return
  explore.handleExplore(id, datasets.value)
}

const handleDelete = (id?: string) => {
  if (!id) return
  deleteConfirm.open(id)
}
</script>

<style scoped>
/* Layout handled by Tailwind classes */
</style>

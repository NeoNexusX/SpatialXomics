<template>
  <div class="min-h-screen bg-base-200">
    <div class="max-w-[1680px] mx-auto p-4 md:p-8 kawaru-text-100">
      <!-- Loading：与列表页同构的骨架 -->
      <div v-if="loading" class="flex flex-col gap-6">
        <div class="skeleton h-16 rounded-xl"></div>
        <div class="skeleton h-40 rounded-xl"></div>
        <div class="skeleton h-64 rounded-xl"></div>
      </div>

      <!-- public_id 缺失/非法（路径无参进入）时，引导返回列表。 -->
      <div
        v-else-if="isStale"
        class="p-12 bg-base-100 dark:bg-slate-800 rounded-xl border border-base-300 text-center"
      >
        <SvgIcon type="circle_stack" class="h-12 w-12 mx-auto text-base-content/30 mb-4" />
        <h3 class="kawaru-text-112 font-bold text-base-content">{{ $t('common.state.sessionLost') }}</h3>
        <p class="mt-2 text-base-content/60">
          {{ $t('collections.overview.sessionLostDesc') }}
        </p>
        <router-link to="/collections" class="btn btn-primary mt-6 kawaru-text-100">
          {{ $t('collections.overview.backToCollections') }}
        </router-link>
      </div>

      <!-- 错误态：集合不存在（404）与其他加载失败 -->
      <div
        v-else-if="error"
        class="p-12 bg-base-100 dark:bg-slate-800 rounded-xl border border-base-300 text-center"
      >
        <SvgIcon type="circle_stack" class="h-12 w-12 mx-auto text-base-content/30 mb-4" />
        <h3 class="kawaru-text-112 font-bold text-base-content">
          {{
            notFound
              ? $t('collections.overview.notFound')
              : $t('common.feedback.loadFailed', { target: $t('collections.overview.target') })
          }}
        </h3>
        <p class="mt-2 text-base-content/60">{{ error }}</p>
        <div class="mt-6 flex justify-center gap-2">
          <button v-if="!notFound" class="btn btn-outline kawaru-text-100" @click="fetch">{{ $t('common.action.retry') }}</button>
          <router-link to="/collections" class="btn btn-primary kawaru-text-100">
            {{ $t('collections.overview.backToCollections') }}
          </router-link>
        </div>
      </div>

      <template v-else-if="detail">
        <!-- 页头：返回 + 名称/标题 + 操作（Edit/Delete 仅 owner/admin；Share 需 publicId） -->
        <div class="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
          <div class="min-w-0">
            <router-link
              to="/collections"
              class="inline-flex items-center gap-1 kawaru-text-87 text-base-content/60 hover:text-primary transition-colors"
            >
              <SvgIcon type="back" class="w-[0.9em] h-[0.9em]" />
              {{ $t('common.page.collections') }}
            </router-link>
            <h1 class="kawaru-text-page-title leading-[1.15] font-bold text-base-content mt-1 truncate" :title="headerName">
              {{ headerName }}
            </h1>
            <p v-if="headerTitle" class="text-base-content/70 mt-0.5 truncate">
              {{ headerTitle }}
            </p>
          </div>
          <div v-if="canEdit" class="flex items-center gap-2 shrink-0">
            <!-- 编辑态：原地修改，头部换成保存/取消（Delete/Share 期间隐藏，避免误触） -->
            <template v-if="editing">
              <button
                class="btn btn-outline border-base-300 kawaru-text-95"
                :disabled="saving"
                @click="cancel"
              >
                {{ $t('common.action.cancel') }}
              </button>
              <button
                class="btn btn-primary kawaru-text-95"
                :disabled="saving || !isDirty || !draft?.name?.trim()"
                @click="save"
              >
                <span v-if="saving" class="loading loading-spinner loading-sm"></span>
                {{ $t('common.action.saveChanges') }}
              </button>
            </template>
            <template v-else>
              <button
                v-if="detail.publicId"
                class="btn btn-outline border-base-300 kawaru-text-95"
                @click="copyShareLink"
              >
                <SvgIcon type="share" class="w-[1em] h-[1em]" />
                {{ $t('common.action.share') }}
              </button>
              <button class="btn btn-outline border-base-300 kawaru-text-95" @click="start">
                <SvgIcon type="pencil" class="w-[1em] h-[1em]" />
                {{ $t('common.action.edit') }}
              </button>
              <button
                class="btn btn-outline border-base-300 text-error kawaru-text-95"
                @click="deleteConfirm.open(detail.publicId)"
              >
                <SvgIcon type="trash" class="w-[1em] h-[1em]" />
                {{ $t('common.action.delete') }}
              </button>
            </template>
          </div>
        </div>

        <!-- 表单校验失败（Name 必填/超长等）：留在原地编辑，不弹窗 -->
        <p v-if="editing && validationError" class="text-error kawaru-text-87 -mt-3 mb-4">
          {{ validationError }}
        </p>

        <!-- 统计条 -->
        <div
          class="flex flex-wrap items-center gap-x-6 gap-y-2 bg-base-100 dark:bg-slate-800
            rounded-xl shadow-sm border border-base-300 px-4 py-3 mb-6
            kawaru-text-87 text-base-content/70"
        >
          <span class="inline-flex items-center gap-1.5">
            <SvgIcon type="queue_list" class="w-[1.1em] h-[1.1em]" />
            <span class="font-semibold text-base-content">{{ detail.memberCount }}</span>
            {{ $t('collections.unit.dataset', detail.memberCount) }}
          </span>
          <span class="inline-flex items-center gap-1.5">
            <SvgIcon type="folder" class="w-[1.1em] h-[1.1em]" />
            {{ formatBytes(detail.totalSize) }}
          </span>
          <span class="inline-flex items-center gap-1.5" :title="$t('collections.card.owner', { name: detail.ownerUsername })">
            <SvgIcon type="user" class="w-[1.1em] h-[1.1em]" />
            {{ detail.ownerUsername }}
          </span>
          <span v-if="updatedDate" class="ml-auto whitespace-nowrap">
            {{ $t('collections.card.updated', { date: updatedDate }) }}
          </span>
        </div>

        <!-- 成员列表（管理态 = canEdit；调序控件再叠加编辑态 editing）：置顶，先看成员再看学术元数据 -->
        <CollectionMemberList
          :members="members"
          :manage-mode="canEdit"
          :edit-mode="editing"
          :adding="adding"
          :removing="removing"
          :reordering="reordering"
          @add="openAddMembers"
          @remove="memberOps.remove"
          @reorder="memberOps.reorder"
          @download="downloadMember"
        />

        <!-- 学术元数据：编辑态整卡换成表单（同一张字段表），卡片外壳不变 -->
        <CollectionMetadataPanel
          class="mt-6"
          :metadata="detail.metadata"
          :draft="editing ? draft : null"
        />
      </template>
    </div>

    <!-- 添加成员弹窗：选择器复用 Picker（排除已在集合中的成员）。
         弹窗在 kawaru-text-100 容器之外，需自行挂 kawaru-text-100 继承流体字号基准 -->
    <dialog class="modal" :class="{ 'modal-open': addOpen }">
      <div class="modal-box max-w-2xl kawaru-text-100">
        <CollectionDatasetPicker
          :datasets="pickerDatasets"
          :loading="pickerLoading"
          :error="pickerError"
          :meta="pickerMeta"
          :size="pickerSize"
          :pagination="pickerPagination"
          :query="pickerQuery"
          :is-selected="pickerSelection.isSelected"
          :selected-count="pickerSelection.selected.value.length"
:title="$t('collections.overview.addMembers')"
          :exclude-public-ids="memberPublicIds"
          @update:query="pickerQuery = $event"
          @toggle="pickerSelection.toggle"
          @go-to-page="pickerGoToPage"
          @change-size="pickerChangeSize"
        />
        <div class="modal-action">
          <button class="btn kawaru-text-100" :disabled="adding" @click="closeAddMembers">{{ $t('common.action.cancel') }}</button>
          <button
            class="btn btn-primary kawaru-text-100"
            :disabled="!pickerSelection.selected.value.length || adding"
            @click="confirmAddMembers"
          >
            <span v-if="adding" class="loading loading-spinner loading-sm"></span>
            {{ $t('collections.overview.addButton', pickerSelection.selected.value.length) }}
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop" @click="closeAddMembers">
        <button @click.prevent="closeAddMembers">{{ $t('common.action.close') }}</button>
      </form>
    </dialog>

    <!-- 删除集合确认 -->
    <ConfirmDialog
      :open="deleteConfirm.isOpen"
:title="$t('collections.view.deleteTitle')"
      :message="$t('collections.view.deleteMessage')"
      :confirm-label="$t('common.action.delete')"
      danger
      @confirm="deleteConfirm.confirm"
      @cancel="deleteConfirm.cancel"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import CollectionDatasetPicker from '@/features/collections/components/CollectionDatasetPicker.vue'
import CollectionMemberList from '@/features/collections/components/CollectionMemberList.vue'
import CollectionMetadataPanel from '@/features/collections/components/CollectionMetadataPanel.vue'
import ConfirmDialog from '@/shared/components/ConfirmDialog.vue'
import { useConfirmDelete } from '@/shared/composables/useConfirmDelete'
import { useToast } from '@/shared/composables/useToast'
import { useCopyToClipboard } from '@/shared/composables/useCopyToClipboard'
import { formatBytes, formatDate } from '@/shared/utils/format'
import { listFiles } from '@/features/datasets/api/datasetApi'
import { useDatasetList } from '@/features/datasets/composables/useDatasetList'
import type { File } from '@/features/datasets/types/dataset'
import { useDownloadProgress } from '@/features/datasets/composables/useDownloadProgress'
import { deleteCollection } from '@/features/collections/api/collectionApi'
import { useCollectionDetail } from '@/features/collections/composables/useCollectionDetail'
import { useCollectionEdit } from '@/features/collections/composables/useCollectionEdit'
import { useCollectionMembers } from '@/features/collections/composables/useCollectionMembers'
import { useOrderedSelection } from '@/features/collections/composables/useOrderedSelection'
import { t } from '@/i18n'

const router = useRouter()
const { showToast } = useToast()
const { copy } = useCopyToClipboard()

// ---- 详情 + 成员管理（单一数据源：detail，写操作成功后整体回写）----
const {
  detail,
  loading,
  error,
  notFound,
  isStale,
  canEdit,
  fetch,
  applyDetail,
} = useCollectionDetail()

const memberOps = useCollectionMembers({ detail, refresh: fetch })
const { members, adding, removing, reordering, add } = memberOps

const memberPublicIds = computed(() => members.value.map((m) => m.publicId))

const updatedDate = computed(() => formatDate(detail.value?.updatedAt))

// ---- 下载（复用数据集下载链：限流 + 逐文件 iframe 触发）----
const { handleDownloadRaw } = useDownloadProgress()

function downloadMember(member: { publicId: string; filename: string }) {
  handleDownloadRaw(member.publicId)
}

// ---- 编辑元信息：页内原地编辑（Edit → 字段变输入框 → Save/Cancel）----
const { editing, draft, saving, validationError, isDirty, start, cancel, save } =
  useCollectionEdit({ detail, onSaved: applyDetail })

/** 编辑态下头部跟着草稿实时变，用户能直接看到改后的样子（空 name 回落到原值） */
const headerName = computed(() =>
  editing.value ? draft.value?.name || detail.value?.name || '' : (detail.value?.name ?? ''),
)
const headerTitle = computed(() =>
  editing.value ? (draft.value?.title ?? '') : (detail.value?.title ?? ''),
)

// ---- 删除集合：确认后调 API 并回列表 ----
const deleteConfirm = useConfirmDelete({
  onDelete: async (publicId) => {
    await deleteCollection(publicId)
    router.push('/collections')
  },
})

// ---- 分享链接（集合对外只有 public_id，v-if 仅作防御）----
async function copyShareLink() {
  if (!detail.value?.publicId) return
  const url = `${location.origin}/collections/${detail.value.publicId}`
  await copy(url, { onError: () => showToast(t('collections.overview.shareLink', { url }), 'info') })
}

// ---- 添加成员弹窗：picker 直连公开 imzML/completed 列表（与创建页同一套过滤）----
const addOpen = ref(false)

const {
  datasets: rawPickerDatasets,
  loading: pickerLoading,
  error: pickerError,
  meta: pickerMeta,
  size: pickerSize,
  pagination: pickerPagination,
  fetchFiles: pickerFetch,
  applyFilters: pickerApplyFilters,
  goToPage: pickerGoToPage,
  changeSize: pickerChangeSize,
} = useDatasetList((filters, page, size) => listFiles(filters, page, size, true), {
  defaultFilters: { filename: '', experiment_type: 'imzML' },
})
// 后端筛选参数不含 status，completed 前端兜底过滤（与创建页一致）
const pickerDatasets = computed(() =>
  rawPickerDatasets.value.filter((d) => d.status === 'completed'),
)
const pickerSelection = useOrderedSelection<File>()
const pickerQuery = ref('')

// 300ms 防抖搜索（与创建页一致）
let debounceTimer: ReturnType<typeof setTimeout> | null = null
watch(pickerQuery, (query) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    pickerApplyFilters({ filename: query.trim() })
    pickerFetch({ page: 1, size: pickerSize.value }).catch(() => {})
  }, 300)
})

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
})

function openAddMembers() {
  addOpen.value = true
  pickerSelection.clear()
  pickerFetch().catch(() => {})
}

function closeAddMembers() {
  if (adding.value) return
  addOpen.value = false
}

async function confirmAddMembers() {
  const publicIds = pickerSelection.selected.value.map((f) => f.publicId)
  if (!publicIds.length) return
  // 失败（409 等）时保持弹窗打开：选择仍留在 pickerSelection 里，可直接重试
  if (await add(publicIds)) addOpen.value = false
}
</script>

<style scoped>
/* Layout handled by Tailwind classes */
</style>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ROIPanel from '@/features/vizworkbench/components/visuals/ROIPanel.vue'
import MaskExportPanel from '@/features/vizworkbench/components/visuals/MaskExportPanel.vue'
import IonChannelPanel from '@/features/vizworkbench/components/visuals/IonChannelPanel.vue'
import CollapsibleSection from '@/shared/components/CollapsibleSection.vue'
import type {
  ImportedMaskSummary,
  MaskExportPayload,
} from '@/features/vizworkbench/utils/maskExport'
import type { IonChannel } from '@/features/vizworkbench/composables/useIonChannels'
import SvgIcon from '@/shared/components/SvgIcon.vue'
import ConfirmDialog from '@/shared/components/ConfirmDialog.vue'
import type { OverlayKind, KmeansCluster } from '@/features/vizworkbench/composables/useOverlayData'
import type { ConfirmedROI } from '@/features/vizworkbench/composables/useROI'

const props = defineProps<{
  umapVisible: boolean
  kmeansVisible: boolean
  overlayLoading: boolean
  /** True while the initial create-task POST is in flight. */
  clusteringCreating: boolean
  /** True when the clustering task exists but hasn't completed - shows a computing row with a Refresh button. */
  clusteringComputing: boolean
  /** True once the clustering zarr is loaded - UMAP/KMeans buttons become interactive. */
  clusteringReady: boolean
  /** True while a refresh POST is in flight. */
  clusteringRefreshing: boolean
  /** Clustering load error (e.g. zarr not ready yet); shows a retry affordance. */
  overlayError?: string | null
  umapAlpha: number
  kmeansAlpha: number
  /** KMeans clusters for the picker (id + color + pixel count). */
  kmeansClusters: KmeansCluster[]
  /** False until a local KMeans run produced labels - show a hint instead of hiding the picker silently. */
  kmeansLabelsAvailable: boolean
  /** The k of the current KMeans result (null = never run). */
  kmeansK: number | null
  /** True while a local KMeans computation is in flight. */
  kmeansComputing: boolean
  /** Selected cluster ids (null = all). */
  selectedKmeansIds: Set<number> | null
  /** 'continuous' | 'processed' — UMAP/KMeans only apply to continuous data */
  storageMode: string
  roiTool: string | null
  draftReady: boolean
  viewingRoi: boolean
  confirmedRois: ConfirmedROI[]
  /** 共享的 ROI 选中集（null = 全选）。同时驱动主图高亮与导出勾选，语义对齐 selectedKmeansIds。 */
  selectedRoiIds: Set<string> | null
  gamma: number
  /** 多离子叠加激活（父组件的 overlayActive）：Gamma 不参与叠加渲染，滑块置灰 */
  channelsMode: boolean
  /** Multi-ion overlay state (owned by the parent). */
  channelsEnabled: boolean
  ionChannels: IonChannel[]
  canAddChannel: boolean
  channelsLoading: boolean
  selectedMz: number
  maxIonChannels: number
  batchAddMode: boolean
  /** 文件导入的掩膜摘要：ROI 模块展示信息卡，导出面板的「已导入」标签取其 name */
  importedMask?: ImportedMaskSummary | null
  /** 导入掩膜过滤是否生效（false = 显示原图） */
  importedMaskActive?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-overlay', kind: OverlayKind): void
  (e: 'retry-clustering'): void
  /** Fired when the user confirms the first-time enable - the parent POSTs
   *  the (idempotent) clustering task. */
  (e: 'enable-clustering'): void
  /** Fired by the Refresh button while the task is computing. */
  (e: 'refresh-clustering'): void
  (e: 'update:umapAlpha', value: number): void
  (e: 'update:kmeansAlpha', value: number): void
  (e: 'toggle-kmeans-cluster', id: number): void
  (e: 'kmeans-select-all'): void
  (e: 'kmeans-clear-all'): void
  /** Fired when the user confirms a k in the KMeans dialog - the parent runs
   *  the local clustering over the UMAP raster. */
  (e: 'run-kmeans', k: number): void
  (e: 'export-umap'): void
  (e: 'export-kmeans'): void
  (e: 'update:roiTool', value: string | null): void
  (e: 'update:viewingRoi', value: boolean): void
  (e: 'roi-confirm'): void
  (e: 'roi-cancel'): void
  (e: 'roi-delete', id: string): void
  /** 选中集操作：驱动主图高亮 + 导出勾选（与 kmeans 的 select-all/clear-all 同构）。
   *  注意与上面的 'roi-clear-all'（删除全部 ROI）区分开。 */
  (e: 'toggle-roi-selection', id: string): void
  (e: 'roi-select-all'): void
  (e: 'roi-deselect-all'): void
  (e: 'export-masks', payload: MaskExportPayload): void
  (e: 'roi-clear-all'): void
  (e: 'update:gamma', value: number): void
  /** Multi-ion overlay events (state lives in the parent). */
  (e: 'update:channelsEnabled', value: boolean): void
  (e: 'add-current-channel'): void
  (e: 'toggle-batch-add'): void
  (e: 'update-channel-color', id: number, color: { r: number; g: number; b: number }): void
  (e: 'update-channel-opacity', id: number, opacity: number): void
  (e: 'remove-channel', id: number): void
  (e: 'toggle-channel-visible', id: number): void
  (e: 'retry-channel', id: number): void
  (e: 'clear-channels'): void
  (e: 'import-mask', file: File): void
  (e: 'clear-imported-mask'): void
  (e: 'toggle-imported-mask'): void
}>()

// UMAP/KMeans overlays are opt-in: buttons stay grayed out until the user
// flips this switch. First-time enabling asks for confirmation (it starts a
// backend clustering task); re-enabling an existing task does not.
const computationEnabled = ref(false)
const showConfirm = ref(false)
const toggleRef = ref<HTMLInputElement | null>(null)

const isContinuous = computed(() => props.storageMode === 'continuous')

// KMeans is computed locally: the button opens a k-input dialog the first
// time, and toggles the cached result afterwards. "Re-run" reopens the dialog.
const showKmeansDialog = ref(false)
const kInput = ref(5)
const K_MIN = 2
const K_MAX = 20

function onKmeansClick() {
  if (props.kmeansVisible || props.kmeansK !== null) {
    // A result already exists (or is showing) - plain toggle.
    emit('toggle-overlay', 'kmeans')
    return
  }
  kInput.value = 5
  showKmeansDialog.value = true
}

function openKmeansDialog() {
  kInput.value = props.kmeansK ?? 5
  showKmeansDialog.value = true
}

function onKmeansConfirm() {
  const k = Math.round(kInput.value)
  if (!(k >= K_MIN && k <= K_MAX)) return
  emit('run-kmeans', k)
}

// Close the dialog once a run succeeds (kmeansK gets set).
watch(
  () => props.kmeansK,
  (v) => {
    if (v !== null) showKmeansDialog.value = false
  },
)

// Recover the enable state when the task turns out ready - either from the
// page-entry probe (a finished task already existed) or from a Refresh that
// found completion. No confirmation needed: no new compute is triggered.
watch(
  () => props.clusteringReady,
  (ready) => {
    if (ready) computationEnabled.value = true
  },
)

function isClusterSelected(id: number): boolean {
  return props.selectedKmeansIds === null || props.selectedKmeansIds.has(id)
}

const selectedClusterCount = computed(() =>
  props.selectedKmeansIds === null ? props.kmeansClusters.length : props.selectedKmeansIds.size,
)

function onToggleComputation(e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  if (checked) {
    if (props.clusteringReady || props.clusteringComputing) {
      // The task already exists - enabling only reads data/status, so skip
      // the compute-cost confirmation.
      computationEnabled.value = true
    } else {
      // First-time creation: warn before starting the backend task.
      showConfirm.value = true
    }
  } else {
    computationEnabled.value = false
    // Clear any active overlays when the user opts out.
    if (props.umapVisible) emit('toggle-overlay', 'umap')
    if (props.kmeansVisible) emit('toggle-overlay', 'kmeans')
  }
}

function confirmEnable() {
  computationEnabled.value = true
  showConfirm.value = false
  // Kick off task creation immediately on confirm; the toast + status rows
  // are driven by the composable in response to this.
  emit('enable-clustering')
}

function cancelEnable() {
  computationEnabled.value = false
  showConfirm.value = false
  // The toggle was never committed, so revert its visual state manually —
  // :checked won't re-apply because computationEnabled is unchanged.
  if (toggleRef.value) toggleRef.value.checked = false
}
</script>

<template>
  <!-- Multi-ion overlay：仅 continuous 数据可用（processed 整块不渲染） -->
  <CollapsibleSection v-if="isContinuous" :title="$t('vizworkbench.overlay.multiIon')" class="mt-5">
    <IonChannelPanel
      :enabled="channelsEnabled"
      :channels="ionChannels"
      :current-mz="selectedMz"
      :can-add="canAddChannel"
      :any-loading="channelsLoading"
      :max-channels="maxIonChannels"
      :batch-add-mode="batchAddMode"
      @update:enabled="emit('update:channelsEnabled', $event)"
      @add-current="emit('add-current-channel')"
      @toggle-batch-add="emit('toggle-batch-add')"
      @update-color="(id, color) => emit('update-channel-color', id, color)"
      @update-opacity="(id, opacity) => emit('update-channel-opacity', id, opacity)"
      @remove="emit('remove-channel', $event)"
      @toggle-visible="emit('toggle-channel-visible', $event)"
      @retry="emit('retry-channel', $event)"
      @clear="emit('clear-channels')"
    />
  </CollapsibleSection>

  <CollapsibleSection :title="$t('vizworkbench.overlay.visualization')" class="mt-5">
    <div class="mb-3">
      <div class="flex items-center justify-between mb-1">
        <span class="text-base-content">{{ $t('vizworkbench.overlay.gamma') }}</span>
        <span class="font-mono text-base-content">{{ gamma.toFixed(1) }}</span>
      </div>
      <input
        type="range"
        class="range range-xs range-primary"
        :class="{ 'opacity-50': channelsMode }"
        :disabled="channelsMode"
        :title="channelsMode ? $t('vizworkbench.ionImage.rangeDisabled') : undefined"
        min="0.5"
        max="1.5"
        step="0.1"
        :value="gamma"
        @input="emit('update:gamma', +($event.target as HTMLInputElement).value)"
      />
      <div class="flex justify-between text-base-content mt-0.5">
        <span>0.5</span>
        <span>1.0</span>
        <span>1.5</span>
      </div>
    </div>

    <!-- UMAP / KMeans: only available for continuous storage -->
    <div v-if="isContinuous" class="mt-2">
      <label
        class="flex items-center justify-between mb-2 cursor-pointer select-none kawaru-text-75"
        :class="{ 'opacity-60 pointer-events-none': clusteringCreating }"
      >
        <span class="text-base-content">{{ $t('vizworkbench.overlay.enable') }}</span>
        <input
          ref="toggleRef"
          type="checkbox"
          class="toggle toggle-sm toggle-primary"
          :checked="computationEnabled"
          :disabled="clusteringCreating"
          @change="onToggleComputation"
        />
      </label>

      <div v-if="clusteringCreating" class="text-base-content/60 mt-1.5 flex items-center gap-1">
        <span class="loading loading-spinner loading-xs"></span>
        {{ $t('vizworkbench.overlay.creating') }}
      </div>
      <div
        v-else-if="clusteringComputing && !clusteringReady"
        class="text-base-content/60 mt-1.5 flex items-center gap-2"
      >
        <span class="loading loading-spinner loading-xs"></span>
        <span class="flex-1">{{ $t('vizworkbench.overlay.computing') }}</span>
        <button
          class="btn btn-ghost btn-xs kawaru-text-56"
          :disabled="clusteringRefreshing"
          @click="emit('refresh-clustering')"
        >
          <span v-if="clusteringRefreshing" class="loading loading-spinner loading-xs"></span>
          {{ $t('common.action.refresh') }}
        </button>
      </div>

      <div class="flex gap-2">
        <button
          class="btn btn-sm flex-1 kawaru-text-68 rounded-lg transition-colors"
          :class="
            !computationEnabled || !clusteringReady
              ? 'bg-base-200 dark:bg-base-300 text-base-content/40 border-base-300 dark:border-base-400 cursor-not-allowed'
              : umapVisible
                ? 'bg-teal-500 text-white border-teal-500'
                : 'bg-teal-100 dark:bg-teal-950 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800 hover:bg-teal-200 dark:hover:bg-teal-900'
          "
          :disabled="
            !computationEnabled || !clusteringReady || overlayLoading || clusteringCreating
          "
          @click="emit('toggle-overlay', 'umap')"
        >
          UMAP
        </button>
        <button
          class="btn btn-sm flex-1 kawaru-text-68 rounded-lg transition-colors"
          :class="
            !computationEnabled || !clusteringReady
              ? 'bg-base-200 dark:bg-base-300 text-base-content/40 border-base-300 dark:border-base-400 cursor-not-allowed'
              : kmeansVisible
                ? 'bg-rose-500 text-white border-rose-500'
                : 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800 hover:bg-rose-200 dark:hover:bg-rose-900'
          "
          :disabled="
            !computationEnabled ||
            !clusteringReady ||
            overlayLoading ||
            clusteringCreating ||
            kmeansComputing
          "
          @click="onKmeansClick"
        >
          KMeans
        </button>
      </div>

      <div
        v-if="overlayLoading && computationEnabled"
        class="text-base-content/60 mt-1.5 flex items-center gap-1"
      >
        <span class="loading loading-spinner loading-xs"></span>
        {{ $t('vizworkbench.overlay.loading') }}
      </div>

      <div v-if="overlayError" class="text-error mt-1.5 flex items-center gap-2">
        <span class="flex-1">{{
          $t('vizworkbench.overlay.unavailable', { error: overlayError })
        }}</span>
        <button
          class="btn btn-ghost btn-sm text-error kawaru-text-62"
          @click="emit('retry-clustering')"
        >
          {{ $t('common.action.retry') }}
        </button>
      </div>
    </div>

    <!-- Overlay opacity: one slider per active overlay -->
    <div v-if="umapVisible" class="mt-3">
      <div class="flex items-center justify-between font-semibold text-base-content mb-1">
        <span>{{ $t('vizworkbench.overlay.umapOpacity') }}</span>
        <span class="font-mono font-normal">{{ Math.round(umapAlpha / 2.55) }}%</span>
      </div>
      <input
        type="range"
        :min="0"
        :max="255"
        :value="umapAlpha"
        class="range range-sm w-full [--range-fill:0] [--range-thumb:bg-teal-400] [--range-bg:theme(colors.teal.100)] dark:[--range-bg:theme(colors.teal.900)]"
        @input="emit('update:umapAlpha', +($event.target as HTMLInputElement).value)"
      />
      <button
        class="btn btn-sm btn-ghost gap-1 mt-1.5 w-full kawaru-text-62"
        :title="$t('vizworkbench.overlay.exportUmapHint')"
        @click="emit('export-umap')"
      >
        <SvgIcon type="download" />
        {{ $t('vizworkbench.overlay.exportUmap') }}
      </button>
    </div>
    <div v-if="kmeansVisible" class="mt-3">
      <div class="flex items-center justify-between font-semibold text-base-content mb-1">
        <span>
          {{ $t('vizworkbench.overlay.kmeansOpacity') }}
          <span v-if="kmeansK !== null" class="ml-1.5 font-mono font-normal text-base-content/60"
            >(k={{ kmeansK }})</span
          >
        </span>
        <span class="font-mono font-normal">{{ Math.round(kmeansAlpha / 2.55) }}%</span>
      </div>
      <input
        type="range"
        :min="0"
        :max="255"
        :value="kmeansAlpha"
        class="range range-sm w-full [--range-fill:0] [--range-thumb:bg-rose-400] [--range-bg:theme(colors.rose.100)] dark:[--range-bg:theme(colors.rose.900)]"
        @input="emit('update:kmeansAlpha', +($event.target as HTMLInputElement).value)"
      />
      <button
        class="btn btn-sm btn-ghost gap-1 mt-1.5 w-full kawaru-text-62"
        :title="$t('vizworkbench.overlay.exportKmeansHint')"
        @click="emit('export-kmeans')"
      >
        <SvgIcon type="download" />
        {{ $t('vizworkbench.overlay.exportKmeans') }}
      </button>

      <!-- Cluster picker: also drives the export mask -->
      <div v-if="kmeansClusters.length" class="mt-2 pt-2 border-t border-base-content/15">
        <div class="font-semibold text-base-content mb-1">
          {{ $t('vizworkbench.overlay.clusters') }}
          <span class="font-mono font-normal text-base-content/60">
            {{ selectedClusterCount }}/{{ kmeansClusters.length }}
          </span>
        </div>
        <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 max-h-48 overflow-y-auto">
          <label
            v-for="c in kmeansClusters"
            :key="c.id"
            class="flex items-center gap-1.5 py-1 cursor-pointer select-none kawaru-text-75"
          >
            <input
              type="checkbox"
              class="checkbox checkbox-xs checkbox-primary"
              :checked="isClusterSelected(c.id)"
              @change="emit('toggle-kmeans-cluster', c.id)"
            />
            <span
              class="w-3 h-3 rounded-sm border border-base-content/30 shrink-0"
              :style="{ backgroundColor: `rgb(${c.color[0]},${c.color[1]},${c.color[2]})` }"
            ></span>
            <span class="text-base-content truncate">{{
              $t('vizworkbench.kmeans.cluster', { id: c.id })
            }}</span>
          </label>
        </div>
        <div v-if="selectedClusterCount === 0" class="text-base-content/50 mt-1">
          {{ $t('vizworkbench.overlay.noClusters') }}
        </div>
        <div class="flex gap-1 mt-2">
          <button
            class="btn btn-ghost btn-sm kawaru-text-62"
            :title="$t('vizworkbench.overlay.rerunHint')"
            @click="openKmeansDialog"
          >
            {{ $t('vizworkbench.overlay.rerun') }}
          </button>
          <button class="btn btn-ghost btn-sm kawaru-text-62" @click="emit('kmeans-select-all')">
            {{ $t('vizworkbench.mask.all') }}
          </button>
          <button class="btn btn-ghost btn-sm kawaru-text-62" @click="emit('kmeans-clear-all')">
            {{ $t('common.action.clear') }}
          </button>
        </div>
      </div>
      <div
        v-else-if="!kmeansLabelsAvailable"
        class="mt-2 pt-2 border-t border-base-content/15 text-base-content/50"
      >
        {{ $t('vizworkbench.overlay.runHint') }}
      </div>
    </div>
  </CollapsibleSection>

  <CollapsibleSection :title="$t('vizworkbench.overlay.roi')" class="mt-5">
    <ROIPanel
      :selected-tool="roiTool"
      :draft-ready="draftReady"
      :rois="confirmedRois"
      :viewing-roi="viewingRoi"
      :selected-roi-ids="selectedRoiIds"
      :imported-mask="importedMask"
      @update:selected-tool="emit('update:roiTool', $event)"
      @update:viewing-roi="emit('update:viewingRoi', $event)"
      @confirm="emit('roi-confirm')"
      @cancel="emit('roi-cancel')"
      @delete="emit('roi-delete', $event)"
      @clear-all="emit('roi-clear-all')"
      @toggle-selection="emit('toggle-roi-selection', $event)"
      @select-all="emit('roi-select-all')"
      @deselect-all="emit('roi-deselect-all')"
      @clear-imported-mask="emit('clear-imported-mask')"
    />
  </CollapsibleSection>

  <CollapsibleSection :title="$t('vizworkbench.overlay.export')" class="mt-5">
    <!-- One group per export kind; today only the ROI/cluster mask export -->
    <div>
      <div class="kawaru-text-68 font-semibold text-base-content mb-2 tracking-wide">
        {{ $t('vizworkbench.overlay.roiExport') }}
      </div>
      <MaskExportPanel
        :rois="confirmedRois"
        :selected-roi-ids="selectedRoiIds"
        :kmeans-clusters="kmeansClusters"
        :kmeans-labels-available="kmeansLabelsAvailable"
        :kmeans-k="kmeansK"
        :selected-kmeans-ids="selectedKmeansIds"
        :imported-mask-name="importedMask?.name ?? null"
        :imported-mask-active="importedMaskActive ?? true"
        @toggle-imported-mask="emit('toggle-imported-mask')"
        @export-masks="(payload) => emit('export-masks', payload)"
        @import-mask="(file) => emit('import-mask', file)"
        @clear-imported-mask="emit('clear-imported-mask')"
        @toggle-roi-selection="emit('toggle-roi-selection', $event)"
        @roi-select-all="emit('roi-select-all')"
        @roi-deselect-all="emit('roi-deselect-all')"
        @toggle-kmeans-cluster="emit('toggle-kmeans-cluster', $event)"
        @kmeans-select-all="emit('kmeans-select-all')"
        @kmeans-clear-all="emit('kmeans-clear-all')"
      />
    </div>
  </CollapsibleSection>

  <!-- Opt-in confirmation: first-time enable starts a backend clustering task -->
  <ConfirmDialog
    :open="showConfirm"
    :title="$t('vizworkbench.overlay.umapTitle')"
    :message="$t('vizworkbench.overlay.umapMessage')"
    :confirm-label="$t('vizworkbench.overlay.continue')"
    @confirm="confirmEnable"
    @cancel="cancelEnable"
  />

  <!-- KMeans: local clustering with a user-chosen k -->
  <ConfirmDialog
    :open="showKmeansDialog"
    :title="$t('vizworkbench.overlay.kmeansTitle')"
    :confirm-label="$t('vizworkbench.overlay.compute')"
    :loading="kmeansComputing"
    @confirm="onKmeansConfirm"
    @cancel="showKmeansDialog = false"
  >
    <div class="flex items-center gap-3">
      <span>{{ $t('vizworkbench.overlay.kLabel') }}</span>
      <input
        v-model.number="kInput"
        type="number"
        :min="K_MIN"
        :max="K_MAX"
        class="input input-sm input-bordered w-20 kawaru-text-62"
      />
    </div>
    <p class="text-base-content/60 mt-2">
      {{ $t('vizworkbench.overlay.kHint', { min: K_MIN, max: K_MAX }) }}
    </p>
  </ConfirmDialog>
</template>

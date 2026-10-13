<template>
  <div class="kawaru-text-68">
    <!-- Import is available even when there are no locally-created regions. -->
    <div class="flex items-center gap-1 mb-3">
      <input
        ref="importInput"
        type="file"
        class="hidden"
        accept=".npz,.csv"
        @change="onImportChange"
      />
      <button class="btn btn-sm btn-ghost flex-1 kawaru-text-68" @click="importInput?.click()">
        <SvgIcon type="upload" />
        {{ $t('vizworkbench.mask.import') }}
      </button>
      <button
        v-if="importedMaskName"
        class="btn btn-sm btn-ghost text-error kawaru-text-68"
        :title="$t('vizworkbench.mask.clearImport')"
        @click="emit('clear-imported-mask')"
      >
        <SvgIcon type="trash" />
      </button>
    </div>
    <div
      v-if="importedMaskName"
      class="text-base-content/60 mb-2 truncate"
      :title="importedMaskName"
    >
      {{ $t('vizworkbench.mask.imported', { name: importedMaskName }) }}
    </div>
    <!-- 显示原图 ↔ 应用掩膜：暂停/恢复导入掩膜的过滤（导入本身保留）。
         独占一行：与导入按钮同行会把「导入掩膜」文案挤出按钮框 -->
    <button
      v-if="importedMaskName"
      class="btn btn-sm w-full mb-2 kawaru-text-68"
      :class="importedMaskActive ? 'btn-ghost' : 'btn-primary'"
      :title="
        importedMaskActive
          ? $t('vizworkbench.mask.showOriginalHint')
          : $t('vizworkbench.mask.applyMaskHint')
      "
      @click="emit('toggle-imported-mask')"
    >
      {{
        importedMaskActive
          ? $t('vizworkbench.mask.showOriginal')
          : $t('vizworkbench.mask.applyMask')
      }}
    </button>

    <!-- Format -->
    <div class="flex items-center gap-2 mb-2">
      <span class="text-base-content">{{ $t('vizworkbench.mask.format') }}</span>
      <div class="join">
        <button
          v-for="f in FORMATS"
          :key="f.value"
          class="btn btn-xs join-item kawaru-text-68"
          :class="format === f.value ? 'btn-primary' : 'btn-ghost'"
          @click="format = f.value"
        >
          {{ f.label }}
        </button>
      </div>
    </div>

    <div v-if="!hasItems" class="text-base-content/60">
      {{ $t('vizworkbench.mask.empty') }}
    </div>

    <template v-else>
      <div class="text-base-content/60 mb-2">
        {{ $t('vizworkbench.mask.mergeHint') }}
      </div>

      <!-- ROI regions -->
      <div v-if="rois.length" class="mb-2">
        <div class="font-semibold text-base-content mb-1">
          {{ $t('vizworkbench.mask.roiMasks') }}
        </div>
        <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 max-h-40 overflow-y-auto">
          <label
            v-for="roi in rois"
            :key="roi.id"
            class="flex items-center gap-1.5 py-0.5 cursor-pointer select-none kawaru-text-75"
          >
            <input
              type="checkbox"
              class="checkbox checkbox-xs checkbox-primary"
              :checked="isRoiSelected(roi.id)"
              @change="emit('toggle-roi-selection', roi.id)"
            />
            <span
              class="w-3 h-3 rounded-sm border border-base-content/30 shrink-0"
              :style="{ backgroundColor: roi.color }"
            ></span>
            <span class="text-base-content truncate">{{ roi.label }}</span>
          </label>
        </div>
      </div>

      <!-- KMeans clusters (shared selection with the ion-image overlay) -->
      <div v-if="kmeansClusters.length" class="mb-2">
        <div class="font-semibold text-base-content mb-1">
          {{ $t('vizworkbench.mask.kmeansClusters') }}
          <span v-if="kmeansK !== null" class="font-mono font-normal text-base-content/60"
            >(k={{ kmeansK }})</span
          >
        </div>
        <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 max-h-40 overflow-y-auto">
          <label
            v-for="c in kmeansClusters"
            :key="c.id"
            class="flex items-center gap-1.5 py-0.5 cursor-pointer select-none kawaru-text-75"
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
      </div>
      <div v-else-if="!kmeansLabelsAvailable" class="text-base-content/60 mb-2">
        {{ $t('vizworkbench.mask.runKmeansHint') }}
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-1">
        <button
          class="btn btn-sm btn-primary flex-1 kawaru-text-68"
          :disabled="selectedCount === 0"
          :title="$t('vizworkbench.mask.exportHint')"
          @click="onExport"
        >
          <SvgIcon type="download" />
          {{ $t('vizworkbench.mask.export') }}
        </button>
        <button class="btn btn-ghost btn-sm kawaru-text-68" @click="selectAll">
          {{ $t('vizworkbench.mask.all') }}
        </button>
        <button class="btn btn-ghost btn-sm kawaru-text-68" @click="clearAll">
          {{ $t('common.action.clear') }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import SvgIcon from '@/shared/components/SvgIcon.vue'
import type { ConfirmedROI } from '@/features/vizworkbench/composables/useROI'
import type { KmeansCluster } from '@/features/vizworkbench/composables/useOverlayData'
import type { ExportFormat, MaskExportPayload } from '@/features/vizworkbench/utils/maskExport'

const props = defineProps<{
  rois: ConfirmedROI[]
  /** Shared ROI selection (null = all). Same state the ion-image highlight and
   *  the ROI panel use, so checking a ROI here also highlights it on the image. */
  selectedRoiIds: Set<string> | null
  kmeansClusters: KmeansCluster[]
  /** False until a local KMeans run produced labels. */
  kmeansLabelsAvailable: boolean
  /** The k of the current KMeans result (null = never run). */
  kmeansK: number | null
  /** Shared KMeans selection (null = all). Same state the ion-image overlay
   *  uses, so checking a cluster here also shows it on the image. */
  selectedKmeansIds: Set<number> | null
  importedMaskName?: string | null
  /** 导入掩膜过滤是否生效（false = 显示原图） */
  importedMaskActive?: boolean
}>()

const emit = defineEmits<{
  (e: 'export-masks', payload: MaskExportPayload): void
  (e: 'toggle-roi-selection', id: string): void
  (e: 'roi-select-all'): void
  (e: 'roi-deselect-all'): void
  (e: 'toggle-kmeans-cluster', id: number): void
  (e: 'kmeans-select-all'): void
  (e: 'kmeans-clear-all'): void
  (e: 'import-mask', file: File): void
  (e: 'clear-imported-mask'): void
  (e: 'toggle-imported-mask'): void
}>()

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'npz', label: '.npz' },
  { value: 'csv', label: '.csv' },
]

const format = ref<ExportFormat>('npz')

// Both ROI and KMeans selection are shared state (owned upstream), passed in
// and toggled via events — same pattern as the ion-image pickers, so the
// checkboxes here and the on-image highlight never diverge.
const importInput = ref<HTMLInputElement | null>(null)

const hasItems = computed(() => props.rois.length > 0 || props.kmeansClusters.length > 0)

function isRoiSelected(id: string): boolean {
  return props.selectedRoiIds === null || props.selectedRoiIds.has(id)
}

// Count by filtering rois (never Set.size) — the set may hold deleted ids.
const checkedRoiIds = computed(() => props.rois.filter((r) => isRoiSelected(r.id)).map((r) => r.id))

function isClusterSelected(id: number): boolean {
  return props.selectedKmeansIds === null || props.selectedKmeansIds.has(id)
}

const selectedClusterIds = computed(() =>
  props.kmeansClusters.filter((c) => isClusterSelected(c.id)).map((c) => c.id),
)

/** Number of selected regions feeding the single merged mask. */
const selectedCount = computed(() => checkedRoiIds.value.length + selectedClusterIds.value.length)

function selectAll() {
  // Both sides: "All" must select ROIs and clusters together.
  emit('roi-select-all')
  emit('kmeans-select-all')
}

function clearAll() {
  emit('roi-deselect-all')
  emit('kmeans-clear-all')
}

function onExport() {
  if (selectedCount.value === 0) return
  emit('export-masks', {
    format: format.value,
    roiIds: checkedRoiIds.value,
    clusterIds: selectedClusterIds.value,
  })
}

function onImportChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) emit('import-mask', file)
}
</script>

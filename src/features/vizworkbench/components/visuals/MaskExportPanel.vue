<template>
  <div class="kawaru-text-68 text-base-content">
    <div class="flex items-center justify-between gap-2 mb-1.5">
      <div class="flex items-center gap-1">
        <h3 class="kawaru-text-75 font-semibold">{{ $t('vizworkbench.mask.toExport') }}</h3>
        <SectionHelp :label="$t('vizworkbench.mask.toExport')">
          {{ $t('vizworkbench.mask.exportHint') }}
        </SectionHelp>
      </div>
      <div class="join" role="group" :aria-label="$t('vizworkbench.mask.format')">
        <button
          v-for="f in FORMATS"
          :key="f.value"
          type="button"
          class="btn btn-xs join-item kawaru-text-62"
          :class="format === f.value ? 'btn-primary' : 'btn-ghost'"
          :aria-pressed="format === f.value"
          @click="format = f.value"
        >
          {{ f.label }}
        </button>
      </div>
    </div>

    <!-- 列出从 ROI 列表和 KMeans 聚类中选中的导出项。 -->
    <ul v-if="targets.length" class="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
      <li
        v-for="item in targets"
        :key="item.key"
        class="max-w-full truncate rounded-md bg-base-200 px-1.5 py-0.5 kawaru-text-62"
        :title="item.name"
      >
        {{ item.name }}
      </li>
    </ul>
    <div class="flex gap-2 mt-2">
      <button
        type="button"
        class="btn btn-sm btn-primary flex-1 kawaru-text-68"
        :disabled="!targets.length"
        @click="onExport"
      >
        <SvgIcon type="download" />
        {{ $t('vizworkbench.mask.export') }}
      </button>
      <input
        ref="importInput"
        type="file"
        class="hidden"
        accept=".npz,.npy,.csv"
        multiple
        @change="onImportChange"
      />
      <button
        type="button"
        class="btn btn-sm btn-ghost flex-1 kawaru-text-68"
        @click="importInput?.click()"
      >
        <SvgIcon type="upload" />
        {{ $t('vizworkbench.mask.import') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, shallowRef, useTemplateRef } from 'vue'
import SvgIcon from '@/shared/components/SvgIcon.vue'
import SectionHelp from '@/features/vizworkbench/components/SectionHelp.vue'
import type { ConfirmedROI } from '@/features/vizworkbench/composables/useROI'
import type { KmeansCluster } from '@/features/vizworkbench/composables/useOverlayData'
import type { ExportFormat, MaskExportPayload } from '@/features/vizworkbench/utils/maskExport'
import { t } from '@/i18n'

const props = defineProps<{
  rois: ConfirmedROI[]
  /** Shared ROI selection (null = all) - the same state that highlights ROIs on the image. */
  selectedRoiIds: Set<string> | null
  kmeansClusters: KmeansCluster[]
  /** Clusters are exported only while the KMeans overlay is showing. */
  kmeansVisible: boolean
  /** Shared KMeans selection (null = all) - the same state the overlay draws. */
  selectedKmeansIds: Set<number> | null
}>()

const emit = defineEmits<{
  (e: 'export-masks', payload: MaskExportPayload): void
  /** Picked mask files; the parent adds each valid one as an ROI. */
  (e: 'import-masks', files: File[]): void
}>()

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'npz', label: '.npz' },
  { value: 'csv', label: '.csv' },
]

const format = shallowRef<ExportFormat>('npz')
const importInput = useTemplateRef<HTMLInputElement>('importInput')

// Export what the image shows: highlighted ROIs, plus the drawn clusters while
// KMeans is visible. Filter the ROI list (never read Set.size) - the selection
// set may still hold ids of deleted ROIs.
const exportRois = computed(() =>
  props.rois.filter((r) => props.selectedRoiIds === null || props.selectedRoiIds.has(r.id)),
)

const exportClusterIds = computed(() =>
  props.kmeansVisible
    ? props.kmeansClusters
        .filter((c) => props.selectedKmeansIds === null || props.selectedKmeansIds.has(c.id))
        .map((c) => c.id)
    : [],
)

const targets = computed(() => [
  ...exportRois.value.map((r) => ({ key: `roi:${r.id}`, name: r.label })),
  ...exportClusterIds.value.map((id) => ({
    key: `cluster:${id}`,
    name: t('vizworkbench.kmeans.cluster', { id }),
  })),
])

function onExport() {
  if (!targets.value.length) return
  emit('export-masks', {
    format: format.value,
    roiIds: exportRois.value.map((r) => r.id),
    clusterIds: exportClusterIds.value,
  })
}

function onImportChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length) emit('import-masks', files)
}
</script>

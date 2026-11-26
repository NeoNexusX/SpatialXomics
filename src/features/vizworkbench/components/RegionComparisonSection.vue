<script setup lang="ts">
/**
 * Region comparison: the A/B group picker with its preview on the left, the
 * results table on the right. Both share one expanded state; opening it
 * scrolls the section into view.
 */
import { nextTick, ref, toRef, useTemplateRef, watch } from 'vue'
import CompareRegionsPanel from '@/features/vizworkbench/components/CompareRegionsPanel.vue'
import ComparisonResultsTable from '@/features/vizworkbench/components/ComparisonResultsTable.vue'
import RegionPreviewThumbnail from '@/features/vizworkbench/components/RegionPreviewThumbnail.vue'
import { useRegionComparison } from '@/features/vizworkbench/composables/useRegionComparison'
import { rgbCss } from '@/features/vizworkbench/utils/regionPalette'
import type { Region, RegionGrid } from '@/features/vizworkbench/utils/region'
import type { DataMode } from '@/services/zarr/types/zarr'

const props = defineProps<{
  /** Saved ROIs and KMeans clusters to pick the groups from. */
  regions: Region[]
  grid: RegionGrid
  dataMode: DataMode | null
  /** Dimmed backdrop of the preview. */
  backdrop: Float32Array | null
  spectrumMode?: string
  selectedMzIndex: number
}>()

const emit = defineEmits<{
  /** A result row was clicked: show that ion. */
  (e: 'select-mz', ionIndex: number): void
}>()

const comparison = useRegionComparison({
  regions: toRef(props, 'regions'),
  grid: toRef(props, 'grid'),
  dataMode: toRef(props, 'dataMode'),
})

const expanded = ref(false)
const root = useTemplateRef<HTMLElement>('root')

// 展开 compare 时将中列平滑滚到该区域顶部，展示完整控件和结果。
watch(expanded, async (open) => {
  if (!open) return
  await nextTick()
  root.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
})
</script>

<template>
  <div ref="root" class="w-full flex flex-col items-stretch gap-4 lg:flex-row lg:items-stretch">
    <!-- 左 controls+preview，右结果表。桌面端折叠栏保留在首屏，展开后由中列承载滚动。 -->
    <!-- 左侧正常参与文档流，它的自然高度决定整个 compare 区域的高度。 -->
    <div class="w-full min-w-0 flex flex-col lg:w-0 lg:flex-[2_1_0%]">
      <CompareRegionsPanel
        v-model:region-a-ids="comparison.regionAIds"
        v-model:region-b-ids="comparison.regionBIds"
        v-model:min-detection-rate="comparison.minDetectionRate"
        v-model:noise-floor-percentile="comparison.noiseFloorPercentile"
        v-model:enrichment-ratio="comparison.enrichmentRatio"
        v-model:expanded="expanded"
        :regions="regions"
        :spectrum-mode="spectrumMode"
        :comparing="comparison.comparing"
        :progress="comparison.progress"
        :error="comparison.error"
        :can-compare="comparison.canCompare"
        :color-a="comparison.colorA"
        :color-b="comparison.colorB"
        @compare="comparison.compare()"
        @cancel="comparison.cancel()"
      >
        <template #preview>
          <!-- Only the selected A/B regions are drawn, so the thumbnail stays on the current comparison. -->
          <RegionPreviewThumbnail
            v-if="grid.shape[0] && grid.shape[1]"
            :a="comparison.selectedRegionsA"
            :b="comparison.selectedRegionsB"
            :grid="grid"
            :matrix="backdrop"
          />
        </template>
      </CompareRegionsPanel>
    </div>
    <!-- 桌面端右侧不参与父容器高度计算，只填满左侧确定的共享高度。 -->
    <div class="w-full min-w-0 lg:relative lg:w-0 lg:flex-[5_1_0%] lg:min-h-0">
      <ComparisonResultsTable
        v-model:expanded="expanded"
        class="lg:absolute lg:inset-0"
        :results="comparison.categorizedResults"
        :selected-mz-index="selectedMzIndex"
        :filter-stats="comparison.filterStats"
        :region-a-color="rgbCss(comparison.colorA)"
        :region-b-color="rgbCss(comparison.colorB)"
        @select-mz="emit('select-mz', $event)"
      />
    </div>
  </div>
</template>

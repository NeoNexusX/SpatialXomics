<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import IonImageViewer from '@/features/vizworkbench/components/visuals/IonImageViewer.vue'
import ROIOverlay from '@/features/vizworkbench/components/visuals/ROIOverlay.vue'
import DisplayRangeStrip from '@/features/vizworkbench/components/visuals/DisplayRangeStrip.vue'
import type { ZarrSession } from '@/features/vizworkbench/composables/useZarrIonImage'
import type { IonImageDisplay } from '@/features/vizworkbench/composables/useIonImageDisplay'
import type { RoiState } from '@/features/vizworkbench/composables/useROI'
import type { IonChannelState } from '@/features/vizworkbench/composables/useIonChannels'
import { ZARR_STORE } from '@/shared/config/defaults'
import { t } from '@/i18n'

const props = defineProps<{
  isStale?: boolean
  /** Selected m/z and tolerance, the grid, loading state and TIC availability. */
  zarr: ZarrSession
  /** Colormap, intensity scale, gamma, display range and the image they apply to. */
  display: IonImageDisplay
  /** The ROI editor overlay, the ROI-only mask and the ROI highlight. */
  roi: RoiState
  /** While active, the multi-ion overlay replaces the single image. */
  multiIon: IonChannelState
  /** UMAP / KMeans overlay (RGBA, ion-grid sized). */
  overlayData: Uint8ClampedArray | null
  /** 当前选中像素坐标（processed 模式） */
  selectedPixelCoord?: { x: number; y: number } | null
}>()

const emit = defineEmits<{
  (e: 'searchMz', value: string): void
  /** 点击图像中的某个像素（加载该像素的谱） */
  (e: 'select-pixel', col: number, row: number): void
}>()

/** The toolbar's Reset: default tolerance, then every display control. */
function resetControls() {
  props.zarr.setMzTolerance(ZARR_STORE.defaultMzTolerance)
  props.display.reset()
}

/** 图像标题 */
const imageTitle = computed(() => t('vizworkbench.ionImage.title'))

/** 图像加载占位提示 */
const processedPlaceholder = computed(() => {
  if (props.zarr.dataMode === 'processed') return t('vizworkbench.ionImage.computingTic')
  if (props.zarr.dataMode === null) return t('vizworkbench.ionImage.loadingResult')
  return t('vizworkbench.ionImage.loading')
})

// ---- 延迟 loading overlay：避免快速切换时一闪而过 ----

const LOADING_DELAY = 250 // ms，loading 持续超过此阈值才显示 overlay
let delayTimer: ReturnType<typeof setTimeout> | null = null
const showLoadingOverlay = ref(false)

watch(
  () => props.zarr.loading,
  (loading) => {
    if (loading) {
      delayTimer = setTimeout(() => {
        showLoadingOverlay.value = true
      }, LOADING_DELAY)
    } else {
      if (delayTimer) {
        clearTimeout(delayTimer)
        delayTimer = null
      }
      showLoadingOverlay.value = false
    }
  },
)

// Clear any pending loading-delay timer on unmount
onBeforeUnmount(() => {
  if (delayTimer) {
    clearTimeout(delayTimer)
    delayTimer = null
  }
})
</script>

<template>
  <!-- 移动端保留 360px 可用高度；桌面端在首屏剩余空间内与谱图按 4:3 分高。 -->
  <div
    data-testid="ion-image-section"
    :data-loading="zarr.loading ? 'true' : 'false'"
    class="flex gap-2 p-2 min-h-[520px] shrink-0 lg:h-auto lg:min-h-0 lg:flex-[5_1_0%] lg:shrink"
  >
    <div class="flex-1 card bg-base-100 rounded-xl overflow-hidden">
      <div
        v-if="isStale"
        class="flex-1 flex flex-col items-center justify-center text-base-content/40 gap-1"
      >
        <p class="kawaru-text-95">{{ $t('vizworkbench.ionImage.noResult') }}</p>
        <p class="kawaru-text-95">{{ $t('vizworkbench.ionImage.noResultHint') }}</p>
      </div>
      <div
        v-else-if="zarr.error && !display.matrix"
        class="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center"
      >
        <p class="kawaru-text-112 font-semibold text-error">
          {{ $t('vizworkbench.ionImage.loadFailed') }}
        </p>
        <p class="kawaru-text-68 text-base-content/60 break-words">{{ zarr.error }}</p>
      </div>
      <div
        v-else-if="!display.matrix"
        class="flex-1 flex items-center justify-center text-base-content/40 kawaru-text-95"
      >
        {{ processedPlaceholder }}
      </div>
      <div v-else class="flex-1 min-h-0 relative overflow-hidden">
        <IonImageViewer
          :selected-mz="zarr.selectedMz"
          :mz-tolerance="zarr.mzTolerance"
          :colormap="display.colormap"
          :intensity-scale="display.intensityScale"
          :gamma="display.gamma"
          :display-min="display.displayMin"
          :display-max="display.displayMax"
          :matrix="display.matrix"
          :matrix-cols="zarr.ionCols"
          :matrix-rows="zarr.ionRows"
          :draw-mode="roi.editor.drawing"
          :overlay-data="overlayData"
          :overlay-width="zarr.ionCols"
          :overlay-height="zarr.ionRows"
          :data-mode="zarr.dataMode"
          :selected-pixel-coord="selectedPixelCoord"
          :normalization-loading="zarr.normalizationLoading"
          :normalization-error="zarr.normalizationError"
          :has-tic="zarr.hasTic"
          :image-title="imageTitle"
          :channels-mode="multiIon.overlayActive"
          :channels="multiIon.hoverChannels"
          :roi-mask="roi.roiUnionMask"
          :roi-highlight-data="roi.roiHighlightOverlay"
          @update:mz-tolerance="zarr.setMzTolerance($event)"
          @update:colormap="display.setColormap($event)"
          @update:intensity-scale="display.setIntensityScale($event)"
          @search-mz="emit('searchMz', $event)"
          @reset="resetControls"
          @select-pixel="(col, row) => emit('select-pixel', col, row)"
        >
          <template #drawing="{ imageRect }">
            <ROIOverlay
              :editor="roi.editor"
              :image-width="zarr.ionCols"
              :image-height="zarr.ionRows"
              :image-rect="imageRect"
            />
          </template>
        </IonImageViewer>
        <!-- 切换 m/z 时的加载遮罩（延迟出现，避免快速切换一闪而过）。
             多离子叠加模式下中列显示的是通道合成图，隐藏单图的加载遮罩。 -->
        <div
          v-if="showLoadingOverlay && display.matrix && !multiIon.overlayActive"
          class="absolute inset-0 flex items-center justify-center bg-base-100/80 backdrop-blur-[2px] z-10 transition-opacity duration-200"
        >
          <div class="flex flex-col items-center gap-3">
            <span class="loading loading-spinner loading-lg text-primary"></span>
            <span class="text-base-content/70 kawaru-text-95">{{
              $t('vizworkbench.ionImage.updating')
            }}</span>
          </div>
        </div>
        <div
          v-if="zarr.error"
          class="absolute left-3 right-3 top-3 z-30 rounded-lg border border-error/30 bg-error/10 px-3 py-2 kawaru-text-68 text-error shadow-sm backdrop-blur-sm"
        >
          {{ $t('vizworkbench.ionImage.updateFailed') }}
        </div>
      </div>
    </div>

    <DisplayRangeStrip :display="display" :disabled="multiIon.overlayActive" />
  </div>
</template>

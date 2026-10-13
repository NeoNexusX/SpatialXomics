<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import SvgIcon from '@/shared/components/SvgIcon.vue'
import IonImageViewer from '@/features/vizworkbench/components/visuals/IonImageViewer.vue'
import ROIOverlay from '@/features/vizworkbench/components/visuals/ROIOverlay.vue'
import type { ROIType } from '@/features/vizworkbench/composables/useROI'
import type { ViewIonChannel } from '@/features/vizworkbench/composables/useIonChannels'
import type { DataMode } from '@/services/zarr/types/zarr'
import { t } from '@/i18n'

const props = defineProps<{
  isStale?: boolean
  ionMatrix: Float32Array | null
  displayMatrix: Float32Array | null
  selectedMz: number
  mzTolerance: number
  colormap: string
  intensityScale: string
  gamma: number
  displayMin: number
  displayMax: number
  ionCols: number
  ionRows: number
  roiTool: ROIType | null
  overlayData: Uint8ClampedArray | null
  gradientCss: string
  calcHandleTop: (value: number) => number
  clampPct: (value: number) => number
  formatVal: (value: number) => string
  /** 数据模式 */
  dataMode?: DataMode | null
  /** 当前选中像素坐标（processed 模式） */
  selectedPixelCoord?: { x: number; y: number } | null
  /** 离子图是否正在加载（切换 m/z 时） */
  ionLoading?: boolean
  /** 离子图加载错误（保留上一张成功图并显示反馈） */
  ionError?: string | null
  /** 归一化计算是否进行中 */
  normalizationLoading?: boolean
  /** 归一化计算失败的原因 */
  normalizationError?: string | null
  /** zarr 是否预存 stats/tic（TIC 归一化可用） */
  hasTic?: boolean
  /** 多离子叠加模式 */
  channelsMode?: boolean
  /** 可见且已加载的叠加通道 */
  channels?: ViewIonChannel[]
  /** ROI 并集掩膜（叠加模式下按此裁剪通道） */
  roiMask?: Uint8Array | null
  /** 选中 ROI 的高亮层（RGBA，与离子图同尺寸） */
  roiHighlightData?: Uint8ClampedArray | null
}>()

const emit = defineEmits<{
  (e: 'update:mzTolerance', value: number): void
  (e: 'update:colormap', value: string): void
  (e: 'update:intensityScale', value: string): void
  (e: 'searchMz', value: string): void
  (e: 'reset-controls'): void
  (e: 'reset-range'): void
  (e: 'strip-ref', element: HTMLElement | null): void
  (e: 'strip-mouse-down', event: MouseEvent): void
  (e: 'start-strip-drag', which: 'min' | 'max', event: MouseEvent): void
  (e: 'draft-updated', draft: any): void
  (e: 'draft-cleared'): void
  (e: 'roi-overlay-ref', element: InstanceType<typeof ROIOverlay> | null): void
  /** 点击图像中的某个像素（加载该像素的谱） */
  (e: 'select-pixel', col: number, row: number): void
}>()

const ionViewerRef = ref<InstanceType<typeof IonImageViewer> | null>(null)
const roiOverlayRef = ref<InstanceType<typeof ROIOverlay> | null>(null)

watch(roiOverlayRef, (el) => emit('roi-overlay-ref', el ?? null))

/** 图像标题 */
const imageTitle = computed(() => t('vizworkbench.ionImage.title'))

/** 图像加载占位提示 */
const processedPlaceholder = computed(() => {
  if (props.dataMode === 'processed') return t('vizworkbench.ionImage.computingTic')
  if (props.dataMode === null) return t('vizworkbench.ionImage.loadingResult')
  return t('vizworkbench.ionImage.loading')
})

// ---- 延迟 loading overlay：避免快速切换时一闪而过 ----

const LOADING_DELAY = 250 // ms，loading 持续超过此阈值才显示 overlay
let delayTimer: ReturnType<typeof setTimeout> | null = null
const showLoadingOverlay = ref(false)

watch(
  () => props.ionLoading,
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
  <!-- 移动端保留 360px 可用高度；桌面端在首屏剩余空间内与谱图按 5:2 分高。 -->
  <div
    data-testid="ion-image-section"
    :data-loading="ionLoading ? 'true' : 'false'"
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
        v-else-if="ionError && !ionMatrix"
        class="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center"
      >
        <p class="kawaru-text-112 font-semibold text-error">
          {{ $t('vizworkbench.ionImage.loadFailed') }}
        </p>
        <p class="kawaru-text-68 text-base-content/60 break-words">{{ ionError }}</p>
      </div>
      <div
        v-else-if="!ionMatrix"
        class="flex-1 flex items-center justify-center text-base-content/40 kawaru-text-95"
      >
        {{ processedPlaceholder }}
      </div>
      <div v-else class="flex-1 min-h-0 relative overflow-hidden">
        <IonImageViewer
          ref="ionViewerRef"
          :selected-mz="selectedMz"
          :mz-tolerance="mzTolerance"
          :colormap="colormap"
          :intensity-scale="intensityScale"
          :gamma="gamma"
          :display-min="displayMin"
          :display-max="displayMax"
          :matrix="displayMatrix"
          :matrix-cols="ionCols"
          :matrix-rows="ionRows"
          :draw-mode="!!roiTool"
          :overlay-data="overlayData"
          :overlay-width="ionCols"
          :overlay-height="ionRows"
          :data-mode="dataMode"
          :selected-pixel-coord="selectedPixelCoord"
          :normalization-loading="normalizationLoading"
          :normalization-error="normalizationError"
          :has-tic="hasTic"
          :image-title="imageTitle"
          :channels-mode="channelsMode"
          :channels="channels"
          :roi-mask="roiMask"
          :roi-highlight-data="roiHighlightData"
          @update:mz-tolerance="emit('update:mzTolerance', $event)"
          @update:colormap="emit('update:colormap', $event)"
          @update:intensity-scale="emit('update:intensityScale', $event)"
          @search-mz="emit('searchMz', $event)"
          @reset="emit('reset-controls')"
          @select-pixel="(col, row) => emit('select-pixel', col, row)"
        />
        <!-- 切换 m/z 时的加载遮罩（延迟出现，避免快速切换一闪而过）。
             多离子叠加模式下中列显示的是通道合成图，隐藏单图的加载遮罩。 -->
        <div
          v-if="showLoadingOverlay && ionMatrix && !channelsMode"
          class="absolute inset-0 flex items-center justify-center bg-base-100/80 backdrop-blur-[2px] z-10 transition-opacity duration-200"
        >
          <div class="flex flex-col items-center gap-3">
            <span class="loading loading-spinner loading-lg text-primary"></span>
            <span class="text-base-content/70 kawaru-text-95">{{
              $t('vizworkbench.ionImage.updating')
            }}</span>
          </div>
        </div>
        <ROIOverlay
          ref="roiOverlayRef"
          :tool="roiTool"
          :image-width="ionCols"
          :image-height="ionRows"
          :target-el="ionViewerRef?.canvasContainer ?? null"
          @draft-updated="emit('draft-updated', $event)"
          @draft-cleared="emit('draft-cleared')"
        />
        <div
          v-if="ionError"
          class="absolute left-3 right-3 top-3 z-30 rounded-lg border border-error/30 bg-error/10 px-3 py-2 kawaru-text-68 text-error shadow-sm backdrop-blur-sm"
        >
          {{ $t('vizworkbench.ionImage.updateFailed', { error: ionError }) }}
        </div>
      </div>
    </div>

    <!-- 强度条：多离子叠加模式下每通道各自归一化，此条不适用 → 置灰但保留 DOM -->
    <div
      class="shrink-0 flex flex-col items-center gap-2 w-[3em] kawaru-text-87"
      :class="{ 'opacity-40 pointer-events-none': channelsMode }"
      :title="channelsMode ? $t('vizworkbench.ionImage.rangeDisabled') : undefined"
    >
      <button
        class="text-base-content/40 hover:text-base-content w-[3em]"
        :title="$t('vizworkbench.ionImage.resetRange')"
        :disabled="channelsMode"
        @click="emit('reset-range')"
      >
        <SvgIcon type="refresh" />
      </button>
      <span class="range-label">{{ formatVal(displayMax) }}</span>
      <div
        :ref="(element) => emit('strip-ref', element as HTMLElement | null)"
        class="flex-1 w-[1.5em] rounded-sm border border-base-300 relative cursor-pointer bg-base-200"
        @mousedown.prevent="emit('strip-mouse-down', $event)"
      >
        <div class="absolute inset-0 rounded-sm" :style="{ background: gradientCss }"></div>
        <!-- 上下两个拖拽手柄结构一致，只是绑定的端点不同 -->
        <div
          v-for="handle in ['max', 'min'] as const"
          :key="handle"
          class="absolute left-0 right-0 h-3 cursor-ns-resize z-10 flex items-center justify-center"
          :style="{
            top: clampPct(calcHandleTop(handle === 'max' ? displayMax : displayMin)) + '%',
            transform: 'translateY(-50%)',
          }"
          @mousedown.prevent.stop="emit('start-strip-drag', handle, $event)"
        >
          <div class="w-full h-[3px] bg-base-100 rounded shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"></div>
        </div>
      </div>
      <span class="range-label">{{ formatVal(displayMin) }}</span>
    </div>
  </div>
</template>

<style scoped>
/* 强度条两端的数值标签：等宽字体让拖动手柄时数字不左右抖动，
   nowrap 避免 formatVal 输出科学计数法（如 1.2e+05）时被 3em 宽的列折行。 */
.range-label {
  font-family: var(--font-mono, ui-monospace, monospace);
  color: color-mix(in oklch, var(--color-base-content) 60%, transparent);
  line-height: 1;
  text-align: center;
  white-space: nowrap;
}
</style>

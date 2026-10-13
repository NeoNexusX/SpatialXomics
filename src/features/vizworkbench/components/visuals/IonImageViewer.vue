<template>
  <div class="flex flex-col h-full">
    <IonImageToolbar
      :selected-mz="selectedMz"
      :mz-tolerance="mzTolerance"
      :colormap="colormap"
      :intensity-scale="intensityScale"
      :data-mode="dataMode"
      :pixel-coord="selectedPixelCoord"
      :normalization-loading="normalizationLoading"
      :normalization-error="normalizationError"
      :has-tic="hasTic"
      :title="imageTitle"
      :channels-mode="channelsMode"
      @update:mz-tolerance="$emit('update:mzTolerance', $event)"
      @update:colormap="$emit('update:colormap', $event)"
      @update:intensity-scale="$emit('update:intensityScale', $event)"
      @search-mz="$emit('searchMz', $event)"
      @reset="$emit('reset')"
      @download="exportPng"
    />
    <div
      data-testid="ion-image-viewer"
      ref="containerRef"
      class="ion-image-viewport relative flex-1 min-h-0 bg-base-200 rounded-lg border border-base-300 overflow-hidden"
      :class="containerCursorClass"
      @mousedown="onContainerMouseDown"
      @click="onContainerClick"
      @mousemove="onHover"
      @mouseleave="hoverPixel = null"
    >
      <canvas
        ref="canvasRef"
        class="absolute inset-0"
        style="image-rendering: pixelated"
        :style="{
          transform: `translate(${panX}px,${panY}px) scale(${zoom})`,
          transformOrigin: '0 0',
          width: containerW + 'px',
          height: containerH + 'px',
        }"
        @wheel.prevent="onContainerWheel"
      />
      <!-- 悬停提示 -->
      <div
        v-if="hoverPixel"
        class="absolute pointer-events-none bg-base-100/90 backdrop-blur-sm px-2 py-1 rounded shadow border border-base-300 font-mono"
        :style="{ left: hoverPixel.x + 12 + 'px', top: hoverPixel.y + 12 + 'px' }"
      >
        <div>({{ hoverPixel.col + 1 }}, {{ hoverPixel.row + 1 }})</div>
        <!-- 多离子叠加：逐通道列出该像素的强度（色块即通道色） -->
        <template v-if="channelsMode && hoverPixel.channelValues?.length">
          <div
            v-for="cv in hoverPixel.channelValues"
            :key="cv.id"
            class="flex items-center gap-1.5"
          >
            <span
              class="w-2 h-2 rounded-sm shrink-0"
              :style="{ backgroundColor: `rgb(${cv.color.r},${cv.color.g},${cv.color.b})` }"
            ></span>
            <span class="text-base-content/60">{{ cv.mz.toFixed(6) }}</span>
            <span>{{ cv.intensity.toExponential(2) }}</span>
          </div>
        </template>
        <template v-else-if="dataMode === 'processed'">
          {{ hoverPixel.intensity.toExponential(2) }}
        </template>
        <template v-else> — {{ hoverPixel.intensity.toExponential(2) }} </template>
      </div>
      <!-- 缩放控件 -->
      <div
        class="zoom-controls absolute flex items-center bg-base-100/80 backdrop-blur-sm border border-base-300"
        @mousedown.stop
        @click.stop
      >
        <button
          type="button"
          class="zoom-control-button flex items-center justify-center hover:bg-base-300 text-base-content/70"
          :title="$t('vizworkbench.toolbar.zoomOut')"
          :aria-label="$t('vizworkbench.toolbar.zoomOut')"
          @click="zoomOut"
        >
          <SvgIcon type="minus" class="zoom-control-icon" />
        </button>
        <span class="w-[3.5em] leading-none font-mono text-center text-base-content/60">
          {{ zoom.toFixed(1) }}x
        </span>
        <button
          type="button"
          class="zoom-control-button flex items-center justify-center hover:bg-base-300 text-base-content/70"
          :title="$t('vizworkbench.toolbar.zoomIn')"
          :aria-label="$t('vizworkbench.toolbar.zoomIn')"
          @click="zoomIn"
        >
          <SvgIcon type="plus" class="zoom-control-icon" />
        </button>
        <button
          v-if="zoom > 1"
          type="button"
          class="zoom-control-button ms-[0.125em] flex items-center justify-center hover:bg-base-300 text-base-content/50"
          :title="$t('vizworkbench.toolbar.resetZoom')"
          :aria-label="$t('vizworkbench.toolbar.resetZoom')"
          @click="resetZoom"
        >
          1:1
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, type PropType } from 'vue'
import SvgIcon from '@/shared/components/SvgIcon.vue'
import IonImageToolbar from './IonImageToolbar.vue'
import { useZoomPan } from '../../composables/useZoomPan'
import { useCanvasRenderer } from '../../composables/useCanvasRenderer'
import { computeFitTransform, fitPointToMatrixCell } from '../../utils/fitTransform'
import { type BlendChannel } from '../../utils/ionChannelBlend'
import type { ViewIonChannel } from '../../composables/useIonChannels'
import type { DataMode } from '@/services/zarr/types/zarr'

const props = defineProps({
  selectedMz: { type: Number, required: true },
  mzTolerance: { type: Number, required: true },
  colormap: { type: String, required: true },
  intensityScale: { type: String, required: true },
  gamma: { type: Number, default: 1 },
  displayMin: { type: Number, default: undefined },
  displayMax: { type: Number, default: undefined },
  matrix: { type: Object as PropType<Float32Array | null>, default: null },
  matrixCols: { type: Number, default: 0 },
  matrixRows: { type: Number, default: 0 },
  drawMode: { type: Boolean, default: false },
  overlayData: { type: Object as PropType<Uint8ClampedArray | null>, default: null },
  overlayWidth: { type: Number, default: 0 },
  overlayHeight: { type: Number, default: 0 },
  /** 数据模式 */
  dataMode: { type: String as PropType<DataMode | null>, default: null },
  /** 当前选中像素坐标（processed 模式） */
  selectedPixelCoord: { type: Object as PropType<{ x: number; y: number } | null>, default: null },
  /** TIC 归一化计算中 */
  normalizationLoading: { type: Boolean, default: false },
  /** 归一化计算失败的原因 */
  normalizationError: { type: String as PropType<string | null>, default: null },
  /** zarr 是否预存 stats/tic（TIC 归一化可用） */
  hasTic: { type: Boolean, default: false },
  /** 图片区域标题 */
  imageTitle: { type: String, default: '' },
  /** 多离子叠加模式：为 true 时矩阵走通道合成渲染，colormap 等不适用 */
  channelsMode: { type: Boolean, default: false },
  /** 可见且已加载的叠加通道（渲染 + 悬停读数） */
  channels: { type: Array as PropType<ViewIonChannel[]>, default: () => [] },
  /** ROI 并集掩膜（1 = 保留），叠加模式下按此裁剪每个通道 */
  roiMask: { type: Object as PropType<Uint8Array | null>, default: null },
  /** 选中 ROI 的高亮层（RGBA，与离子图同尺寸）；独立于 overlayData，叠加在其上 */
  roiHighlightData: { type: Object as PropType<Uint8ClampedArray | null>, default: null },
})

const emit = defineEmits<{
  (e: 'update:mzTolerance', v: number): void
  (e: 'update:colormap', v: string): void
  (e: 'update:intensityScale', v: string): void
  (e: 'searchMz', v: string): void
  (e: 'reset'): void
  /** 点击像素（两种模式都加载该像素的谱） */
  (e: 'select-pixel', col: number, row: number): void
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const hoverPixel = ref<{
  x: number
  y: number
  row: number
  col: number
  intensity: number
  /** Per-channel readout while the multi-ion overlay is active. */
  channelValues?: {
    id: number
    mz: number
    color: { r: number; g: number; b: number }
    intensity: number
  }[]
} | null>(null)
const containerW = ref(0)
const containerH = ref(0)

// 区分拖拽和点击
let mouseDownPos = { x: 0, y: 0 }
let mouseMoved = false
let pendingMouseUp: ((ev: MouseEvent) => void) | null = null

// --- Composables ---
const { zoom, panX, panY, resetZoom, zoomIn, zoomOut, onWheel, onPanStart } = useZoomPan(
  () => containerW.value,
  () => containerH.value,
)

/** Channels as the renderer expects them (visible + loaded, color attached). */
const blendChannels = computed<BlendChannel[]>(() =>
  (props.channels ?? []).map((c) => ({
    matrix: c.matrix,
    color: c.color,
    opacity: c.opacity,
  })),
)
const channelsModeRef = computed(() => props.channelsMode)
const roiMaskRef = computed(() => props.roiMask)

const { scheduleRender, observeContainer, exportTransparentCanvas } = useCanvasRenderer({
  canvasRef,
  containerW,
  containerH,
  matrix: computed(() => props.matrix),
  matrixCols: computed(() => props.matrixCols),
  matrixRows: computed(() => props.matrixRows),
  colormap: computed(() => props.colormap),
  intensityScale: computed(() => props.intensityScale),
  gamma: computed(() => props.gamma),
  displayMin: computed(() => props.displayMin),
  displayMax: computed(() => props.displayMax),
  overlayData: computed(() => props.overlayData),
  overlayWidth: computed(() => props.overlayWidth),
  overlayHeight: computed(() => props.overlayHeight),
  channels: blendChannels,
  channelsMode: channelsModeRef,
  roiMask: roiMaskRef,
  roiHighlightData: computed(() => props.roiHighlightData),
})

/** 容器光标样式 */
const containerCursorClass = computed(() => {
  if (props.drawMode) return 'cursor-default'
  if (props.dataMode === 'processed') return 'cursor-crosshair'
  if (zoom.value > 1) return 'cursor-grab'
  return 'cursor-crosshair'
})

function onContainerWheel(e: WheelEvent) {
  if (props.drawMode) return
  onWheel(e, containerRef.value)
}

// --- 鼠标事件：拖拽 + 点击 ---

function onContainerMouseDown(e: MouseEvent) {
  mouseDownPos = { x: e.clientX, y: e.clientY }
  mouseMoved = false

  if (props.drawMode) return

  // 缩放 > 1 时支持拖拽平移
  if (zoom.value > 1 && e.button === 0) {
    onPanStart(e, containerRef.value)
    // 监听 mouseup 来判断是拖拽还是点击
    const onUp = (ev: MouseEvent) => {
      const dx = ev.clientX - mouseDownPos.x
      const dy = ev.clientY - mouseDownPos.y
      mouseMoved = Math.abs(dx) > 3 || Math.abs(dy) > 3
      document.removeEventListener('mouseup', onUp)
      pendingMouseUp = null
    }
    document.addEventListener('mouseup', onUp)
    pendingMouseUp = onUp
  }
}

// 在容器的 click 事件中处理像素选择
function onContainerClick(e: MouseEvent) {
  if (mouseMoved) return // 拖拽不触发点击
  if (props.drawMode) return
  // 不再限制 processed 模式：continuous 也可选像素（test 分支的像素选择增强）

  const container = containerRef.value
  if (!container) return
  const rect = container.getBoundingClientRect()
  const data = props.matrix
  const cols = props.matrixCols
  const rows = props.matrixRows
  if (!data || !data.length || !cols || !rows) return

  const W = rect.width,
    H = rect.height
  const t = computeFitTransform(W, H, cols, rows)

  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  const cx = (mx - panX.value) / zoom.value
  const cy = (my - panY.value) / zoom.value
  const { col, row } = fitPointToMatrixCell(cx, cy, t, cols, rows)

  if (row >= 0 && row < rows && col >= 0 && col < cols) {
    emit('select-pixel', col, row)
  }
}

// --- 悬停 ---

function onHover(e: MouseEvent) {
  const container = containerRef.value
  if (!container) return
  const rect = container.getBoundingClientRect()
  const data = props.matrix
  const cols = props.matrixCols
  const rows = props.matrixRows
  if (!cols || !rows) return
  if (!props.channelsMode && (!data || !data.length)) return
  const W = rect.width,
    H = rect.height
  const t = computeFitTransform(W, H, cols, rows)
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  const cx = (mx - panX.value) / zoom.value
  const cy = (my - panY.value) / zoom.value
  const { col, row } = fitPointToMatrixCell(cx, cy, t, cols, rows)
  if (row >= 0 && row < rows && col >= 0 && col < cols) {
    const i = row * cols + col
    const channelValues = props.channelsMode
      ? (props.channels ?? []).map((c) => ({
          id: c.id,
          mz: c.mz,
          color: c.color,
          intensity: c.matrix[i] ?? 0,
        }))
      : undefined
    hoverPixel.value = {
      x: mx,
      y: my,
      row,
      col,
      intensity: data?.[i] ?? 0,
      channelValues,
    }
  } else {
    hoverPixel.value = null
  }
}

// --- Lifecycle ---

onMounted(() => {
  if (containerRef.value) {
    observeContainer(containerRef.value)
    containerW.value = Math.floor(containerRef.value.getBoundingClientRect().width)
    containerH.value = Math.floor(containerRef.value.getBoundingClientRect().height)
    panX.value = (containerW.value * (1 - zoom.value)) / 2
    panY.value = (containerH.value * (1 - zoom.value)) / 2
  }
  scheduleRender()
})

// Remove any pending mouseup listener if the component unmounts mid-drag
onBeforeUnmount(() => {
  if (pendingMouseUp) document.removeEventListener('mouseup', pendingMouseUp)
})

watch(
  () => [
    props.colormap,
    props.intensityScale,
    props.gamma,
    props.matrix,
    props.displayMin,
    props.displayMax,
    props.overlayData,
    props.channels,
    props.channelsMode,
    props.roiMask,
    props.roiHighlightData,
  ],
  () => scheduleRender(),
)

/** Export the current view as a PNG download (transparent background). */
function exportPng() {
  const canvas = exportTransparentCanvas()
  if (!canvas) return
  const dataUrl = canvas.toDataURL('image/png')
  const link = document.createElement('a')
  // m/z at the same 6-decimal precision as the rest of the UI
  const label = props.channelsMode
    ? `_channels_${(props.channels ?? []).map((c) => c.mz.toFixed(6)).join('_')}`
    : props.dataMode === 'continuous'
      ? `_mz_${props.selectedMz.toFixed(6)}`
      : ''
  link.download = `ion_image${label}.png`
  link.href = dataUrl
  link.click()
}

defineExpose({ canvasContainer: containerRef })
</script>

<style scoped>
/* Query the image view itself, so the controls follow the middle column rather
   than the browser viewport. Inline-size containment is safe for this flex item. */
.ion-image-viewport {
  container-type: inline-size;
}

.zoom-controls {
  --zoom-control-size: clamp(1rem, calc(1.2rem + 1.25cqi), 2.625rem);

  inset-inline-end: clamp(0.5rem, 1cqi, 0.75rem);
  inset-block-end: clamp(0.5rem, 1cqi, 0.75rem);
  gap: clamp(0.25rem, 0.5cqi, 0.375rem);
  padding: clamp(0.25rem, 0.5cqi, 0.375rem) clamp(0.375rem, 0.75cqi, 0.625rem);
  border-radius: clamp(0.5rem, 1cqi, 0.75rem);
  font-size: clamp(0.875rem, calc(0.75rem + 0.35cqi), 1rem);
}

.zoom-control-button {
  flex: 0 0 auto;
  inline-size: var(--zoom-control-size);
  block-size: var(--zoom-control-size);
  border-radius: 0.35em;
  font-size: inherit;
}

/* Class selector (not a utility) so this reliably overrides SvgIcon's built-in
   w/h utilities regardless of the order Tailwind emits them in. */
.zoom-control-icon {
  inline-size: 1.25em;
  block-size: 1.25em;
}
</style>

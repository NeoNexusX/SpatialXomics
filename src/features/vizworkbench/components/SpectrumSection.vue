<script setup lang="ts">
import { computed } from 'vue'
import AverageSpectrum from '@/features/vizworkbench/components/visuals/AverageSpectrum.vue'
import {
  mzAxisRef,
  meanChartData,
  spectrumLoading,
  spectrumError,
  findClosestMzIndex,
  loadMeanSpectrum,
  isProfileSpectrum,
  pixelSpectrum,
  pixelSpectrumLoading,
  pixelSpectrumError,
  requestedPixelIndex,
  loadPixelSpectrum,
  spectrumView,
  setSpectrumView,
} from '@/features/vizworkbench/composables/useZarrIonImage'
import {
  buildSpectrumChartData,
  formatSpectrumIntensity,
} from '@/features/vizworkbench/utils/spectrumChartData'
import type { DataMode } from '@/services/zarr/types/zarr'
import { formatNumber } from '@/shared/utils/format'
import { t } from '@/i18n'

const props = defineProps<{
  isStale?: boolean
  selectedMz: number
  selectedMzIndex: number
  mzTolerance: number
  intensityRange?: string
  spectrumMode?: string
  /** 数据模式 */
  dataMode?: DataMode | null
}>()

const emit = defineEmits<{
  /** continuous 模式：谱图点击 → 更新离子图 */
  (e: 'select-mz-index', index: number): void
}>()

// ---- continuous 模式数据 ----

const totalPeaks = computed(() => (mzAxisRef.value ? formatNumber(mzAxisRef.value.length) : '--'))

function onSelectMz(mz: number) {
  const idx = findClosestMzIndex(mz)
  if (idx >= 0) emit('select-mz-index', idx)
}

async function onRetryMeanSpectrum() {
  await loadMeanSpectrum()
}

// ---- 像素谱：processed 只有像素谱；continuous 在平均谱 / 像素谱之间切换 ----

const isContinuous = computed(() => props.dataMode === 'continuous')

/** 当前是否显示像素谱 */
const showingPixel = computed(
  () => props.dataMode === 'processed' || (isContinuous.value && spectrumView.value === 'pixel'),
)

/**
 * 像素谱 chartData。processed 的逐像素谱只存实测点，一律过滤零值；
 * continuous 的像素谱是共享 m/z 轴上的稠密行，零值规则与平均谱一致（profile 保留）。
 */
const pixelChartData = computed<[number, number][]>(() => {
  const spec = pixelSpectrum.value
  if (!spec) return []
  return buildSpectrumChartData(spec.mz, spec.intensity, isContinuous.value && isProfileSpectrum())
})

/** 当前谱图数据（根据模式与视图选择） */
const currentChartData = computed(() =>
  showingPixel.value ? pixelChartData.value : meanChartData.value,
)

// 已有像素谱时再点像素只叠加更新遮罩（updating），不整体切到加载态：
// 图表不卸载重建，连续点击不闪烁，缩放窗口也得以保留
const currentLoading = computed(() =>
  showingPixel.value ? pixelSpectrumLoading.value && !pixelSpectrum.value : spectrumLoading.value,
)

const currentUpdating = computed(
  () => showingPixel.value && pixelSpectrumLoading.value && !!pixelSpectrum.value,
)

/** 当前错误状态 */
const currentError = computed(() =>
  showingPixel.value ? pixelSpectrumError.value : spectrumError.value,
)

/** continuous 像素谱首次加载的文案（其余情况用 AverageSpectrum 的默认文案） */
const loadingText = computed(() =>
  isContinuous.value && showingPixel.value ? t('vizworkbench.spectrum.loadingPixel') : undefined,
)

/** 像素谱已加载但没有可画的点（如 centroid 全零行）时的空态文案 */
const emptyText = computed(() =>
  showingPixel.value && pixelSpectrum.value ? t('vizworkbench.spectrum.pixelEmpty') : undefined,
)

/** 当前谱图重试 */
async function onRetry() {
  if (showingPixel.value) {
    const idx = requestedPixelIndex.value
    if (idx !== null) await loadPixelSpectrum(idx)
  } else {
    await onRetryMeanSpectrum()
  }
}

// ---- 底部统计信息 ----

const pixelIntensityRange = computed(() => {
  if (!pixelChartData.value.length) return '--'
  let min = Infinity
  let max = -Infinity
  for (const [, intensity] of pixelChartData.value) {
    min = Math.min(min, intensity)
    max = Math.max(max, intensity)
  }
  return `${formatSpectrumIntensity(min)} – ${formatSpectrumIntensity(max)}`
})

/** continuous 模式的底部统计 */
const continuousStats = computed<{ label: string; value: string }[]>(() => [
  {
    label: t('vizworkbench.spectrum.peaks'),
    value: showingPixel.value ? formatNumber(pixelChartData.value.length) : totalPeaks.value,
  },
  {
    label: t('vizworkbench.spectrum.intensity'),
    value: showingPixel.value ? pixelIntensityRange.value : (props.intensityRange ?? '--'),
  },
  { label: t('vizworkbench.spectrum.selected'), value: props.selectedMz.toFixed(6) },
  { label: t('vizworkbench.spectrum.tolerance'), value: `±${props.mzTolerance}` },
])

/** processed 模式的底部统计 */
const processedStats = computed<{ label: string; value: string }[]>(() => {
  const spec = pixelSpectrum.value
  return [
    { label: t('vizworkbench.spectrum.peaks'), value: formatNumber(pixelChartData.value.length) },
    {
      label: t('vizworkbench.spectrum.pixel'),
      value: spec ? `(${spec.x}, ${spec.y})` : '--',
    },
  ]
})

/** 当前统计信息 */
const currentStats = computed(() =>
  props.dataMode === 'processed' ? processedStats.value : continuousStats.value,
)
</script>

<template>
  <!-- 桌面端在首屏剩余空间内与离子图按 2:5 分高，并允许随视口收缩。 -->
  <div
    class="shrink-0 lg:h-auto lg:min-h-0 lg:flex-[2_1_0%] lg:shrink card bg-base-100 border-2 border-base-content/30 p-2"
  >
    <div
      v-if="isStale"
      class="flex-1 flex items-center justify-center text-base-content/40 kawaru-text-95"
    >
      {{ $t('vizworkbench.spectrum.noData') }}
    </div>
    <!-- processed 还没有像素谱时的引导 / 首次加载占位；加载失败交给下方的错误态（带重试） -->
    <div
      v-else-if="dataMode === 'processed' && !pixelSpectrum && !pixelSpectrumError"
      class="flex-1 flex items-center justify-center text-base-content/40 kawaru-text-95"
    >
      <template v-if="pixelSpectrumLoading">
        <span class="loading loading-spinner loading-lg text-primary mr-3"></span>
        <div class="text-center">
          <div>{{ $t('vizworkbench.spectrum.loading') }}</div>
          <div class="text-base-content/40 mt-1">
            {{ $t('vizworkbench.spectrum.firstLoadHint') }}
          </div>
        </div>
      </template>
      <template v-else>{{ $t('vizworkbench.spectrum.clickPixelHint') }}</template>
    </div>
    <AverageSpectrum
      v-else
      :chart-data="currentChartData"
      :selected-mz-index="selectedMzIndex"
      :selected-mz="selectedMz"
      :loading="currentLoading"
      :updating="currentUpdating"
      :loading-text="loadingText"
      :empty-text="emptyText"
      :error="currentError"
      :spectrum-mode="spectrumMode"
      :data-mode="dataMode"
      @select-mz="onSelectMz"
      @retry="onRetry"
    >
      <!-- continuous：平均谱 / 像素谱切换；像素谱在标题栏中间标注坐标 -->
      <template v-if="isContinuous" #header>
        <div class="join">
          <button
            type="button"
            class="btn btn-xs join-item kawaru-text-81"
            :class="spectrumView === 'mean' ? 'btn-primary' : 'btn-ghost'"
            :aria-pressed="spectrumView === 'mean'"
            @click="setSpectrumView('mean')"
          >
            {{ $t('vizworkbench.spectrum.viewMean') }}
          </button>
          <button
            type="button"
            class="btn btn-xs join-item kawaru-text-81"
            :class="spectrumView === 'pixel' ? 'btn-primary' : 'btn-ghost'"
            :aria-pressed="spectrumView === 'pixel'"
            :disabled="requestedPixelIndex === null"
            @click="setSpectrumView('pixel')"
          >
            {{ $t('vizworkbench.spectrum.viewPixel') }}
          </button>
        </div>
        <span
          v-if="spectrumView === 'pixel' && pixelSpectrum"
          data-testid="pixel-spectrum-coord"
          class="flex-1 text-center whitespace-nowrap"
        >
          <span class="text-base-content/50 pr-[0.25em]">{{
            $t('vizworkbench.spectrum.pixel')
          }}</span>
          <span class="font-mono font-semibold"
            >({{ pixelSpectrum.x }}, {{ pixelSpectrum.y }})</span
          >
        </span>
        <!-- 还没选过像素：提示可以点击图像查看像素谱 -->
        <span
          v-else-if="requestedPixelIndex === null"
          class="flex-1 text-center text-base-content/50"
        >
          {{ $t('vizworkbench.spectrum.selectPixelHint') }}
        </span>
      </template>
    </AverageSpectrum>
  </div>

  <!-- 底部统计信息 -->
  <div class="shrink-0 flex flex-wrap gap-4 kawaru-text-95 text-base-content/60 pl-4 pr-1">
    <span v-for="stat in currentStats" :key="stat.label">
      {{ $t('common.format.labelColon', { label: stat.label }) }}
      <strong class="text-base-content font-mono">{{ stat.value }}</strong>
    </span>
  </div>
</template>

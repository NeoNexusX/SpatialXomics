<template>
  <div
    class="flex flex-col select-none lg:h-full lg:overflow-y-auto scrollbar-thin overflow-x-hidden pr-4 lg:pr-[1em] kawaru-text-75"
  >
    <!-- ─── Info ─── -->
    <CollapsibleSection :title="$t('vizworkbench.info.info')">
      <div class="space-y-1.5 select-text text-base-content">
        <!-- 长值保持单行，超出部分截断，悬停查看完整内容。 -->
        <div v-for="row in infoRows" :key="row.label" class="flex min-w-0 gap-3 items-baseline">
          <span class="shrink-0 whitespace-nowrap kawaru-text-75">{{ row.label }}</span>
          <span
            class="min-w-0 flex-1 truncate text-right font-mono kawaru-text-56"
            :title="row.value"
            >{{ row.value }}</span
          >
        </div>
      </div>
    </CollapsibleSection>

    <!-- ─── Sample（只在源数据集记录里有，zarr 不带） ─── -->
    <CollapsibleSection
      v-if="sampleRows.length"
      :title="$t('datasets.overview.sampleInfo')"
      class="mt-5"
    >
      <div class="space-y-1.5 kawaru-text-68 text-base-content">
        <div v-for="row in sampleRows" :key="row.label" class="flex min-w-0 gap-3">
          <span class="shrink-0 whitespace-nowrap">{{ row.label }}</span>
          <span
            class="min-w-0 flex-1 truncate text-right font-mono text-base-content"
            :title="row.value"
            >{{ row.value }}</span
          >
        </div>
      </div>
    </CollapsibleSection>

    <!-- ─── Display Range ─── -->
    <CollapsibleSection :title="$t('vizworkbench.info.displayRange')" class="mt-5">
      <!-- 标签列宽度使用容器字号，避免与标签自身字号叠加缩放。 -->
      <div class="space-y-2">
        <div class="flex items-center gap-2">
          <div class="w-[2em] text-right">
            <span class="kawaru-text-68 text-base-content">{{ $t('vizworkbench.info.max') }}</span>
          </div>
          <input
            type="text"
            class="input input-sm input-bordered flex-1 kawaru-text-68 font-mono"
            :class="{ 'opacity-50': channelsMode }"
            :disabled="channelsMode"
            :title="channelsMode ? $t('vizworkbench.ionImage.rangeDisabled') : undefined"
            :value="formatValue(localMax)"
            @change="onMaxInput($event)"
          />
          <div class="w-[4em] text-right">
            <span class="kawaru-text-68 text-base-content font-bold">{{
              pctLabel(displayMax)
            }}</span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <div class="w-[2em] text-right">
            <span class="kawaru-text-68 text-base-content">{{ $t('vizworkbench.info.min') }}</span>
          </div>
          <input
            type="text"
            class="input input-sm input-bordered flex-1 kawaru-text-68 font-mono"
            :class="{ 'opacity-50': channelsMode }"
            :disabled="channelsMode"
            :title="channelsMode ? $t('vizworkbench.ionImage.rangeDisabled') : undefined"
            :value="formatValue(localMin)"
            @change="onMinInput($event)"
          />
          <div class="w-[4em] text-right">
            <span class="kawaru-text-68 text-base-content font-bold">{{
              pctLabel(displayMin)
            }}</span>
          </div>
        </div>
      </div>
    </CollapsibleSection>

    <!-- ─── Statistic ─── -->
    <CollapsibleSection :title="$t('vizworkbench.info.statistic')" class="mt-5">
      <div class="space-y-2 p-2">
        <div class="relative h-[5em] rounded border border-base-content/50 bg-base-200">
          <canvas ref="histCanvasRef" class="absolute inset-0 w-full h-full" />
          <div
            class="absolute top-0 bottom-0 w-[2px] bg-red-500/80 z-10"
            :style="{ left: markerLeft(displayMin) + '%' }"
          />
          <div
            class="absolute top-0 bottom-0 w-[2px] bg-red-500/80 z-10"
            :style="{ left: markerLeft(displayMax) + '%' }"
          />
        </div>
        <div class="space-y-1.5 kawaru-text-75 text-base-content">
          <div v-for="row in statisticRows" :key="row.label" class="flex justify-between">
            <span>{{ row.label }}</span>
            <span class="font-mono text-base-content">{{ row.value }}</span>
          </div>
        </div>
      </div>
    </CollapsibleSection>

    <!-- ─── Preprocessing ─── -->
    <CollapsibleSection
      v-if="methods.length"
      :title="$t('common.preprocessing.title')"
      class="mt-5"
    >
      <div class="space-y-1">
        <div
          v-for="m in methods"
          :key="m"
          :title="methodLabel(m)"
          class="kawaru-text-62 text-base-content flex items-center gap-1.5 min-w-0"
        >
          <span class="shrink-0 w-[0.25em] h-[0.25em] rounded-full bg-blue-400"></span>
          <span class="truncate">{{ methodLabel(m) }}</span>
        </div>
      </div>
    </CollapsibleSection>

    <slot name="actions" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch, type PropType } from 'vue'
import CollapsibleSection from '@/shared/components/CollapsibleSection.vue'
import { methodLabel } from '@/shared/utils/methodsNormalize'
import { vocabLabel } from '@/features/datasets/constants/vocabLabels'
import type { File } from '@/features/datasets/types/dataset'
import type { Acquisition } from '@/features/vizworkbench/types/acquisition'
import { t } from '@/i18n'

const props = defineProps({
  globalMin: { type: Number, required: true },
  globalMax: { type: Number, required: true },
  displayMin: { type: Number, required: true },
  displayMax: { type: Number, required: true },
  histogram: { type: Array as PropType<number[]>, default: () => [] },
  info: {
    type: Object as PropType<{
      pixels?: string
      nonZero?: string
      totalIon?: string
      pixelSize?: string
    }>,
    default: () => ({}),
  },
  /** 采集元数据（useResultMeta 合并 zarr attrs 与源文件记录） */
  acquisition: { type: Object as PropType<Acquisition | null>, default: null },
  /** 源数据集的完整文件记录：样本信息只在这里有 */
  sourceFile: { type: Object as PropType<File | null>, default: null },
  methods: { type: Array as PropType<string[]>, default: () => [] },
  sortedValues: { type: Array as PropType<number[]>, default: () => [] },
  /** 多离子叠加激活：Display Range 不参与叠加渲染，输入框置灰（与工具栏 Colormap 同一语义） */
  channelsMode: { type: Boolean, default: false },
})

const emit = defineEmits<{
  (e: 'update:displayMin', v: number): void
  (e: 'update:displayMax', v: number): void
}>()

const localMin = computed(() => props.displayMin)
const localMax = computed(() => props.displayMax)
const range = computed(() => props.globalMax - props.globalMin || 1)
function markerLeft(v: number) {
  return Math.max(0, Math.min(100, ((v - props.globalMin) / range.value) * 100))
}

function pctLabel(v: number): string {
  const arr = props.sortedValues
  if (!arr.length) return '0.00%'
  let lo = 0,
    hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (arr[mid]! <= v) lo = mid + 1
    else hi = mid
  }
  let pct = (lo / arr.length) * 100
  if (lo < arr.length) pct = Math.min(pct, 99.99)
  return pct.toFixed(2) + '%'
}

const statisticRows = computed(() => {
  const items: { label: string; value: string }[] = []
  if (props.info.pixels)
    items.push({ label: t('vizworkbench.info.dimensions'), value: props.info.pixels })
  if (props.info.nonZero)
    items.push({ label: t('vizworkbench.info.nonZero'), value: props.info.nonZero })
  if (props.info.totalIon) items.push({ label: 'TIC', value: props.info.totalIon })
  return items
})

const infoRows = computed(() => {
  const items: { label: string; value: string }[] = []
  const a = props.acquisition
  // zarr 属性里的极性可能是小写（positive），词表按首字母大写的原值查显示文字
  if (a?.polarity)
    items.push({ label: t('common.meta.polarity'), value: vocabLabel(capitalize(a.polarity)) })
  if (a?.analyzer) items.push({ label: t('common.meta.analyzer'), value: a.analyzer })
  if (a?.ionSource) items.push({ label: t('common.meta.ionisationSource'), value: a.ionSource })
  if (props.info.pixelSize)
    items.push({ label: t('common.meta.pixelSize'), value: props.info.pixelSize })
  const resolvingPower = formatResolvingPower(a?.resolvingPower, a?.resolvingPowerMz)
  if (resolvingPower) items.push({ label: t('common.meta.resolvingPower'), value: resolvingPower })
  // 基质名、溶剂表达式按 vocabLabel 的规则原样显示，涂布方式显示「中文 (English)」
  if (a?.maldiMatrix)
    items.push({ label: t('datasets.field.matrix'), value: vocabLabel(a.maldiMatrix) })
  if (a?.maldiMatrixApplication)
    items.push({
      label: t('datasets.field.matrixApplication'),
      value: vocabLabel(a.maldiMatrixApplication),
    })
  if (a?.solvent) items.push({ label: t('common.meta.solvent'), value: a.solvent })
  // 谱图 / 存储模式的取值是专业术语，原样显示
  if (a?.spectrumMode) items.push({ label: t('common.meta.spectrumMode'), value: a.spectrumMode })
  if (a?.storageMode) items.push({ label: t('common.meta.storageMode'), value: a.storageMode })
  return items
})

/** 与数据集详情页的「生物与样本信息」同一组字段、同一顺序；空值不显示 */
const sampleRows = computed(() => {
  const file = props.sourceFile
  if (!file) return []
  return [
    { label: t('common.meta.organism'), value: file.organism },
    { label: t('common.meta.organismPart'), value: file.organismPart },
    { label: t('common.meta.condition'), value: file.condition },
    { label: t('common.meta.growthConditions'), value: file.sampleGrowthConditions },
    { label: t('datasets.field.stabilization'), value: file.sampleStabilization },
    { label: t('common.meta.tissueModification'), value: file.tissueModification },
  ]
    .filter((row) => row.value)
    .map((row) => ({ label: row.label, value: vocabLabel(row.value) }))
})

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** 分辨率附带标定的 m/z（与数据集详情页同一文案）；没有 m/z 时只显示分辨率 */
function formatResolvingPower(rp: string | undefined, mz: string | undefined): string {
  if (!rp) return ''
  if (!mz) return rp
  return t('datasets.overview.resolvingPowerAt', { mzLabel: 'm/z', mz, rp })
}

function onMinInput(e: Event) {
  const v = parseFloat((e.target as HTMLInputElement).value)
  if (!isNaN(v)) emit('update:displayMin', v)
}
function onMaxInput(e: Event) {
  const v = parseFloat((e.target as HTMLInputElement).value)
  if (!isNaN(v)) emit('update:displayMax', v)
}

// Histogram
const histCanvasRef = ref<HTMLCanvasElement | null>(null)
function drawHistogram() {
  const canvas = histCanvasRef.value
  if (!canvas) return
  const bins = props.histogram
  if (!bins.length) return
  const rect = canvas.getBoundingClientRect()
  // Collapsed section: display:none reports a 0×0 box. Skip so the canvas
  // keeps its last good bitmap until the section is reopened (the observer
  // fires again with the real size).
  if (!rect.width || !rect.height) return
  const dpr = window.devicePixelRatio || 1
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const W = rect.width,
    H = rect.height
  ctx.clearRect(0, 0, W, H)
  const maxCount = Math.max(...bins, 1)
  const binW = W / bins.length
  ctx.fillStyle = '#9ca3af'
  for (let i = 0; i < bins.length; i++) {
    const h = (bins[i]! / maxCount) * H
    ctx.fillRect(i * binW, H - h, Math.max(1, binW - 1), h)
  }
}
let histRo: ResizeObserver | null = null
onMounted(() => {
  if (histCanvasRef.value) {
    histRo = new ResizeObserver(drawHistogram)
    histRo.observe(histCanvasRef.value)
  }
})
onBeforeUnmount(() => histRo?.disconnect())
watch(() => props.histogram, drawHistogram, { deep: true })

function formatValue(v: number): string {
  if (v === 0) return '0'
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'e6'
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'e3'
  if (Math.abs(v) < 0.01) return v.toExponential(1)
  return v.toFixed(2)
}
</script>

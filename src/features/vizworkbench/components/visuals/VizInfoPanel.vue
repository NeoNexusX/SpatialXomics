<template>
  <div class="flex flex-col select-none kawaru-text-75">
    <!-- Info：仪器信息 / 生物与样本信息 / 预处理 -->
    <CollapsibleSection
      v-if="rowGroups.length || meta.methods.length"
      :title="$t('vizworkbench.info.info')"
    >
      <div class="divide-y divide-base-content/10 select-text text-base-content">
        <section v-for="group in rowGroups" :key="group.key" class="py-3 first:pt-1 last:pb-0">
          <h3 :class="SUBHEAD_CLASS">{{ group.title }}</h3>
          <!-- 长值保持单行，超出部分截断，悬停查看完整内容。 -->
          <dl class="space-y-1.5">
            <div
              v-for="row in group.rows"
              :key="row.label"
              class="flex min-w-0 gap-3 items-baseline"
            >
              <dt class="shrink-0 whitespace-nowrap kawaru-text-68">{{ row.label }}</dt>
              <dd
                class="min-w-0 flex-1 truncate text-right font-mono kawaru-text-62"
                :title="row.value"
              >
                {{ row.value }}
              </dd>
            </div>
          </dl>
        </section>
        <section v-if="meta.methods.length" class="py-3 first:pt-1 last:pb-0">
          <h3 :class="SUBHEAD_CLASS">{{ $t('common.preprocessing.title') }}</h3>
          <ul class="space-y-1">
            <li
              v-for="m in meta.methods"
              :key="m"
              :title="methodLabel(m)"
              class="kawaru-text-62 flex items-center gap-1.5 min-w-0"
            >
              <span class="shrink-0 w-[0.25em] h-[0.25em] rounded-full bg-blue-400"></span>
              <span class="truncate">{{ methodLabel(m) }}</span>
            </li>
          </ul>
        </section>
      </div>
    </CollapsibleSection>

    <!-- ─── 强度：直方图、显示上下限与 Gamma 都在调「强度 → 颜色」的映射，
         多离子叠加时一起置灰（同一句提示） ─── -->
    <CollapsibleSection :title="$t('vizworkbench.info.intensity')" class="mt-5">
      <div class="space-y-3 text-base-content">
        <div>
          <div class="relative h-[5em] rounded border border-base-content/50 bg-base-200">
            <canvas ref="histCanvasRef" class="absolute inset-0 w-full h-full" />
            <div
              class="absolute top-0 bottom-0 w-[2px] bg-red-500/80 z-10"
              :style="{ left: markerLeft(display.displayMin) + '%' }"
            />
            <div
              class="absolute top-0 bottom-0 w-[2px] bg-red-500/80 z-10"
              :style="{ left: markerLeft(display.displayMax) + '%' }"
            />
          </div>
          <div
            v-if="statRows.length"
            class="mt-1 flex flex-wrap justify-between gap-x-3 kawaru-text-62 text-base-content/60"
          >
            <span v-for="row in statRows" :key="row.label"
              >{{ row.label }}
              <span class="font-mono text-base-content">{{ row.value }}</span></span
            >
          </div>
        </div>

        <!-- 标签列宽度使用容器字号，避免与标签自身字号叠加缩放。 -->
        <div class="space-y-2">
          <div class="flex items-center gap-2">
            <div class="w-[2em] text-right">
              <span class="kawaru-text-68">{{ $t('vizworkbench.info.max') }}</span>
            </div>
            <input
              type="text"
              class="input input-sm input-bordered flex-1 kawaru-text-68 font-mono"
              :class="{ 'opacity-50': channelsMode }"
              :disabled="channelsMode"
              :title="channelsMode ? $t('vizworkbench.ionImage.rangeDisabled') : undefined"
              :value="formatValue(display.displayMax)"
              @change="onMaxInput($event)"
            />
            <div class="w-[4em] text-right">
              <span class="kawaru-text-68 font-bold">{{ pctLabel(display.displayMax) }}</span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-[2em] text-right">
              <span class="kawaru-text-68">{{ $t('vizworkbench.info.min') }}</span>
            </div>
            <input
              type="text"
              class="input input-sm input-bordered flex-1 kawaru-text-68 font-mono"
              :class="{ 'opacity-50': channelsMode }"
              :disabled="channelsMode"
              :title="channelsMode ? $t('vizworkbench.ionImage.rangeDisabled') : undefined"
              :value="formatValue(display.displayMin)"
              @change="onMinInput($event)"
            />
            <div class="w-[4em] text-right">
              <span class="kawaru-text-68 font-bold">{{ pctLabel(display.displayMin) }}</span>
            </div>
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between mb-1 kawaru-text-68">
            <div class="flex items-center gap-1">
              <label :for="gammaId">{{ $t('vizworkbench.overlay.gamma') }}</label>
              <SectionHelp :label="$t('vizworkbench.overlay.gamma')">
                {{ $t('vizworkbench.overlay.gammaHint') }}
              </SectionHelp>
            </div>
            <span class="font-mono">{{ display.gamma.toFixed(1) }}</span>
          </div>
          <input
            :id="gammaId"
            type="range"
            class="range range-xs range-primary"
            :class="{ 'opacity-50': channelsMode }"
            :disabled="channelsMode"
            :title="channelsMode ? $t('vizworkbench.ionImage.rangeDisabled') : undefined"
            min="0.5"
            max="1.5"
            step="0.1"
            :value="display.gamma"
            @input="display.setGamma(+($event.target as HTMLInputElement).value)"
          />
          <div class="flex justify-between mt-0.5 kawaru-text-62 text-base-content/60">
            <span>0.5</span>
            <span>1.0</span>
            <span>1.5</span>
          </div>
        </div>
      </div>
    </CollapsibleSection>

    <slot name="actions" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, useId, watch } from 'vue'
import CollapsibleSection from '@/shared/components/CollapsibleSection.vue'
import SectionHelp from '@/features/vizworkbench/components/SectionHelp.vue'
import { upperBound } from '@/shared/utils/bisect'
import { methodLabel } from '@/shared/utils/methodsNormalize'
import { vocabLabel } from '@/features/datasets/constants/vocabLabels'
import type { IonImageDisplay } from '@/features/vizworkbench/composables/useIonImageDisplay'
import type { ResultMeta } from '@/features/vizworkbench/composables/useResultMeta'
import { t } from '@/i18n'

const props = defineProps<{
  /** Display range, histogram and gamma of the ion image. */
  display: IonImageDisplay
  /** 采集元数据（合并 zarr attrs 与源文件记录）、源文件记录与预处理方法 */
  meta: ResultMeta
  /** 多离子叠加激活：显示上下限与 Gamma 不参与叠加渲染，置灰（与工具栏 Colormap 同一语义） */
  channelsMode?: boolean
}>()

/** 「信息」里各子项的小标题 */
const SUBHEAD_CLASS = 'mb-1.5 kawaru-text-75 font-semibold text-base-content/70'
const gammaId = useId()

/** Image dimensions and statistics, with the pixel size of the dataset. */
const info = computed(() => ({ ...props.display.imageInfo, pixelSize: props.meta.pixelSize }))
const range = computed(() => props.display.globalMax - props.display.globalMin || 1)
function markerLeft(v: number) {
  return Math.max(0, Math.min(100, ((v - props.display.globalMin) / range.value) * 100))
}

function pctLabel(v: number): string {
  const arr = props.display.sortedNonZero
  if (!arr.length) return '0.00%'
  const rank = upperBound(arr, v)
  let pct = (rank / arr.length) * 100
  if (rank < arr.length) pct = Math.min(pct, 99.99)
  return pct.toFixed(2) + '%'
}

/** 直方图下方的一行：当前离子图的非零像素数与 TIC */
const statRows = computed(() => {
  const items: { label: string; value: string }[] = []
  if (info.value.nonZero)
    items.push({ label: t('vizworkbench.info.nonZero'), value: info.value.nonZero })
  if (info.value.totalIon) items.push({ label: 'TIC', value: info.value.totalIon })
  return items
})

const acquisitionRows = computed(() => {
  const items: { label: string; value: string }[] = []
  const a = props.meta.acquisition
  // zarr 属性里的极性可能是小写（positive），词表按首字母大写的原值查显示文字
  if (a?.polarity)
    items.push({ label: t('common.meta.polarity'), value: vocabLabel(capitalize(a.polarity)) })
  if (a?.analyzer) items.push({ label: t('common.meta.analyzer'), value: a.analyzer })
  if (a?.ionSource) items.push({ label: t('common.meta.ionisationSource'), value: a.ionSource })
  if (info.value.pixelSize)
    items.push({ label: t('common.meta.pixelSize'), value: info.value.pixelSize })
  if (info.value.pixels)
    items.push({ label: t('vizworkbench.info.dimensions'), value: info.value.pixels })
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
  const file = props.meta.sourceFile
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

/** 「信息」里的键值子项；空的子项不显示（样本信息只在源数据集记录里有，zarr 不带） */
const rowGroups = computed(() =>
  [
    {
      key: 'acquisition',
      title: t('vizworkbench.info.instrumentInfo'),
      rows: acquisitionRows.value,
    },
    { key: 'sample', title: t('datasets.overview.sampleInfo'), rows: sampleRows.value },
  ].filter((group) => group.rows.length),
)

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
  if (!isNaN(v)) props.display.setDisplayMin(v)
}
function onMaxInput(e: Event) {
  const v = parseFloat((e.target as HTMLInputElement).value)
  if (!isNaN(v)) props.display.setDisplayMax(v)
}

// Histogram
const histCanvasRef = ref<HTMLCanvasElement | null>(null)
function drawHistogram() {
  const canvas = histCanvasRef.value
  if (!canvas) return
  const bins = props.display.intensityHistogram
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
watch(() => props.display.intensityHistogram, drawHistogram)

function formatValue(v: number): string {
  if (v === 0) return '0'
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'e6'
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'e3'
  if (Math.abs(v) < 0.01) return v.toExponential(1)
  return v.toFixed(2)
}
</script>

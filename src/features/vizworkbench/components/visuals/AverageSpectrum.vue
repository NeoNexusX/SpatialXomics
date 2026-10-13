<template>
  <div class="flex h-[320px] flex-col lg:h-full">
    <!-- 标题区：header 插槽放附加控件（如 SpectrumSection 的平均谱 / 像素谱切换） -->
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
      <h3 class="kawaru-text-95 font-semibold">{{ title }}</h3>
      <slot name="header" />
      <div
        v-if="!loading && !error && showPeakCount"
        class="ml-auto text-base-content/50 font-mono"
      >
        {{ peakCountLabel }}
      </div>
    </div>

    <!-- 加载中 -->
    <div
      v-if="loading"
      class="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 bg-base-200 rounded-lg border border-base-content/30"
    >
      <span class="loading loading-spinner loading-lg text-primary"></span>
      <p class="kawaru-text-95 text-base-content/60">{{ resolvedLoadingText }}</p>
    </div>

    <!-- 错误 -->
    <div
      v-else-if="error"
      class="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 bg-base-200 rounded-lg border border-base-content/30"
    >
      <SvgIcon type="warning" class="w-8 h-8 text-error" />
      <p class="kawaru-text-95 text-error font-semibold">
        {{ $t('vizworkbench.spectrum.loadFailed') }}
      </p>
      <p class="kawaru-text-81 text-base-content/50 max-w-md text-center">{{ error }}</p>
      <button class="btn btn-sm btn-outline mt-2 kawaru-text-75" @click="$emit('retry')">
        {{ $t('common.action.retry') }}
      </button>
    </div>

    <!-- 空态：数据已加载但没有可画的点（如 centroid 全零的像素谱） -->
    <div
      v-else-if="emptyText && !chartData.length"
      class="flex-1 min-h-0 flex items-center justify-center bg-base-200 rounded-lg border border-base-content/30"
    >
      <p class="kawaru-text-95 text-base-content/60">{{ emptyText }}</p>
    </div>

    <!-- 谱图 -->
    <div v-else class="relative flex-1 min-h-0">
      <div
        data-testid="average-spectrum-chart"
        ref="chartContainerRef"
        class="absolute inset-0 bg-base-100 overflow-hidden"
      ></div>
      <!-- 更新遮罩：新数据到达前保留旧谱。变为可见时延迟淡入（缓存命中时新谱通常先到，
           遮罩根本不出现），隐藏时不延迟；pointer-events-none 不挡谱图交互 -->
      <div
        aria-hidden="true"
        class="absolute inset-0 flex items-center justify-center bg-base-100/60 pointer-events-none transition-opacity duration-150"
        :class="updating ? 'opacity-100 delay-200' : 'opacity-0'"
      >
        <span v-if="updating" class="loading loading-spinner loading-md text-primary"></span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import SvgIcon from '@/shared/components/SvgIcon.vue'
import * as echarts from 'echarts/core'
import { LineChart, BarChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  GraphicComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { DataMode } from '@/services/zarr/types/zarr'
import { useTheme } from '@/shared/composables/useTheme'
import { formatNumber } from '@/shared/utils/format'
import { resolveSpectrumPalette } from '../../types/spectrumTheme'
import { findClosestDisplayedMz } from '../../utils/spectrumSelection'
import { i18n, t } from '@/i18n'

echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  GraphicComponent,
  CanvasRenderer,
])

type ChartPoint = [number, number]

const props = defineProps<{
  /** [mz, intensity] 数据对（按 mz 排序） */
  chartData: ChartPoint[]
  /** 全局 mz_axis 中当前选中峰的索引（仅 continuous 模式使用） */
  selectedMzIndex?: number
  /** 当前选中 m/z 值（用于绘制红色标记线） */
  selectedMz?: number
  loading: boolean
  error: string | null
  /** 'centroid' → 柱状图, 'profile' → 折线图 */
  spectrumMode?: string
  /** 数据模式 */
  dataMode?: DataMode | null
  /** 已有谱图时的更新态：保留当前图表并叠加遮罩，不整体切到加载态 */
  updating?: boolean
  /** 覆盖默认的加载文案 */
  loadingText?: string
  /** 数据为空时显示的文案；不传则保留空的图表区（如平均谱加载前） */
  emptyText?: string
}>()

const emit = defineEmits<{
  /** continuous 模式：点击谱图后选中最近的真实峰 */
  (e: 'select-mz', mz: number): void
  (e: 'retry'): void
}>()

const chartContainerRef = ref<HTMLDivElement | null>(null)

// ---- 底部垂直布局预算（px）----
// grid.bottom 取各项之和而非写死值，保证轴名/刻度不被 dataZoom 滑块遮挡
const CHART_LAYOUT = {
  /** 刻度数字带（ECharts 默认 12px 字号，渲染 ~9px） */
  axisLabelBand: 10,
  /** "m/z" 轴名字号，需与 xAxis.nameTextStyle.fontSize 一致 */
  axisNameFont: 18,
  /** 轴名空隙，需与 xAxis.nameGap 一致 */
  axisNameMargin: 16,
  /** 滑块厚度，需与 dataZoom slider.height 一致 */
  zoomHeight: 24,
  /** 滑块底距，需与 dataZoom slider.bottom 一致 */
  zoomBottom: 8,
  /** 红色选择线上方 m/z 标签字号，需与 buildSelectorGraphic 的 font 一致 */
  selectorLabelFont: 16,
  /** 标签底边与网格顶边的间隙，需与 buildSelectorGraphic 的 position 偏移一致 */
  selectorLabelGap: 2,
} as const

/**
 * grid.top：红色选择线的 m/z 标签画在网格顶边之上（textVerticalAlign: 'bottom'），
 * 顶边留白不够时标签上半截会被容器的 overflow-hidden 裁掉，所以按标签实际占高预留。
 */
const GRID_TOP = Math.ceil(CHART_LAYOUT.selectorLabelFont * 1.25) + CHART_LAYOUT.selectorLabelGap

/** grid.bottom：以上各项之和 */
const GRID_BOTTOM =
  CHART_LAYOUT.axisLabelBand +
  CHART_LAYOUT.axisNameFont +
  CHART_LAYOUT.axisNameMargin +
  CHART_LAYOUT.zoomHeight +
  CHART_LAYOUT.zoomBottom

/** 当前主题对应的整套图表配色（ECharts 不读 CSS 变量，需随主题重建 options） */
const { isDark } = useTheme()
const palette = computed(() => resolveSpectrumPalette(isDark.value ? 'dark' : 'light'))

/** 谱图标题 */
const title = computed(() => t('vizworkbench.spectrum.title'))

/** 加载中文本（调用方可经 loadingText 覆盖） */
const resolvedLoadingText = computed(
  () =>
    props.loadingText ??
    (props.dataMode === 'processed'
      ? t('vizworkbench.spectrum.loading')
      : t('vizworkbench.spectrum.loadingAverage')),
)

/** 是否显示峰数 */
const showPeakCount = computed(
  () =>
    props.dataMode !== 'processed' ||
    (props.dataMode === 'processed' && props.chartData.length > 0),
)

/** 峰数标签 */
const peakCountLabel = computed(() => {
  const count = props.chartData.length
  return t('vizworkbench.spectrum.peakCount', { count: formatNumber(count) })
})

// ---- ECharts 实例管理 ----

let chartInstance: echarts.ECharts | null = null
let resizeObserver: ResizeObserver | null = null
let selectorTimer = 0
let isUnmounted = false
let onDataZoom: (() => void) | null = null
let nativeClickHandler: ((e: MouseEvent) => void) | null = null
let nativeMouseDownHandler: ((e: MouseEvent) => void) | null = null
let nativeMouseDownX = 0

/**
 * 构建红色选择线的 graphic 配置。
 * 只在 continuous 模式下显示；processed 模式没有共享 m/z 轴，不显示。
 */
function buildSelectorGraphic(): unknown[] {
  // processed 模式没有共享 m/z 轴，不需要选择线
  if (!chartInstance || props.dataMode === 'processed') return []
  const idx = props.selectedMzIndex
  const mz = props.selectedMz
  if (idx == null || idx < 0 || mz == null) return []
  const x = chartInstance.convertToPixel({ xAxisIndex: 0 }, mz)
  const gridModel = (chartInstance as any).getModel().getComponent('grid', 0)
  const gridRect = gridModel?.coordinateSystem?.getRect?.()
  const topY = gridRect ? gridRect.y : 24
  const bottomY = gridRect ? gridRect.y + gridRect.height : 200
  const label = mz

  return [
    {
      id: 'mz-selector-line',
      type: 'line',
      z: 100,
      silent: true,
      shape: { x1: x, y1: topY, x2: x, y2: bottomY },
      style: { stroke: palette.value.selector, lineWidth: 1.5 },
    },
    {
      id: 'mz-selector-label',
      type: 'text',
      z: 100,
      silent: true,
      position: [x + 4, topY - CHART_LAYOUT.selectorLabelGap],
      style: {
        text: label,
        fill: palette.value.selector,
        font: `${CHART_LAYOUT.selectorLabelFont}px monospace`,
        textAlign: 'left',
        textVerticalAlign: 'bottom',
      },
    },
  ]
}

function updateSelector() {
  if (!chartInstance || isUnmounted || props.dataMode === 'processed') return
  chartInstance.setOption({ graphic: buildSelectorGraphic() as any })
}

/**
 * 选中 m/z 落在当前缩放窗口外时，保持窗口宽度平移过去（目标居中）。
 * 未缩放（全谱可见）或目标已在窗口内时不动作，避免打断用户正在进行的查看；
 * 注释行点击 / m/z 搜索 / 区域比较表的选择都汇聚到 selectedMzIndex，此处统一接管。
 */
function panZoomToSelection() {
  if (!chartInstance || props.dataMode === 'processed') return
  const mz = props.selectedMz
  const data = props.chartData
  if (mz == null || !data.length) return
  const zoom = readZoomWindow()
  if (!zoom) return // 未缩放：目标峰在全谱视图中本就可见
  if (mz >= zoom[0] && mz <= zoom[1]) return // 已在窗口内：只移红线
  const width = zoom[1] - zoom[0]
  const mzMin = data[0]![0]
  const mzMax = data[data.length - 1]![0]
  let start = mz - width / 2
  let end = mz + width / 2
  // 目标贴近谱边缘时整体平移钳位，尽量保住缩放宽度
  if (start < mzMin) {
    start = mzMin
    end = mzMin + width
  } else if (end > mzMax) {
    end = mzMax
    start = mzMax - width
  }
  // inside 与 slider 两个 dataZoom 绑定同一 xAxis，dispatch 一个另一个同步跟随；
  // 触发的 datazoom 事件会经 scheduleSelectorUpdate 重画红线
  chartInstance.dispatchAction({
    type: 'dataZoom',
    dataZoomIndex: 0,
    startValue: start,
    endValue: end,
  })
}

function scheduleSelectorUpdate() {
  if (selectorTimer || props.dataMode === 'processed') return
  selectorTimer = window.setTimeout(() => {
    selectorTimer = 0
    updateSelector()
  }, 0)
}

/**
 * 为 dataZoom 缩略图构建"保峰 + 位置对齐"的抽稀数据。
 *
 * 两个问题都源自 ECharts 缩略图的实现（SliderZoomView.js 的 _renderDataShadow）：
 * 1. 默认按固定步长等间隔抽稀原始 series（每隔 N 个点取 1 个），窄峰容易一个点
 *    都取不到而在缩略图里"消失"——所以按桶取每个桶里的峰值点代替原始点。
 * 2. 非 time 类型坐标轴下，缩略图每个点的横坐标是按"数组下标"均匀排开的
 *    （宽度 / 点数），完全不看该点真实的 m/z 值；主图则是按真实 m/z 值经坐标轴
 *    换算位置。当 chartData 里因过滤零值、centroid 峰间距本就不均匀等原因产生
 *    "空白区间"（该区间的点在数组里整个不存在，而不是值为 0）时，下标就不再和
 *    m/z 值成比例，缩略图形状会和主图错位。所以这里按真实 m/z 值等分桶（而不是
 *    按下标等分），每个桶固定只产出 1 个点（桶内最大值，空桶补一个强度为 0 的
 *    占位点），让输出数组里每个点的"下标顺序"精确对应等宽的真实 m/z 区间，
 *    ECharts 按下标均匀布点的假设才成立（残余误差 ≤ 一个桶的宽度）。
 *
 * 最终作为一个透明的专属 series 插到 series 数组最前面，让 ECharts 的
 * _prepareDataShadowInfo 选中它作为缩略图的数据来源（取匹配到的第一个 series）。
 */
function buildShadowData(data: ChartPoint[], targetWidth: number): ChartPoint[] {
  const bucketCount = Math.max(1, Math.floor(targetWidth))
  // 注意：即便原始点数少于 bucketCount 也不能跳过分桶直接返回原始数据——
  // centroid 峰间距本就不均匀，跳过分桶会让 ECharts 缩略图按"下标均匀"摆点
  // （而不是按真实 m/z），峰位置又会和主图对不上，桶数据这一步就白做了。
  const mzMin = data[0]![0]
  const mzMax = data[data.length - 1]![0]
  const span = mzMax - mzMin
  if (!(span > 0)) return data

  const result: ChartPoint[] = []
  let i = 0
  for (let b = 0; b < bucketCount; b++) {
    const bucketEnd = mzMin + ((b + 1) / bucketCount) * span
    const isLastBucket = b === bucketCount - 1
    let maxIdx = -1
    while (i < data.length && (isLastBucket ? data[i]![0] <= bucketEnd : data[i]![0] < bucketEnd)) {
      if (maxIdx === -1 || data[i]![1] > data[maxIdx]![1]) maxIdx = i
      i++
    }
    if (maxIdx === -1) {
      // 该 m/z 区间内没有数据点（例如强度为零被过滤掉的空白区），补一个基线点占位，
      // 保证后续桶的"下标顺序"依然正比于真实 m/z 位置
      const bucketStart = mzMin + (b / bucketCount) * span
      result.push([bucketStart, 0])
    } else {
      result.push(data[maxIdx]!)
    }
  }
  return result
}

type ZoomWindow = [start: number, end: number]

/** ECharts 未公开的 dataZoom 模型接口（与 buildSelectorGraphic 读 grid 模型同理） */
interface DataZoomModel {
  getPercentRange(): number[] | undefined
  getValueRange(): number[] | undefined
}

/**
 * 读取用户当前的 m/z 缩放窗口（null = 未缩放）。
 * 取自 dataZoom 模型的值窗口，与图表尺寸无关：图表容器被 v-if 暂时移除、
 * ResizeObserver 把实例缩到 0 尺寸之后，读到的仍是用户设定的窗口。
 */
function readZoomWindow(): ZoomWindow | null {
  if (!chartInstance) return null
  const chart = chartInstance as unknown as {
    getModel(): { getComponent(type: string, index: number): DataZoomModel | undefined } | undefined
  }
  const dataZoom = chart.getModel()?.getComponent('dataZoom', 0)
  const percent = dataZoom?.getPercentRange()
  const value = dataZoom?.getValueRange()
  if (!percent || !value) return null
  // 滑块拖回两端时百分比可能带浮点尾差
  if (percent[0]! <= 1e-6 && percent[1]! >= 100 - 1e-6) return null
  const [start, end] = value
  return Number.isFinite(start) && Number.isFinite(end) && end! > start! ? [start!, end!] : null
}

/** 把沿用的缩放窗口钳位到新数据的 m/z 范围；与新数据没有交集时回到全谱 */
function clampZoomWindow(zoom: ZoomWindow | null, data: ChartPoint[]): ZoomWindow | null {
  if (!zoom || !data.length) return null
  const start = Math.max(zoom[0], data[0]![0])
  const end = Math.min(zoom[1], data[data.length - 1]![0])
  return end > start ? [start, end] : null
}

/**
 * 构建完整 ECharts options。提取为独立函数，每次 render 都用
 * notMerge: true 传入，确保 dataZoom 缩略图与主图完全同步。
 * zoom 为沿用的 m/z 缩放窗口（null = 全谱）。
 */
function buildOptions(targetWidth: number, zoom: ZoomWindow | null): Record<string, unknown> {
  const isProfile = props.spectrumMode === 'profile'
  // 沿用的窗口按 m/z 值还原（startValue/endValue），否则显示全谱
  const zoomRange = zoom ? { startValue: zoom[0], endValue: zoom[1] } : { start: 0, end: 100 }
  const shadowData = buildShadowData(props.chartData, targetWidth)
  const colors = palette.value
  return {
    tooltip: {
      trigger: 'axis',
      formatter(params: unknown) {
        const items = params as Array<{ data: ChartPoint; dataIndex: number }>
        if (!items?.length) return ''
        const [mz, intensity] = items[0]!.data
        return `<div class="font-mono">
            <div><i>m/z</i>: <strong>${mz}</strong></div>
            <div>${t('vizworkbench.spectrum.intensity')}: <strong>${intensity}</strong></div>
          </div>`
      },
    },
    grid: { left: 54, right: 54, top: GRID_TOP, bottom: GRID_BOTTOM },
    xAxis: {
      type: 'value',
      name: 'm/z',
      scale: true,
      // 显式钉死 min/max 为数据真实范围：scale:true 默认会取"nice"整数刻度，
      // 往往比数据实际范围更宽，主图两侧就会留出空白；而 dataZoom 缩略图的阴影
      // 永远是按（抽稀后）数据自身的最小/最大值撑满整个滑块宽度渲染的，不认
      // 这个 nice 范围，于是两者边缘对不齐。钉死后主图也是从数据首尾点撑满，
      // 和缩略图口径一致。
      min: props.chartData[0]?.[0],
      max: props.chartData[props.chartData.length - 1]?.[0],
      nameLocation: 'center',
      nameGap: CHART_LAYOUT.axisNameMargin,
      axisLabel: { color: colors.axis.label },
      axisPointer: { label: { show: false } },
      nameTextStyle: {
        fontSize: CHART_LAYOUT.axisNameFont,
        color: colors.axis.nameText,
        fontFamily: '"Times New Roman", Times, serif',
        fontStyle: 'italic',
      },
      axisLine: { lineStyle: { color: colors.axis.line } },
      axisTick: { lineStyle: { color: colors.axis.line } },
      splitLine: { lineStyle: { color: colors.axis.splitLine, type: 'dashed' } },
    },
    yAxis: {
      type: 'value',
      name: t('vizworkbench.spectrum.intensity'),
      nameLocation: 'center',
      nameGap: 48,
      axisLabel: { color: colors.axis.label },
      nameTextStyle: { fontSize: 20, color: colors.axis.nameText },
      axisLine: { lineStyle: { color: colors.axis.line } },
      axisTick: { lineStyle: { color: colors.axis.line } },
      splitLine: { lineStyle: { color: colors.axis.splitLine, type: 'dashed' } },
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, ...zoomRange },
      {
        type: 'slider',
        xAxisIndex: 0,
        ...zoomRange,
        height: CHART_LAYOUT.zoomHeight,
        bottom: CHART_LAYOUT.zoomBottom,
        borderColor: colors.dataZoom.border,
        fillerColor: colors.dataZoom.filler,
        handleStyle: { color: colors.dataZoom.handle },
        textStyle: { fontSize: 16 },
      },
    ],
    series: [
      // 缩略图专用透明 series：放在数组最前面，供 dataZoom 滑块的 _prepareDataShadowInfo
      // 选中作为缩略图数据源，数据已用 buildShadowData 做过峰值保留抽稀。
      // tooltip.show: false 避免它混入 axis 触发的 tooltip。
      {
        id: 'spectrum-shadow-series',
        type: 'line',
        data: shadowData,
        showSymbol: false,
        silent: true,
        tooltip: { show: false },
        lineStyle: { opacity: 0 },
        areaStyle: { opacity: 0 },
        z: -100,
      },
      isProfile
        ? {
            id: 'spectrum-series',
            type: 'line',
            data: props.chartData,
            showSymbol: false,
            lineStyle: { color: colors.series.line, width: 2 },
            areaStyle: { color: colors.series.area },
          }
        : {
            id: 'spectrum-series',
            type: 'bar',
            data: props.chartData,
            barWidth: 3,
            barGap: '-100%',
            itemStyle: { color: colors.bar },
            large: true,
            // xAxis.min/max 钉死在首尾数据点上，柱子中心正好卡在网格边缘，
            // 默认裁剪会把最左/最右柱子露出网格外的那一半切掉；关掉裁剪即可
            // 完整显示，网格外侧还有 grid.left/right 的边距可以容纳这半根柱子。
            clip: false,
          },
    ],
    animation: false,
  }
}

function renderChart() {
  const container = chartContainerRef.value
  if (!container) {
    console.warn('[AverageSpectrum] No chart container')
    return
  }
  if (isUnmounted) return

  // onMounted、容器 ref 与数据的 watch 可能在同一帧先后触发：数据相同且已画在当前
  // 容器上则跳过。容器被 v-if 重建过（加载 / 错误 / 空态之后）时即使数据引用没变也要
  // 重画，否则新容器是空白
  if (
    lastData === props.chartData &&
    lastSpectrumMode === props.spectrumMode &&
    chartInstance?.getDom() === container
  )
    return
  lastData = props.chartData
  lastSpectrumMode = props.spectrumMode

  const isProcessed = props.dataMode === 'processed'

  cleanupChart()

  // 数据更换（平均谱 / 像素谱切换、连续点像素、主题切换）时沿用用户的缩放窗口。
  // 各条谱共用同一 m/z 轴，窗口按 m/z 值记录而非百分比：centroid 过滤零值后每条谱的
  // 首尾 m/z 不同，x 轴范围（见 buildOptions 的 min/max）随之变化，百分比会错位
  const zoom = clampZoomWindow(readZoomWindow(), props.chartData)

  // 彻底销毁重建，保证 dataZoom 缩略图和主图完全一致
  chartInstance?.dispose()
  chartInstance = echarts.init(container)
  chartInstance.setOption(buildOptions(container.clientWidth || 800, zoom), { notMerge: true })

  // 注册事件（仅 continuous 模式）

  if (!isProcessed) {
    const handleMouseDown = (e: MouseEvent) => {
      nativeMouseDownX = e.clientX
    }
    const handleClick = (e: MouseEvent) => {
      if (Math.abs(e.clientX - nativeMouseDownX) > 3) return
      if (!chartInstance || !chartContainerRef.value) return
      const rect = chartContainerRef.value.getBoundingClientRect()
      const px = e.clientX - rect.left

      const gridModel = (chartInstance as any).getModel().getComponent('grid', 0)
      const gridRect: { x: number; y: number; width: number; height: number } | undefined =
        gridModel?.coordinateSystem?.getRect?.()
      if (!gridRect) return
      if (px < gridRect.x || px > gridRect.x + gridRect.width) return

      // Let ECharts perform the inverse coordinate conversion so dataZoom,
      // value-axis transforms and the current grid geometry are all honoured.
      const targetMz = Number(chartInstance.convertFromPixel({ xAxisIndex: 0 }, px))
      const selectedMz = findClosestDisplayedMz(props.chartData, targetMz)
      if (selectedMz != null) emit('select-mz', selectedMz)
    }
    nativeMouseDownHandler = handleMouseDown
    nativeClickHandler = handleClick
    chartContainerRef.value!.addEventListener('mousedown', handleMouseDown, true)
    chartContainerRef.value!.addEventListener('click', handleClick, true)
  }

  // dataZoom 监听
  onDataZoom = () => scheduleSelectorUpdate()
  chartInstance.on('datazoom', onDataZoom)

  // 响应式调整
  resizeObserver = new ResizeObserver(() => {
    chartInstance?.resize()
    scheduleSelectorUpdate()
  })
  resizeObserver.observe(chartContainerRef.value!)

  // 仅 continuous 模式需要更新选择线
  if (!isProcessed) updateSelector()
}

// ===== 生命周期 =====

let lastData: ChartPoint[] | null = null
let lastSpectrumMode: string | undefined

function cleanupChart() {
  if (selectorTimer) {
    clearTimeout(selectorTimer)
    selectorTimer = 0
  }
  if (onDataZoom) {
    chartInstance?.off('datazoom', onDataZoom)
    onDataZoom = null
  }
  const container = chartContainerRef.value
  if (nativeMouseDownHandler && container)
    container.removeEventListener('mousedown', nativeMouseDownHandler, true)
  if (nativeClickHandler && container)
    container.removeEventListener('click', nativeClickHandler, true)
  nativeMouseDownHandler = null
  nativeClickHandler = null
  resizeObserver?.disconnect()
  resizeObserver = null
}

onMounted(() => {
  if (!props.loading && !props.error && props.chartData.length > 0) {
    renderChart()
  }
})

onBeforeUnmount(() => {
  isUnmounted = true
  cleanupChart()
  chartInstance?.dispose()
  chartInstance = null
})

// chartData 变化时重新渲染
watch(
  () => props.chartData,
  (data) => {
    if (data.length > 0 && !isUnmounted && !props.loading) {
      renderChart()
    }
  },
  { flush: 'post' },
)

// 图表容器（重新）挂载时渲染：加载 / 错误 / 空态结束后 v-if 会重建容器，
// 而数据引用可能没变，上面 chartData 的 watch 不会触发
watch(
  chartContainerRef,
  (el) => {
    if (el && props.chartData.length > 0 && !isUnmounted && !props.loading) {
      renderChart()
    }
  },
  { flush: 'post' },
)

// 选中 m/z 变化时移动红线；目标落在缩放窗口外时先把窗口平移过去
watch(
  () => props.selectedMzIndex,
  () => {
    if (!chartInstance) return
    panZoomToSelection()
    updateSelector()
  },
)

// spectrumMode 变化时重新渲染
watch(
  () => props.spectrumMode,
  () => {
    if (props.chartData.length > 0 && !isUnmounted && !props.loading) {
      renderChart()
    }
  },
)

// 主题或界面语言切换时强制重建：lastData 短路会跳过相同数据的渲染，需先置空；
// notMerge: true 的 setOption 会整体替换旧配色与轴名，无残留
watch([isDark, i18n.global.locale], () => {
  if (props.chartData.length > 0 && !isUnmounted && !props.loading) {
    lastData = null
    renderChart()
  }
})
</script>

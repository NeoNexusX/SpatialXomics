<script setup lang="ts">
/** Lazy ECharts surface. The card owns requests, controls and the accessible data table. */
import { useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { use, graphic, type ComposeOption } from 'echarts/core'
import { LineChart, type LineSeriesOption } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  type GridComponentOption,
  type TooltipComponentOption,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { useTheme } from '@/shared/composables/useTheme'
import { useHomeChart } from '../composables/useHomeChart'
import type { VisitsHistoryDay } from '../types/stats'

use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])
type ChartOption = ComposeOption<LineSeriesOption | GridComponentOption | TooltipComponentOption>
const props = defineProps<{ items: VisitsHistoryDay[] }>()
const el = useTemplateRef<HTMLElement>('chartElement')
const { isDark } = useTheme()
const { t, locale } = useI18n()

function buildOption() {
  const blue = isDark.value ? '#8bb6ff' : '#3976de'
  const label = isDark.value ? '#b0bdce' : '#677688'
  const compact = new Intl.NumberFormat(locale.value, {
    notation: 'compact',
    maximumFractionDigits: 1,
  })
  const numbers = new Intl.NumberFormat(locale.value)
  const option: ChartOption = {
    animationDuration: 500,
    animationDurationUpdate: 250,
    grid: { top: 10, right: 12, bottom: 24, left: 44 },
    tooltip: {
      trigger: 'axis',
      renderMode: 'richText',
      confine: true,
      backgroundColor: isDark.value ? '#263240' : '#ffffff',
      borderColor: isDark.value ? '#4a5b70' : '#dce3ec',
      padding: [10, 12],
      textStyle: { color: isDark.value ? '#edf2f8' : '#243246', fontSize: 12 },
      axisPointer: { type: 'line', lineStyle: { color: blue, opacity: 0.35 } },
      formatter: (params) => {
        const point = Array.isArray(params) ? params[0] : params
        const day = point ? props.items[point.dataIndex] : undefined
        if (!day) return ''
        const count = day.missing
          ? t('home.visitsHistory.missingValue')
          : t('home.visitsHistory.requestCount', { count: numbers.format(day.count) })
        return [`${day.date}  UTC`, count, day.is_partial ? t('home.visitsHistory.partial') : '']
          .filter(Boolean)
          .join('\n')
      },
    },
    xAxis: {
      type: 'category',
      data: props.items.map((day) => day.date),
      boundaryGap: false,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: label,
        fontSize: 11,
        hideOverlap: true,
        showMinLabel: true,
        showMaxLabel: true,
        interval: Math.max(0, Math.ceil(props.items.length / 5) - 1),
        formatter: (date: string) => date.slice(5).replace('-', '/'),
      },
    },
    yAxis: {
      type: 'value',
      min: 0,
      minInterval: 1,
      splitNumber: 3,
      axisLabel: {
        color: label,
        fontSize: 11,
        formatter: (value: number) => compact.format(value),
      },
      splitLine: {
        lineStyle: { color: isDark.value ? '#ffffff12' : '#263e5b12' },
      },
    },
    series: [
      {
        type: 'line',
        connectNulls: false,
        showSymbol: true,
        symbol: 'circle',
        symbolSize: props.items.length <= 7 ? 5 : 3,
        lineStyle: { color: blue, width: 2.5 },
        itemStyle: { color: blue },
        areaStyle: {
          color: new graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: isDark.value ? '#8bb6ff38' : '#3976de30' },
            { offset: 1, color: isDark.value ? '#8bb6ff00' : '#3976de00' },
          ]),
        },
        emphasis: { scale: 1.8 },
        data: props.items.map((day) => ({
          value: day.missing ? null : day.count,
          ...(day.is_partial && { symbol: 'emptyCircle', symbolSize: 7 }),
        })),
      },
    ],
  }
  return option
}

useHomeChart(el, [() => props.items], buildOption)
</script>

<template>
  <div ref="chartElement" class="h-full w-full" aria-hidden="true" />
</template>

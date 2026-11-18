<script setup lang="ts">
/**
 * Lazy ring surface. It draws no text: names, figures and accessible labels live in the
 * card's list. `active` links a hovered arc with its list row in both directions.
 */
import { onMounted, useTemplateRef, watch } from 'vue'
import { use, type ComposeOption } from 'echarts/core'
import { PieChart, type PieSeriesOption } from 'echarts/charts'
import { CanvasRenderer } from 'echarts/renderers'
import { useHomeChart } from '../composables/useHomeChart'
import type { DatasetCategoryItem } from '../types/stats'

use([PieChart, CanvasRenderer])
const props = defineProps<{ items: DatasetCategoryItem[]; colors: string[] }>()
const active = defineModel<number | null>('active', { default: null })
const el = useTemplateRef<HTMLElement>('chartElement')

function buildOption(): ComposeOption<PieSeriesOption> {
  return {
    animationDuration: 700,
    animationDurationUpdate: 300,
    color: props.colors,
    series: [
      {
        type: 'pie',
        radius: ['72%', '94%'],
        startAngle: 90,
        padAngle: 1.5,
        minAngle: 3,
        cursor: 'default',
        itemStyle: { borderRadius: 4 },
        label: { show: false },
        labelLine: { show: false },
        emphasis: { scale: true, scaleSize: 4, focus: 'self' },
        blur: { itemStyle: { opacity: 0.28 } },
        data: props.items.map((item) => ({ name: item.category, value: item.count })),
      },
    ],
  }
}

const chart = useHomeChart(el, [() => props.items, () => props.colors], buildOption)
onMounted(() => {
  chart()?.on('mouseover', (event) => {
    active.value = event.dataIndex
  })
  chart()?.on('mouseout', () => {
    active.value = null
  })
})
watch(active, (index) => {
  const instance = chart()
  if (!instance) return
  instance.dispatchAction({ type: 'downplay', seriesIndex: 0 })
  if (index !== null) {
    instance.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex: index })
  }
})
</script>

<template>
  <div ref="chartElement" class="h-full w-full" aria-hidden="true" />
</template>

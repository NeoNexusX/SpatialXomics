<template>
  <div
    class="stat-card rounded-lg border px-2 py-1.5"
    :class="{ 'border-dashed': dashed }"
    :style="{
      borderColor: cssWithAlpha(color, dashed ? 0.4 : 0.25),
      background: cssWithAlpha(color, 0.03),
    }"
  >
    <slot />
    <dl v-if="stats" class="stat-strip mt-1">
      <div v-for="cell in statCells(stats)" :key="cell.key" class="min-w-0">
        <dt class="truncate kawaru-text-62 text-base-content/50">{{ cell.label }}</dt>
        <dd class="truncate font-mono" :title="cell.value">{{ cell.value }}</dd>
      </div>
    </dl>
    <slot name="controls" />
  </div>
</template>

<script setup lang="ts">
import { cssWithAlpha } from '@/features/vizworkbench/utils/regionPalette'
import { t } from '@/i18n'

interface RegionStats {
  mean: number
  std: number
  min: number
  max: number
}

defineProps<{ color: string; stats: RegionStats | null; dashed?: boolean }>()

function fmt(v: number): string {
  if (v === 0) return '0'
  if (Math.abs(v) >= 1e3) return v.toExponential(1)
  if (Math.abs(v) < 0.01) return v.toExponential(2)
  return v.toFixed(2)
}

/** 卡片第二行的强度统计条：均值 / 标准差 / 最小 / 最大 */
function statCells(s: RegionStats) {
  return [
    { key: 'mean', label: t('vizworkbench.roi.mean'), value: fmt(s.mean) },
    { key: 'std', label: t('vizworkbench.roi.std'), value: fmt(s.std) },
    { key: 'min', label: t('vizworkbench.roi.min'), value: fmt(s.min) },
    { key: 'max', label: t('vizworkbench.roi.max'), value: fmt(s.max) },
  ]
}
</script>

<style scoped>
.stat-card {
  container-type: inline-size;
}

.stat-strip {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.25rem 0.5rem;
}

.stat-strip > :nth-child(odd) {
  text-align: left;
}

.stat-strip > :nth-child(even) {
  text-align: right;
}

/* Wider cards fit all four statistics on one row. */
@container (min-width: 18em) {
  .stat-strip {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0 0.25rem;
  }

  .stat-strip > :nth-child(n) {
    text-align: center;
  }

  .stat-strip > :first-child {
    text-align: left;
  }

  .stat-strip > :last-child {
    text-align: right;
  }
}

@container (max-width: 15em) {
  .stat-card :deep(.card-tag) {
    display: none;
  }
}
</style>

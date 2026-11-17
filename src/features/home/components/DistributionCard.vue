<script setup lang="ts">
import { computed, defineAsyncComponent, shallowRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChartVisibility } from '../composables/useChartVisibility'
import { useTheme } from '@/shared/composables/useTheme'
import { formatNumber } from '@/shared/utils/format'
import type { DatasetCategoryItem } from '../types/stats'
import { categoryColors, type CategoryPalette } from '../utils/categoryPalette'
import { foldTail } from '../utils/foldTail'
import StatCard from './StatCard.vue'

const CategoryDonutChart = defineAsyncComponent(() => import('./CategoryDonutChart.vue'))
const props = defineProps<{
  title: string
  total: number
  items: DatasetCategoryItem[]
  loading: boolean
  error: string | null
  isEmpty: boolean
  palette: CategoryPalette
  /** Names read "Common (Genus species)"; the binomial is set in italics. */
  scientificNames?: boolean
}>()
defineEmits<{ reload: [] }>()
const { t, locale } = useI18n()
const { isDark } = useTheme()

/** "Mouse (Mus musculus)" → "Mouse" plus a quieter qualifier. */
const QUALIFIED = /^(.+?)\s*\(([^()]+)\)$/
const rows = computed(() => foldTail(props.items, 6, t('home.stats.other')))
const colors = computed(() => categoryColors(rows.value, props.palette, isDark.value))
const legend = computed(() => {
  const percent = new Intl.NumberFormat(locale.value, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  return rows.value.map((row, index) => {
    const [, name = row.category, qualifier] = QUALIFIED.exec(row.category) ?? []
    return {
      key: `${row.category}-${index}`,
      label: row.category,
      name,
      qualifier,
      count: formatNumber(row.count),
      share: percent.format(row.count / props.total),
      color: colors.value[index],
    }
  })
})
// Hovering an arc or a row focuses the same category in both.
const active = shallowRef<number | null>(null)
const focused = computed(() => (active.value === null ? undefined : legend.value[active.value]))
const content = useTemplateRef<HTMLElement>('content')
const visible = useChartVisibility(content)
</script>

<template>
  <StatCard class="dist-card" :aria-label="title" :aria-busy="loading">
    <h3 class="kawaru-text-125 font-semibold">{{ title }}</h3>
    <div ref="content" class="dist-card__body">
      <div v-if="loading" class="dist-card__state kawaru-text-81" role="status">
        <span class="loading loading-spinner loading-sm" />{{ $t('common.state.loading') }}
      </div>
      <div v-else-if="error" class="dist-card__state kawaru-text-81" role="alert">
        <span>{{ error }}</span>
        <button type="button" class="btn btn-ghost btn-sm" @click="$emit('reload')">
          {{ $t('common.action.retry') }}
        </button>
      </div>
      <p v-else-if="isEmpty" class="dist-card__state kawaru-text-81">
        {{ $t('common.state.empty') }}
      </p>
      <template v-else>
        <div class="dist-card__ring" aria-hidden="true">
          <CategoryDonutChart
            v-if="visible"
            v-model:active="active"
            :items="rows"
            :colors="colors"
          />
          <p class="dist-card__center">
            <strong>{{ focused ? focused.share : formatNumber(total) }}</strong>
            <span>{{ focused ? focused.name : $t('home.stats.datasetUnit') }}</span>
          </p>
        </div>
        <ol
          class="dist-card__legend"
          :aria-label="$t('home.stats.datasetsTotal', { count: formatNumber(total) })"
          @pointerleave="active = null"
        >
          <li
            v-for="(row, index) in legend"
            :key="row.key"
            class="dist-card__row kawaru-text-75"
            :class="{ 'is-muted': active !== null && active !== index }"
            @pointerenter="active = index"
          >
            <span class="dist-card__key" aria-hidden="true">
              <span :style="{ backgroundColor: row.color }" />
            </span>
            <span class="dist-card__name" :title="row.label">
              <span class="dist-card__primary">{{ row.name }}</span>
              <span
                v-if="row.qualifier"
                class="dist-card__qualifier kawaru-text-68"
                :class="{ italic: scientificNames }"
                >{{ row.qualifier }}</span
              >
            </span>
            <span class="dist-card__count">{{ row.count }}</span>
            <span class="dist-card__share kawaru-text-68">{{ row.share }}</span>
          </li>
        </ol>
      </template>
    </div>
  </StatCard>
</template>

<style scoped>
.dist-card {
  height: 100%;
  min-height: var(--distribution-min-height, 24rem);
  /* Below the 28px strip that each earlier card leaves visible in the desktop stack. */
  padding-top: max(1.875rem, clamp(1.25rem, 2vw, 2rem));
  container-type: inline-size;
}
.dist-card__body {
  --dist-muted: color-mix(in oklab, var(--color-base-content) 58%, transparent);
  --dist-rule: color-mix(in oklab, var(--color-base-content) 9%, transparent);
  flex: 1;
  min-height: 0;
  /* Full-width cards (reduced motion, tablets) keep figures near their names. */
  max-width: 56rem;
  display: grid;
  grid-template-columns: minmax(0, 4fr) minmax(0, 6fr);
  align-content: start;
  align-items: center;
  gap: clamp(1.25rem, 6cqi, 3rem);
  padding-top: clamp(0.25rem, 2cqi, 1rem);
}
.dist-card__ring {
  position: relative;
  justify-self: center;
  width: min(100%, 16rem);
  aspect-ratio: 1;
  container-type: inline-size;
}
.dist-card__center {
  position: absolute;
  inset: 18%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  text-align: center;
  pointer-events: none;
}
.dist-card__center strong {
  font-size: 18cqi;
  font-weight: 500;
  line-height: 1;
  letter-spacing: -0.04em;
}
.dist-card__center span {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  font-size: max(0.75rem, 6.5cqi);
  line-height: 1.25;
  color: var(--dist-muted);
}
.dist-card__legend {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  column-gap: 0.75rem;
  min-width: 0;
}
.dist-card__row {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: subgrid;
  align-items: baseline;
  padding-block: clamp(0.4rem, 1.4cqi, 0.6rem);
  border-top: 1px solid var(--dist-rule);
  transition: opacity 0.2s ease;
}
.dist-card__row:first-child {
  border-top: 0;
}
.dist-card__row.is-muted {
  opacity: 0.38;
}
.dist-card__key {
  align-self: center;
  display: flex;
}
.dist-card__key > span {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 3px;
}
/* One line per row. The qualifier wraps onto a clipped second line when it does not fit,
   so it shows only whole; screen readers still read it and the title shows it on hover. */
.dist-card__name {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 0.45em;
  min-width: 0;
  height: 1lh;
  overflow: hidden;
}
.dist-card__primary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.dist-card__qualifier {
  white-space: nowrap;
  color: var(--dist-muted);
}
.dist-card__count,
.dist-card__share {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.dist-card__count {
  font-weight: 500;
}
.dist-card__share {
  color: var(--dist-muted);
}
.dist-card__body:has(> .dist-card__state) {
  align-content: stretch;
}
.dist-card__state {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  text-align: center;
  color: var(--dist-muted);
}
/* Ring above the list only where cards grow with their content; desktop stacks
   have a fixed height and keep the side-by-side layout at every width. */
@media (max-width: 1023px) {
  @container (max-width: 27rem) {
    .dist-card__body {
      grid-template-columns: minmax(0, 1fr);
    }
    .dist-card__ring {
      width: min(100%, 12rem);
    }
  }
}
@media (prefers-reduced-motion: reduce) {
  .dist-card__row {
    transition: none;
  }
}
</style>

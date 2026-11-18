<script setup lang="ts">
import { computed, defineAsyncComponent, useTemplateRef } from 'vue'
import { useChartVisibility } from '../composables/useChartVisibility'
import { formatNumber } from '@/shared/utils/format'
import { useVisitsHistory } from '../composables/useVisitsHistory'
import StatCard from './StatCard.vue'

const VisitsHistoryChart = defineAsyncComponent(() => import('./VisitsHistoryChart.vue'))
const { history, loading, error, reload } = useVisitsHistory()
const hasObservations = computed(() => history.value?.items.some((day) => !day.missing))
const partial = computed(() => history.value?.items.some((day) => day.is_partial))
const timezone = computed(() => history.value?.timezone ?? 'UTC')
const plot = useTemplateRef<HTMLElement>('plot')
const visible = useChartVisibility(plot)
</script>

<template>
  <StatCard class="visits-card" :aria-label="$t('home.visitsHistory.title')">
    <header class="visits-card__header">
      <h3>{{ $t('home.visitsHistory.title') }}</h3>
      <p class="visits-card__summary" aria-live="polite" :aria-busy="loading">
        <strong>{{ history && hasObservations ? formatNumber(history.range_total) : '—' }}</strong>
        <span :title="$t('home.visitsHistory.metricHelp')">{{
          $t('home.visitsHistory.recordedRequests')
        }}</span>
      </p>
    </header>

    <div ref="plot" class="visits-card__plot" :aria-busy="loading">
      <div v-if="loading" class="visits-card__state" role="status">
        <span class="loading loading-spinner loading-sm" />{{ $t('common.state.loading') }}
      </div>
      <div v-else-if="error" class="visits-card__state" role="alert">
        <span>{{
          error === 'unavailable'
            ? $t('home.visitsHistory.unavailable')
            : $t('home.visitsHistory.loadFailed')
        }}</span>
        <button type="button" class="btn btn-ghost btn-sm" @click="reload">
          {{ $t('common.action.retry') }}
        </button>
      </div>
      <template v-else-if="history">
        <VisitsHistoryChart v-if="visible" :items="history.items" />
        <p v-if="!hasObservations" class="visits-card__empty">
          {{ $t('home.visitsHistory.noObservations') }}
        </p>
      </template>
    </div>

    <footer class="visits-card__note">
      <span>{{ partial ? $t('home.visitsHistory.partial') + ' · ' + timezone : timezone }}</span>
    </footer>
    <table v-if="history" class="sr-only">
      <caption>
        {{
          $t('home.visitsHistory.metricHelp')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ $t('home.visitsHistory.date') }}</th>
          <th scope="col">{{ $t('home.visitsHistory.recordedRequests') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="day in history.items" :key="day.date">
          <th scope="row">{{ day.date }} {{ timezone }}</th>
          <td>
            {{ day.missing ? $t('home.visitsHistory.missingValue') : formatNumber(day.count) }}
            {{ day.is_partial ? $t('home.visitsHistory.partial') : '' }}
          </td>
        </tr>
      </tbody>
    </table>
  </StatCard>
</template>

<style scoped>
.visits-card {
  gap: 0.5rem;
  padding: clamp(0.875rem, 1.4vw, 1.25rem);
}
.visits-card__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
}
.visits-card__header h3 {
  flex: none;
  font-size: clamp(0.95rem, 1.2vw, 1.2rem);
  font-weight: 600;
}
.visits-card__summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 0.7rem;
  color: color-mix(in oklab, var(--color-base-content) 60%, transparent);
}
.visits-card__summary strong {
  font-size: clamp(1.25rem, 1.7vw, 1.8rem);
  line-height: 1.15;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--color-base-content);
}
.visits-card__plot {
  position: relative;
  height: clamp(7rem, 17vh, 11rem);
  min-height: 7rem;
}
.visits-card__state,
.visits-card__empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  color: color-mix(in oklab, var(--color-base-content) 65%, transparent);
}
.visits-card__empty {
  pointer-events: none;
}
.visits-card__note {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.25rem 0.75rem;
  font-size: 0.65rem;
  color: color-mix(in oklab, var(--color-base-content) 60%, transparent);
}
@media (min-width: 1024px) and (max-height: 900px) {
  .visits-card {
    padding: 0.75rem;
  }
  .visits-card__plot {
    height: 6.5rem;
    min-height: 6.5rem;
  }
}
@media (min-width: 1024px) and (min-height: 680px) and (prefers-reduced-motion: no-preference) {
  .visits-card {
    height: 100%;
  }
  .visits-card__plot {
    flex: 1;
    height: auto;
    min-height: 0;
  }
}
</style>

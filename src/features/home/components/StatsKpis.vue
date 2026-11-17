<script setup lang="ts">
/**
 * 四项总览共用一行，数据集卡保留入口；窄屏可横向浏览。
 * 总览和访问量来自两个独立接口，各自报错、各自重试。
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { t } from '@/i18n'
import CountUp from './CountUp.vue'
import { usePlatformOverview, useVisitsStats } from '../composables/useHomeStats'

const overview = usePlatformOverview()
const visits = useVisitsStats()

const cards = computed(() => [
  {
    key: 'datasets',
    label: t('home.stats.totalDatasets'),
    value: overview.stats.value?.total_files,
    loading: overview.loading.value,
  },
  {
    key: 'users',
    label: t('common.stat.totalUsers'),
    value: overview.stats.value?.total_users,
    loading: overview.loading.value,
  },
  {
    key: 'downloads',
    label: t('home.stats.totalDownloads'),
    value: overview.stats.value?.total_downloads,
    loading: overview.loading.value,
  },
  {
    key: 'visits',
    label: t('home.stats.websiteVisits'),
    value: visits.stats.value?.total,
    loading: visits.loading.value,
  },
])

const failures = computed(
  () =>
    [
      overview.error.value && { message: overview.error.value, reload: overview.reload },
      visits.error.value && { message: visits.error.value, reload: visits.reload },
    ].filter(Boolean) as { message: string; reload: () => void }[],
)
</script>

<template>
  <div>
    <ul class="kpi-grid" tabindex="0" :aria-label="$t('home.stats.title')">
      <li
        v-for="card in cards"
        :key="card.key"
        class="kpi-card"
        :class="{ 'kpi-card--accent': card.key === 'datasets' }"
      >
        <p class="kpi-label">
          {{ card.label }}
        </p>
        <p class="kpi-value" :aria-busy="card.loading ? 'true' : undefined">
          <CountUp v-if="card.value != null" :value="card.value" />
          <span v-else :class="{ 'animate-pulse': card.loading }">—</span>
        </p>
        <RouterLink
          v-if="card.key === 'datasets'"
          to="/datasets"
          class="kpi-link"
          :aria-label="$t('home.actions.datasets')"
          :title="$t('home.actions.datasets')"
        >
          <SvgIcon type="chevron_right" class="size-4" />
        </RouterLink>
      </li>
    </ul>

    <div
      v-for="failure in failures"
      :key="failure.message"
      role="alert"
      class="mt-3 flex items-center gap-3 rounded-2xl bg-base-100 px-5 py-3 kawaru-text-87 text-error"
    >
      <span class="flex-1">{{ failure.message }}</span>
      <button type="button" class="btn btn-ghost btn-xs kawaru-text-75" @click="failure.reload">
        {{ $t('common.action.retry') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.625rem;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  padding: 2px;
  margin: -2px;
}
.kpi-grid:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 3px;
  border-radius: 1.25rem;
}
.kpi-card {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 0.625rem;
  min-width: 0;
  padding: clamp(0.875rem, 1.2vw, 1.25rem);
  border-radius: 1.25rem;
  background: var(--home-panel);
}
.kpi-label {
  font-size: clamp(0.85rem, 1vw, 1rem);
  line-height: 1.35;
  opacity: 0.75;
}
.kpi-value {
  font-size: clamp(1.35rem, 1.8vw, 1.85rem);
  font-weight: 500;
  line-height: 1;
  letter-spacing: -0.04em;
  overflow-wrap: anywhere;
}
.kpi-card--accent {
  background: var(--color-primary);
  color: var(--color-primary-content);
}
.kpi-card--accent .kpi-label {
  padding-right: 0.75rem;
}
.kpi-link {
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: flex-end;
  align-items: flex-start;
  padding: clamp(0.875rem, 1.2vw, 1.25rem) 0.5rem;
  border-radius: inherit;
}
.kpi-link:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: -4px;
}
@media (min-width: 1024px) and (max-height: 900px) {
  .kpi-card {
    padding: 0.75rem;
  }
}
@media (max-width: 639px) {
  .kpi-grid {
    grid-template-columns: repeat(4, minmax(8rem, 1fr));
  }
}
</style>

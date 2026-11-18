<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { CalendarHeatmap } from 'vue3-calendar-heatmap'
import 'vue3-calendar-heatmap/dist/style.css'
import { useCommitHeatmap } from '../composables/useCommitHeatmap'
import StatCard from './StatCard.vue'
import type { GithubHeatmapConfig } from '../config/contentConfig'

/** The activity card owns its heatmap; fetching and caching stay in useCommitHeatmap. */
const props = defineProps<{ config: GithubHeatmapConfig }>()

// 业务逻辑（取数 / 缓存 / 限流 / 配色 / tooltip）全部在 composable 里，组件只负责展示
const {
  loading,
  error,
  values,
  total,
  activeDays,
  maxCount,
  rangeColor,
  endDate,
  tooltipFormatter,
  heatmapLocale,
  isDark,
} = useCommitHeatmap(() => ({
  owner: props.config.owner,
  repo: props.config.repo,
  branch: props.config.branch ?? 'dev',
  days: props.config.days ?? 365,
}))
</script>

<template>
  <StatCard id="activity" class="activity-card heatmap kawaru-text-75">
    <!-- Header：有 repoUrl 时渲染成可点击的外链 <a>，否则退化为纯 <div> -->
    <component
      :is="config.repoUrl ? 'a' : 'div'"
      :href="config.repoUrl || undefined"
      :target="config.repoUrl ? '_blank' : undefined"
      :rel="config.repoUrl ? 'noopener noreferrer' : undefined"
      class="group flex min-w-0 max-w-full items-center gap-[0.5em]"
      :class="{ 'w-fit': config.repoUrl }"
    >
      <Icon icon="simple-icons:github" class="h-[1.35em] w-[1.35em] text-primary shrink-0" />
      <h3
        class="truncate kawaru-text-95 font-semibold text-base-content transition-colors"
        :class="{ 'group-hover:text-primary': config.repoUrl }"
      >
        {{ $t('home.activity.title') }}
      </h3>
      <Icon
        v-if="config.repoUrl"
        icon="heroicons:arrow-top-right-on-square"
        class="h-[1em] w-[1em] text-base-content/40 group-hover:text-primary shrink-0 transition-colors"
      />
    </component>

    <div
      v-if="loading"
      class="flex items-center justify-center gap-[0.5em] text-base-content/40 py-[2.2em]"
    >
      <span class="loading loading-spinner h-[1.35em] w-[1.35em]" />
      <span class="kawaru-text-75">{{ $t('common.state.loading') }}</span>
    </div>

    <div
      v-else-if="error"
      role="alert"
      class="alert alert-error kawaru-text-75 gap-[0.5em] p-[0.9em]"
    >
      <Icon icon="heroicons:exclamation-triangle" class="h-[1.35em] w-[1.35em] shrink-0" />
      <span>{{ error }}</span>
    </div>

    <div v-else class="heatmap-layout">
      <div class="heatmap-frame" tabindex="0" :aria-label="$t('home.heatmap.summary')">
        <CalendarHeatmap
          :values="values"
          :end-date="endDate"
          :range-color="rangeColor"
          :max="maxCount"
          tooltip
          :tooltip-formatter="tooltipFormatter"
          :locale="heatmapLocale"
          :dark-mode="isDark"
          :round="2"
        />
      </div>

      <footer class="heatmap-summary kawaru-text-68" :aria-label="$t('home.heatmap.summary')">
        <div class="heatmap-metric">
          <span>{{ $t('home.heatmap.total') }}</span>
          <strong class="kawaru-text-75">{{ total }}</strong>
          <span>{{ $t('home.heatmap.commits') }}</span>
        </div>
        <div class="heatmap-metric">
          <span>{{ $t('home.heatmap.activeDays') }}</span>
          <strong class="kawaru-text-75">{{ activeDays }}</strong>
        </div>
      </footer>
    </div>
  </StatCard>
</template>

<style scoped>
.activity-card {
  padding: clamp(1rem, 1.6vw, 1.5rem);
}
@media (min-width: 1024px) and (max-height: 900px) {
  .activity-card {
    padding: 0.75rem;
  }
}
.heatmap {
  display: flex;
  flex-direction: column;
  gap: 1em;
  min-width: 0;
}
.heatmap-layout {
  display: flex;
  flex-direction: column;
  gap: 0.8em;
  min-width: 0;
}
.heatmap-frame {
  width: 100%;
  min-width: 0;
  /* Start at the recent end; the parent width determines how much of the continuous grid is visible. */
  direction: rtl;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  scrollbar-width: thin;
  padding-bottom: 0.25em;
}
.heatmap-frame:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 4px;
}
.heatmap-frame :deep(.vch__container) {
  direction: ltr;
  min-width: 42rem;
}
.heatmap-frame :deep(svg.vch__wrapper) {
  width: 100%;
  height: auto;
}
/* 复用库原生底部图例，缩小字号并贴合卡片配色。 */
.heatmap-frame :deep(.vch__container > .vch__legend) {
  margin-top: 0.4em;
  color: color-mix(in oklch, var(--color-base-content) 58%, transparent);
  /* 图例是库渲染的节点，挂不上档位类；字号直接按 50 档取值 */
  font-size: calc(var(--kawaru-fs) * 0.5);
}
/* 网格在小屏会横向溢出滚动；把图例钉在滚动视口右侧，避免要滚到最右才看得到。 */
.heatmap-frame :deep(.vch__legend .vch__legend-right) {
  position: sticky;
  right: 0;
}

.heatmap-summary {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.65em 1em;
  color: color-mix(in oklch, var(--color-base-content) 62%, transparent);
}
.heatmap-metric {
  display: flex;
  align-items: baseline;
  gap: 0.4em;
}
.heatmap-metric strong {
  color: var(--color-base-content);
  font-weight: 650;
}
@media (min-width: 1024px) and (min-height: 680px) and (prefers-reduced-motion: no-preference) {
  .activity-card {
    height: 100%;
  }
  .heatmap,
  .heatmap-layout,
  .heatmap-frame {
    flex: 1;
    min-height: 0;
  }
  .heatmap-frame :deep(.vch__container) {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .heatmap-frame :deep(svg.vch__wrapper) {
    /* Fit the complete seven-day grid without cropping the card's summary. */
    flex: 1;
    min-height: 0;
    height: 0;
  }
  .heatmap-frame :deep(.vch__legend),
  .heatmap-summary {
    flex-shrink: 0;
  }
}
</style>

<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import HomeSection from './HomeSection.vue'
import StatsKpis from './StatsKpis.vue'
import StatsCardStack from './StatsCardStack.vue'
import ActivityCard from './ActivityCard.vue'
import VisitsHistoryCard from './VisitsHistoryCard.vue'
import { getContent } from '../config/contentConfig'
import { vSplitReveal } from '../motion/directives'

const heatmap = getContent().githubHeatmap
const kpis = useTemplateRef<HTMLElement>('kpis')
const visits = useTemplateRef<HTMLElement>('visits')
const activity = useTemplateRef<HTMLElement>('activity')
const introElements = computed(() =>
  [kpis.value, visits.value, activity.value].filter((element): element is HTMLElement => !!element),
)
</script>

<template>
  <HomeSection id="stats" surface="stats" :intro-elements="introElements">
    <h2 :key="$t('home.stats.title')" v-split-reveal="{ by: 'chars' }" class="stats-title">
      {{ $t('home.stats.title') }}
    </h2>
    <div class="stats-layout">
      <div class="stats-overview">
        <div ref="kpis" class="stats-reveal"><StatsKpis /></div>
        <div ref="visits" class="stats-reveal stats-reveal--chart"><VisitsHistoryCard /></div>
        <div
          v-if="heatmap?.owner && heatmap.repo"
          ref="activity"
          class="stats-reveal stats-reveal--chart stats-reveal--activity"
        >
          <ActivityCard :config="heatmap" />
        </div>
      </div>
      <div class="stats-distribution">
        <StatsCardStack id="distribution" />
      </div>
    </div>
  </HomeSection>
</template>

<style scoped>
.stats-layout {
  display: grid;
  gap: 2rem;
  min-height: 0;
  flex: 1;
  width: 100%;
}
.stats-overview {
  display: flex;
  flex-direction: column;
  gap: clamp(0.625rem, 1.5vh, 1rem);
  min-width: 0;
  min-height: 0;
}
.stats-title {
  flex: none;
  margin-bottom: clamp(0.75rem, 2vh, 1.25rem);
  font-size: clamp(2rem, 3.2vw, 3rem);
  font-weight: 500;
  line-height: 1;
  letter-spacing: -0.045em;
}
.stats-reveal {
  min-width: 0;
}
.stats-distribution {
  min-width: 0;
  min-height: 0;
}
@media (min-width: 1024px) and (max-height: 900px) {
  .stats-overview {
    gap: 0.5rem;
  }
  .stats-title {
    font-size: 2rem;
    margin-bottom: 0.75rem;
  }
}
@media (min-width: 1024px) and (min-height: 680px) and (prefers-reduced-motion: no-preference) {
  .stats-layout {
    grid-template-columns: minmax(0, 1.08fr) minmax(0, 0.92fr);
    grid-template-rows: minmax(0, 1fr);
    gap: clamp(1.5rem, 3vw, 3rem);
    align-items: start;
  }
  .stats-distribution {
    width: 100%;
  }
  .stats-overview {
    height: 100%;
  }
  .stats-reveal--chart {
    /* Share the actual space below the KPIs, including the navbar deduction. */
    flex: 1;
    min-height: 0;
  }
  .stats-reveal--activity {
    /* The heatmap also needs room for its month labels, legend and summary. */
    flex-basis: 4rem;
  }
}
</style>

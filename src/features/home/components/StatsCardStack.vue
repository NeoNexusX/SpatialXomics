<script setup lang="ts">
import { inject, useTemplateRef } from 'vue'
import DistributionCard from './DistributionCard.vue'
import { useCardStack } from '../motion/useCardStack'
import { homeSectionKey } from '../motion/homeSectionContext'

// The stack owns ordering and geometry; each distribution owns its request and retry.
const categories = ['organism', 'tissue', 'ion-source', 'analyzer'] as const
const { active, enhanced } = useCardStack(
  useTemplateRef<HTMLElement>('root'),
  () => categories,
  inject(homeSectionKey, undefined),
)
</script>

<template>
  <div
    ref="root"
    class="card-stack"
    role="region"
    :aria-label="$t('home.stats.distribution')"
    :tabindex="enhanced ? 0 : undefined"
  >
    <ol class="card-stack__viewport" data-stack-viewport>
      <li
        v-for="(category, index) in categories"
        :key="category"
        data-stack-card
        class="card-stack__card"
        :inert="enhanced && index !== active"
      >
        <DistributionCard :category="category" />
      </li>
    </ol>
  </div>
</template>

<style scoped>
.card-stack {
  min-width: 0;
  min-height: 0;
}
.card-stack:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 6px;
  border-radius: 2rem;
}
.card-stack__viewport {
  display: grid;
  gap: 1rem;
}
.card-stack__card {
  min-width: 0;
}
.card-stack[data-stacked] {
  --distribution-min-height: 0;
  height: min(34rem, calc(var(--home-panel-h) - 2 * var(--home-pad-y) - 4.25rem - 2px));
}
.card-stack[data-stacked] .card-stack__viewport {
  position: relative;
  /* Reserve the final card's lower landing point. */
  height: calc(100% - var(--stack-trail, 0px));
}
.card-stack[data-stacked] .card-stack__card {
  position: absolute;
  inset: 0 0 auto;
  height: 100%;
}
</style>

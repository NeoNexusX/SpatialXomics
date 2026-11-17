<script setup lang="ts" generic="T extends { key: string }">
import { inject, useTemplateRef } from 'vue'
import { useCardStack } from '../motion/useCardStack'
import { homeSectionKey } from '../motion/homeSectionContext'

const props = defineProps<{ items: readonly T[] }>()
defineSlots<{ default(props: { item: T; index: number }): unknown }>()
const { active, enhanced } = useCardStack(
  useTemplateRef<HTMLElement>('root'),
  () => props.items.map((item) => item.key),
  inject(homeSectionKey, undefined),
)
</script>

<template>
  <div ref="root" class="card-stack" role="region" :tabindex="enhanced ? 0 : undefined">
    <ol class="card-stack__viewport" data-stack-viewport>
      <li
        v-for="(item, index) in items"
        :key="item.key"
        data-stack-card
        class="card-stack__card"
        :inert="enhanced && index !== active"
      >
        <slot :item="item" :index="index" />
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
  /* Leave room for the shared heading above both columns. */
  height: min(34rem, calc(var(--home-panel-h) - 2 * var(--home-pad-y) - 4.25rem - 2px));
}
.card-stack[data-stacked] .card-stack__viewport {
  position: relative;
  /* Reserve the whole stack, including the final card's lower landing point. */
  height: calc(100% - var(--stack-trail, 0px));
}
.card-stack[data-stacked] .card-stack__card {
  position: absolute;
  inset: 0 0 auto;
  /* Equal heights keep the complete cards behind the next opaque surface. */
  height: 100%;
}
</style>

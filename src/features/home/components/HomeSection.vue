<script setup lang="ts">
import { provide, shallowRef, useTemplateRef } from 'vue'
import { homeSectionKey } from '../motion/homeSectionContext'

/**
 * 首页面板：统一圆角边界和停靠位置；统计面板在边界内承载叠卡。
 *
 * 宽屏下每张面板一样高（约一屏，底下露出下一张的上缘），开了 stack 的面板停在顶部，
 * 由下一张面板整张盖上来，正好盖住、不会多出一截。窄屏下高度跟内容走，不叠层。
 * 留白、配色等量在 HomeView 根节点上定义。
 */
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    /** 停在顶部，由下一张面板盖上来 */
    stack?: boolean
    surface?: 'panel' | 'stats' | 'hero'
    /** 同一时间轴上先于叠卡入场的内容，由使用者显式传入。 */
    introElements?: readonly HTMLElement[]
  }>(),
  { stack: false, surface: 'panel', introElements: () => [] },
)

const panel = useTemplateRef<HTMLElement>('panel')
const anchor = useTemplateRef<HTMLElement>('anchor')
const dwell = shallowRef(0)
// Descendant stacks request flow space through this contract. Their layout does
// not depend on the section's classes, wrapper depth or sibling order.
provide(homeSectionKey, {
  panel,
  anchor,
  introElements: () => props.introElements,
  setDwell: (distance) => (dwell.value = distance),
})
</script>

<template>
  <span v-if="stack" ref="anchor" class="home-anchor" aria-hidden="true" />
  <section
    ref="panel"
    v-bind="$attrs"
    class="home-panel"
    :class="[{ 'home-panel--stack': stack }, `home-panel--${surface}`]"
  >
    <div v-if="$slots.background" class="home-panel__background">
      <slot name="background" />
    </div>
    <div class="home-panel__inner">
      <div class="home-panel__body">
        <slot />
      </div>
    </div>
  </section>
  <span v-if="stack" class="home-dwell" :style="{ height: `${dwell}px` }" aria-hidden="true" />
</template>

<style scoped>
.home-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  border-radius: var(--home-radius);
  padding: var(--home-pad-y) var(--home-pad-x);
  background: var(--home-panel);
  border: 1px solid var(--home-line);
  box-shadow: var(--home-shadow);
}

.home-panel__inner {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  width: 100%;
  max-width: var(--home-max);
  margin-inline: auto;
}
.home-panel__background {
  position: absolute;
  inset: 0;
  z-index: -1;
}
.home-panel--stats {
  --home-panel-h: calc(100svh - 2 * var(--home-inset));
  --home-max: none;
  --home-pad-x: clamp(1.25rem, 2.4vw, 2.5rem);
  border-color: color-mix(in oklab, var(--color-base-content) 12%, transparent);
  background: var(--stats-surface);
  isolation: isolate;
  /* Keep the rounded section visible while cards rise inside its lower edge. */
  overflow: clip;
}
.home-panel--hero {
  min-height: clamp(34rem, 88svh, 56rem);
  isolation: isolate;
  overflow: clip;
  border-color: transparent;
  box-shadow: none;
  background: var(--hero-surface);
}
.home-panel--hero .home-panel__inner {
  /* Let the full-panel image receive pointer movement between foreground links. */
  pointer-events: none;
}

.home-panel__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

@media (min-width: 1024px) {
  .home-panel {
    min-height: var(--home-panel-h);
  }
}

@media (min-width: 1024px) and (max-height: 780px) {
  .home-panel--stats {
    --home-pad-y: 1rem;
  }
}

/* Every stacked panel uses the same upper bound. A tall content panel must use
   the card stack or fall back to normal flow, never a negative sticky offset. */
@media (min-width: 1024px) and (min-height: 680px) and (prefers-reduced-motion: no-preference) {
  .home-panel--stack {
    position: sticky;
    top: var(--home-inset);
    height: var(--home-panel-h);
    min-height: 0;
  }
}
.home-anchor {
  height: 0;
  flex: none;
  margin-bottom: calc(-1 * var(--home-gap));
  pointer-events: none;
}
.home-dwell {
  /* Separate flow space: a sticky panel's own margin would shorten its sticky range. */
  flex: none;
  margin-top: calc(-1 * var(--home-gap));
  pointer-events: none;
}
</style>

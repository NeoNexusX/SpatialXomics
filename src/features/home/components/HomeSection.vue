<script setup lang="ts">
import { provide, shallowRef, useTemplateRef } from 'vue'
import { homeSectionKey } from '../motion/homeSectionContext'

/**
 * 首页面板：统一圆角边界和停靠位置；统计面板在边界内承载叠卡。
 *
 * 宽屏下每张面板共用一屏可用高度，默认停靠在顶栏下，由下一张圆角面板覆盖。
 * 窄屏下高度跟内容走，不叠层。
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
  { stack: true, surface: 'panel', introElements: () => [] },
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
        <div v-if="$slots.footer" class="home-panel__footer">
          <slot name="footer" />
        </div>
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
  --home-max: none;
  --home-pad-x: clamp(1.25rem, 2.4vw, 2.5rem);
  border-color: color-mix(in oklab, var(--color-base-content) 12%, transparent);
  background: var(--stats-surface);
  isolation: isolate;
  /* Keep the rounded section visible while cards rise inside its lower edge. */
  overflow: clip;
}
.home-panel--hero {
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
.home-panel__footer {
  margin-top: auto;
  flex: none;
}

@media (min-width: 1024px) {
  .home-panel {
    min-height: var(--home-panel-h);
  }
}

@media (min-width: 1024px) and (max-height: 900px) {
  .home-panel:not(.home-panel--hero) {
    --home-pad-y: 1rem;
  }
}

/* Every stacked panel uses the same upper bound. A tall content panel must use
   the card stack or fall back to normal flow, never a negative sticky offset. */
@media (min-width: 1024px) and (min-height: 680px) and (prefers-reduced-motion: no-preference) {
  .home-panel--stack {
    position: sticky;
    top: var(--home-top);
    height: var(--home-panel-h);
    min-height: 0;
  }
}
.home-panel--hero {
  /* 顶栏 + 上下留白 + Hero 正好一屏；所有断点及减少动态模式共用。 */
  height: var(--home-panel-h);
  min-height: 0;
}
.home-panel--hero + .home-dwell {
  margin-bottom: calc(var(--home-inset) - var(--home-gap));
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

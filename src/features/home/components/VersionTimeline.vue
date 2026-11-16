<script setup lang="ts">
/**
 * 版本时间线 —— 纵向 DaisyUI timeline，展示版本迭代历程。
 * 奇偶项左右交替（different sides）。
 *
 * 数据从 content.json 的 timeline 数组读取，每个节点含 date / version / features。
 */
import { localized } from '@/shared/config/localizedText'
import type { TimelineItem } from '@/features/home/config/contentConfig'

defineProps<{
  items: TimelineItem[]
}>()
</script>

<template>
  <ul
    v-if="items.length"
    class="timeline timeline-vertical timeline-snap-icon kawaru-text-home-timeline"
  >
    <!-- 顶部延伸：流内实体，撑高列盒子并向上渐隐 -->
    <li class="tl-tail tl-tail--top" aria-hidden="true" />
    <li v-for="(item, i) in items" :key="i">
      <hr />
      <div class="timeline-middle">
        <SvgIcon type="success" class="text-primary tl-icon" />
      </div>
      <!-- 偶数项（i=0,2,4…）：左侧日期，右侧特性；奇数项：反过来 -->
      <template v-if="i % 2 === 0">
        <div class="timeline-start">
          <span class="tl-date kawaru-text-112">{{ localized(item.date) }}</span>
          <span class="badge badge-primary tl-badge kawaru-text-95">v{{ item.version }}</span>
        </div>
        <div class="timeline-end">
          <div class="timeline-box kawaru-text-75">
            <ul class="tl-features">
              <li v-for="(feat, j) in item.features" :key="j">{{ localized(feat) }}</li>
            </ul>
          </div>
        </div>
      </template>
      <template v-else>
        <div class="timeline-start">
          <div class="timeline-box kawaru-text-75">
            <ul class="tl-features">
              <li v-for="(feat, j) in item.features" :key="j">{{ localized(feat) }}</li>
            </ul>
          </div>
        </div>
        <div class="timeline-end">
          <span class="tl-date kawaru-text-112">{{ localized(item.date) }}</span>
          <span class="badge badge-primary tl-badge kawaru-text-95">v{{ item.version }}</span>
        </div>
      </template>
      <hr />
    </li>
    <!-- 底部延伸：流内实体，撑高列盒子并向下渐隐 -->
    <li class="tl-tail tl-tail--bottom" aria-hidden="true" />
  </ul>
</template>

<style scoped>
/* 模板上的 kawaru-text-home-timeline 只给布局 em 当参照——.tl-icon 的 2em、
   hr 的 min-height:4em、.timeline-start 的 gap/padding/min-width。
   文字字号在模板上各自挂 kawaru-text-<档> 档位类，这里只保留行高与布局。 */
.timeline {
  height: 100%;
}

.tl-date {
  /* 112 档在模板上；行高沿用原来的 1.5 */
  line-height: 1.5;
  font-weight: 600;
  color: oklch(var(--color-base-content) / 0.5);
  white-space: nowrap;
}
.timeline-start,
.timeline-end {
  display: flex;
  flex-direction: column;
  gap: 0.25em;
  padding-inline: 0.9em;
  min-width: 5em;
  align-items: flex-start;
  text-align: left;
}
.timeline-box {
  line-height: 1.6;
}
.tl-features {
  list-style: disc;
  padding-left: 1.25em;
}
.tl-features li {
  color: oklch(var(--color-base-content) / 0.7);
  font-weight: 600;
}

/* 节点图标：随基础字号缩放（替代写死的 h-5 w-5） */
.tl-icon {
  width: 2em;
  height: 2em;
}

/* 版本徽章：daisyUI 的 .badge 自带固定 font-size，这里显式挂档位覆盖它。
   padding 用 em，跟随本元素字号等比缩放。 */
.tl-badge {
  height: auto;
  font-weight: 600;
  line-height: 1.3;
  padding: 0.15em 0.55em;
}

.timeline li {
  /* 不用 flex:1 撑满——行高 = 内容 + hr，间距完全由下方 hr 的 min-height 决定，可精确控制。
     整块在父容器里靠 md:items-center 居中。 */
  /* 覆盖 timeline-snap-icon 的 .5rem，让 icon 纵向居中而非贴顶 */
  --timeline-row-start: minmax(0, 1fr);
}

/* 连接线（=节点间距）整体加长：线即间距，故连续不断。
   想拉大/缩小间距只调这个 min-height（用 em 跟随整块等比缩放）。 */
.timeline :where(hr) {
  min-height: 4em;
}

/* 上下延伸：流内实体（占布局空间、撑高列盒子），居中竖线接续连接线并向外渐隐。
   流内高度无法用内容百分比（会与自身撑出的高度循环依赖），故用相对场景的 vh + 上下界。 */
.tl-tail {
  flex: 0 0 auto; /* 固定拖尾高度，不被压缩 */
  display: flex;
  justify-content: center; /* 竖线水平居中 = 连接线所在的几何正中 */
  height: clamp(5rem, 10vh, 20rem);
}
.tl-tail::before {
  content: '';
  /* 与 daisyUI 连接线完全一致：同宽 .25rem、同色 base-300 */
  width: 0.25rem;
  height: 100%;
  background: var(--color-base-300);
}
.tl-tail--top::before {
  -webkit-mask-image: linear-gradient(to top, #000, transparent);
  mask-image: linear-gradient(to top, #000, transparent);
}
.tl-tail--bottom::before {
  -webkit-mask-image: linear-gradient(to bottom, #000, transparent);
  mask-image: linear-gradient(to bottom, #000, transparent);
}
</style>

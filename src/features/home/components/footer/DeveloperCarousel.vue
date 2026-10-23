<script setup lang="ts">
import DeveloperCard from './DeveloperCard.vue'
import { getConfig } from '@/shared/config'
import { localized } from '@/shared/config/localizedText'
import { getContent } from '@/features/home/config/contentConfig'
import { useCarouselScroll } from '@/features/home/composables/useCarouselScroll'

// 成员名单属首页展示内容（content.json），轮播节奏属全站 UI 调参（config.json）
const { team: TEAM_MEMBERS } = getContent()
const { carousel } = getConfig()

const { trackRef, atStart, atEnd, cols, GAP, MAX_CARD, TRACK_MAX, scrollByPage } =
  useCarouselScroll({ interval: carousel.interval, endPause: carousel.endPause })
</script>

<template>
  <div class="dev-viewport relative mx-auto" :style="{ '--track-max': TRACK_MAX + 'px' }">
    <!-- 轨道：列数 = 容器能容纳的整数张（每张介于 MIN_CARD~MAX_CARD），由 --cols 驱动；
         两侧「虚空槽」由 .dev-track 的 padding-inline 给出（= 遮罩宽度），翻页按钮浮于其上、紧贴边缘 -->
    <ul
      ref="trackRef"
      class="dev-track no-scrollbar relative flex snap-x snap-mandatory overflow-x-auto scroll-smooth py-4"
      :style="{ '--cols': cols, '--card-max': MAX_CARD + 'px', '--gap': GAP + 'px' }"
      role="region"
      :aria-label="$t('home.team.carousel')"
      tabindex="0"
    >
      <li v-for="member in TEAM_MEMBERS" :key="localized(member.name)" class="dev-cell shrink-0 snap-start">
        <!-- 内层包裹：承载缩放/淡入淡出，不影响 li 的 snap 几何 -->
        <div class="carousel-item">
          <DeveloperCard :member="member" />
        </div>
      </li>
    </ul>

    <!-- 翻页按钮：仅中大屏显示，触摸端用手势；紧贴边缘，浮于两侧虚空槽内 -->
    <button
      type="button"
      class="btn btn-circle btn-sm absolute left-0 top-1/2 z-10 hidden -translate-y-1/2 shadow-md transition-opacity duration-300 md:inline-flex kawaru-text-75"
      :class="atStart ? 'pointer-events-none opacity-0' : 'opacity-100'"
      :aria-hidden="atStart"
      :tabindex="atStart ? -1 : 0"
      :aria-label="$t('common.action.prev')"
      @click="scrollByPage(-1)"
    >
      <SvgIcon type="chevron_right" class="h-5 w-5 rotate-180" />
    </button>
    <button
      type="button"
      class="btn btn-circle btn-sm absolute right-0 top-1/2 z-10 hidden -translate-y-1/2 shadow-md transition-opacity duration-300 md:inline-flex kawaru-text-75"
      :class="atEnd ? 'pointer-events-none opacity-0' : 'opacity-100'"
      :aria-hidden="atEnd"
      :tabindex="atEnd ? -1 : 0"
      :aria-label="$t('common.action.next')"
      @click="scrollByPage(1)"
    >
      <SvgIcon type="chevron_right" class="h-5 w-5" />
    </button>
  </div>
</template>

<style scoped>
/* 轮播视口封顶：最多容纳 MAX_COLS 张满宽卡片（含其间距）+ 两侧渐隐槽，居中。
   超宽屏不再摊开更多卡片，多出的成员只能靠滑动浏览 —— 与 JS 的 cols 封顶共同锁死可见张数。
   --track-max = MAX_COLS 张满宽卡片含间距（由 :style 写入）；两侧渐隐槽各取 --fade-max
   （视口足够宽到触发封顶时，clamp 的 7% 必然 > --fade-max，故此处用其封顶值即与实际渐隐宽度吻合）。 */
.dev-viewport {
  --fade-max: 5rem; /* 渐隐槽封顶宽度：同时作为 .dev-track 的 --fade clamp 上限（继承） */
  max-width: calc(var(--track-max) + 2 * var(--fade-max));
}

/* 轨道两侧各留一条 =「遮罩宽度」的虚空槽（padding-inline），并在该槽内用 mask 横向渐变
   把内容在「空间上」渐隐到透明 —— 卡片在抵达容器物理边缘「之前」就已淡入虚空，
   故容器边界不再可见、也不会出现硬裁切竖线。遮罩常驻、固定在容器视口、仅作用于水平方向。
   scroll-padding-inline 同取该宽度：吸附到首/末卡时其正好落在不透明区，完整呈现、绝不被裁。 */
.dev-track {
  --fade: clamp(2rem, 10%, var(--fade-max));
  gap: var(--gap);
  padding-inline: var(--fade);
  scroll-padding-inline: var(--fade);
  -webkit-mask-image: linear-gradient(
    to right,
    transparent 0,
    #000 var(--fade),
    #000 calc(100% - var(--fade)),
    transparent 100%
  );
  mask-image: linear-gradient(
    to right,
    transparent 0,
    #000 var(--fade),
    #000 calc(100% - var(--fade)),
    transparent 100%
  );
}

.dev-cell {
  /* 宽度 = (容器内容宽度 − 各间距) ÷ 列数，恰好铺满（--gap 与轨道 gap 同源）*/
  flex: 0 0 calc((100% - (var(--cols, 1) - 1) * var(--gap)) / var(--cols, 1));
  /* 兜底：离屏/首帧 cols 错算成 1 时，夹住单卡不被拉满整容器（上限即 JS 的 MAX_CARD）*/
  max-width: var(--card-max);
}
.carousel-item {
  /* 作为容器，使卡片边框可用 cqi 随其宽度自适应 */
  container-type: inline-size;
  transform-origin: center center;
}

/* 卡片「从虚空缩放浮现 / 隐没」：用 CSS Scroll-Driven Animations 的 view() 时间线，
   按卡片在轨道滚动视口内的「可见进度」驱动 —— 进入(entry)时由小变大、淡入；离开(exit)时反之；
   完整可见(contain)区间维持原大小。运行在合成层、由滚动位置驱动，无需 JS 逐帧。
   inset 取渐隐槽宽度 var(--fade)（与 mask、scroll-padding 同源），使缩放与 mask 的空间渐隐对齐。
   仅在支持的浏览器启用；不支持者（如旧版 Safari）整段忽略 —— 卡片保持原样、仅靠 mask 柔化边缘（优雅降级）。 */
@supports (animation-timeline: view()) {
  .carousel-item {
    animation: card-emerge linear both;
    animation-timeline: view(inline var(--fade));
    will-change: transform, opacity;
  }
  @keyframes card-emerge {
    entry 0% { transform: scale(0.1); opacity: 0 }
    entry 50% { transform: scale(0.325); opacity: 0.5 }
    entry 100%,
    exit 0% { transform: scale(1); opacity: 1 }
    exit 50% { transform: scale(0.325); opacity: 0.5 }
    exit 100% { transform: scale(0.1); opacity: 0 }
  }
  @media (prefers-reduced-motion: reduce) {
    .carousel-item {
      animation: none;
    }
  }
}
</style>

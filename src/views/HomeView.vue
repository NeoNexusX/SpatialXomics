<script setup lang="ts">
import { useTemplateRef } from 'vue'
import HeroScene from '@/features/home/components/HeroScene.vue'
import StatsScene from '@/features/home/components/StatsScene.vue'
import TeamScene from '@/features/home/components/TeamScene.vue'
import { useSmoothScroll } from '@/features/home/motion/useSmoothScroll'

useSmoothScroll(useTemplateRef<HTMLElement>('root'))
</script>

<template>
  <!-- 首页：浅灰底上一张张圆角面板。宽屏下面板在同一上沿停住，由下一张盖上来（见 HomeSection） -->
  <div ref="root" class="home text-base-content">
    <HeroScene />
    <StatsScene />
    <TeamScene />
  </div>
</template>

<style scoped>
/* 首页的留白和配色：所有面板共用，改这里即可 */
.home {
  /* 面板到视口边缘的距离、面板之间的间距 */
  --home-inset: clamp(0.5rem, 2vw, 1.875rem);
  --home-gap: clamp(0.5rem, 1vw, 0.75rem);
  --home-top: calc(var(--app-navbar-height, 0px) + var(--home-inset));
  /* 三张面板共用顶栏下的可用高度与停靠位置。 */
  --home-panel-h: calc(100dvh - var(--home-top) - var(--home-inset));
  /* 面板圆角与内边距；上下内边距按视口高度收，矮屏也放得下 */
  --home-radius: clamp(1.25rem, 2.6vw, 2.5rem);
  --home-pad-x: clamp(1.25rem, 3vw, 3rem);
  --home-pad-y: clamp(1.75rem, 5.5vh, 4rem);
  /* 面板内容最大宽度（超宽屏上内容居中） */
  --home-max: 88rem;
  /* 配色与站内其他页面一致：近白的页面底色，白色面板配浅边框和柔和阴影；
     面板里的内容卡用带一点品牌蓝的近白色，强调只用品牌蓝。
     内容卡在 oklab 里混色：daisyUI 的 base 色写成 oklch(98% 0 0)，色相是显式的 0，
     在 oklch 里混会从 0° 插到品牌蓝的 260°，混出一点粉色 */
  --home-page: var(--color-base-200);
  --home-panel: var(--color-base-100);
  --hero-surface: #edf1f4;
  --stats-surface: #e8edf2;
  --home-card: color-mix(in oklab, var(--color-primary) 5%, var(--color-base-200));
  --home-line: color-mix(in oklch, var(--color-base-content) 8%, transparent);
  --home-shadow: 0 1px 2px rgb(0 0 0 / 0.04), 0 0.75rem 2rem -1.25rem rgb(0 0 0 / 0.1);
  --stat-line: color-mix(in oklab, var(--color-base-content) 14%, transparent);
  --stat-contact: rgb(28 45 64 / 0.22);

  display: flex;
  flex-direction: column;
  gap: var(--home-gap);
  padding: var(--home-inset);
  background: var(--home-page);
}

/* 深色下 base-200 比 base-100 暗，页面底色改用最暗的 base-300；
   内容卡要比面板亮一档才看得出来（与面板只差 2% 亮度时几乎隐形）。
   不要写成 :global([data-theme='dark']) .home：Vue 会把 :global 之后的部分整段丢掉，
   规则只剩 [data-theme='dark']，变量落到 <html> 上，被 .home 自己的定义盖住 */
[data-theme='dark'] .home {
  --home-page: var(--color-base-300);
  --hero-surface: #232a33;
  --stats-surface: #242e39;
  --home-card: color-mix(in oklab, var(--color-base-content) 7%, var(--color-base-100));
  --stat-line: rgb(230 239 250 / 0.19);
  --stat-contact: rgb(0 0 0 / 0.55);
}
</style>

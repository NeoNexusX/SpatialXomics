<script setup lang="ts">
import NewsTag from '@/features/news/components/NewsTag.vue'
import { NEWS, formatNewsDate, newsColor } from '@/features/news/config/newsContent'
import { localized } from '@/shared/config/localizedText'

// 每年的第一篇在日期下面标出年份
const opensYear = (i: number) => i === 0 || NEWS[i - 1]!.date.slice(0, 4) !== NEWS[i]!.date.slice(0, 4)
// 标记外圈留一道底色的缝，和色标线段隔开；最新一篇再加一圈同色光晕
const markerShadow = (i: number) =>
  `0 0 0 4px var(--color-base-200)${i === 0 ? `, 0 0 18px 4px ${newsColor(i)}` : ''}`
</script>

<template>
  <div class="min-h-screen bg-base-200">
    <div class="max-w-5xl mx-auto px-5 py-10 md:px-8 md:py-16 kawaru-text-100">
      <header class="mb-12 md:mb-16 md:pl-[11.5rem]">
        <h1 class="kawaru-text-page-title leading-[1.15] font-bold text-base-content">
          {{ $t('news.title') }}
        </h1>
        <p class="mt-2 text-base-content/60">{{ $t('news.subtitle') }}</p>
      </header>

      <p v-if="!NEWS.length" class="md:pl-[11.5rem] text-base-content/60">{{ $t('news.empty') }}</p>

      <!-- 时间线是一条 viridis 色标：每篇一个「像素」，越新越亮 -->
      <ol v-else>
        <li v-for="(item, i) in NEWS" :key="item.id" class="pb-12">
          <router-link
            :to="{ name: 'NewsDetail', params: { id: item.id } }"
            class="group grid grid-cols-[1.5rem_minmax(0,1fr)] md:grid-cols-[7.5rem_1.5rem_minmax(0,1fr)] gap-x-5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-viridis-ink"
          >
            <div class="hidden md:block text-right kawaru-text-95">
              <time :datetime="item.date" class="font-semibold tabular-nums text-base-content/75">
                {{ formatNewsDate(item, { month: 'short', day: 'numeric' }) }}
              </time>
              <div v-if="opensYear(i)" class="kawaru-text-81 tabular-nums text-base-content/40">
                {{ item.date.slice(0, 4) }}
              </div>
            </div>

            <!-- 标记和通往下一篇的线段；线段两端的颜色就是两篇各自的标记色 -->
            <div class="relative kawaru-text-95" aria-hidden="true">
              <div class="relative z-10 flex h-[1.5em] items-center justify-center">
                <span
                  class="block rounded-[3px] dark:outline dark:outline-1 dark:outline-white/20"
                  :class="i === 0 ? 'size-[0.95em]' : 'size-[0.6em]'"
                  :style="{ background: newsColor(i), boxShadow: markerShadow(i) }"
                />
              </div>
              <span
                v-if="i < NEWS.length - 1"
                class="rail absolute left-1/2 top-[0.75em] -bottom-[calc(3rem+0.75em)] w-[3px] -translate-x-1/2 rounded-full"
                :style="{
                  background: `linear-gradient(${newsColor(i)}, ${newsColor(i + 1)})`,
                  animationDelay: `${Math.min(i, 8) * 110}ms`,
                }"
              />
            </div>

            <div class="min-w-0">
              <div class="flex h-[1.5em] items-center gap-3 kawaru-text-95">
                <NewsTag :version="item.version" class="kawaru-text-81" />
                <time :datetime="item.date" class="md:hidden kawaru-text-81 tabular-nums text-base-content/50">
                  {{ formatNewsDate(item, { dateStyle: 'medium' }) }}
                </time>
              </div>
              <h2
                class="font-bold text-balance text-base-content transition-colors group-hover:text-viridis-ink"
                :class="i === 0 ? 'mt-3 kawaru-text-187' : 'mt-2 kawaru-text-125'"
              >
                {{ localized(item.title) }}
              </h2>
              <p
                class="text-pretty text-base-content/65"
                :class="i === 0 ? 'mt-3 max-w-[36em] kawaru-text-112' : 'mt-2 max-w-[42em] line-clamp-2'"
              >
                {{ localized(item.summary) }}
              </p>
              <span
                v-if="i === 0"
                class="mt-5 inline-block font-semibold text-viridis-ink underline decoration-2 underline-offset-[0.35em]"
              >
                {{ $t('news.readMore') }}
              </span>
            </div>
          </router-link>
        </li>
      </ol>
    </div>
  </div>
</template>

<style scoped>
/* 进入页面时，色标从最新一篇往下依次画出 */
.rail {
  transform-origin: top;
  animation: rail-draw 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes rail-draw {
  from {
    transform: scaleY(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .rail {
    animation: none;
  }
}
</style>

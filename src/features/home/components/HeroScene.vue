<script setup lang="ts">
import { RouterLink } from 'vue-router'
import HomeSection from './HomeSection.vue'
import HeroGallery from './HeroGallery.vue'
import { getBrandParts } from '@/shared/config/appName'
import { getContent } from '@/features/home/config/contentConfig'
import { localized } from '@/shared/config/localizedText'
import { vSplitReveal, vStagger } from '../motion/directives'

const { hero } = getContent()
const taglines = hero.taglines
const gallery = hero.gallery?.slice(0, 2) ?? []

// 每个 tagline 停留 2000ms，整圈时长 = 数量 × 2000ms
const rotateDuration = `${taglines.length * 2000}ms`

// 保留品牌 X 的配色，字形与其余名称保持同一尺寸和基线。
const { pre: namePre, x: nameX, post: namePost } = getBrandParts()
</script>

<template>
  <HomeSection id="hero" stack surface="hero">
    <template v-if="gallery.length" #background>
      <HeroGallery :images="gallery" />
    </template>

    <header class="hero-heading">
      <h1
        v-split-reveal="{ by: 'chars' }"
        class="hero-title kawaru-text-home-title font-semibold text-base-content"
      >
        {{ namePre
        }}<span class="brand-text bg-gradient-to-bl from-[var(--brand-accent)] to-primary">{{
          nameX
        }}</span
        >{{ namePost }}
      </h1>

      <div v-if="taglines.length" v-stagger="{ delay: 0.3, y: 12 }" class="hero-keywords">
        <span
          class="text-rotate hero-rotate kawaru-text-home-keyword font-bold italic text-primary"
          style="font-synthesis: style"
          :style="{ '--duration': rotateDuration }"
        >
          <span>
            <span v-for="(tagline, i) in taglines" :key="i">{{ localized(tagline) }}</span>
          </span>
        </span>
      </div>
    </header>

    <div class="hero-footer">
      <!-- 切分后的文字 Vue 改不到，按文字加 key：切换语言时整块重建 -->
      <p
        :key="$t('home.hero.lead')"
        v-split-reveal="{ delay: 0.4 }"
        class="hero-lead kawaru-text-95 text-base-content/70"
      >
        {{ $t('home.hero.lead') }}
      </p>
      <div v-stagger="{ delay: 0.5, y: 16 }" class="hero-action">
        <RouterLink
          to="/register"
          class="btn btn-primary h-auto min-h-0 gap-2 rounded-full border-none px-7 py-3.5 kawaru-text-95 font-semibold shadow-none"
        >
          {{ $t('home.actions.join') }}
          <SvgIcon type="chevron_right" class="h-[1.1em] w-[1.1em]" />
        </RouterLink>
      </div>
    </div>

    <div class="scroll-cue absolute bottom-6 hidden items-center gap-3 text-base-content/40">
      <span class="scroll-cue__line" aria-hidden="true" />
      <span class="kawaru-text-68 font-semibold uppercase tracking-[0.2em]">{{
        $t('home.hero.scroll')
      }}</span>
    </div>
  </HomeSection>
</template>

<style scoped>
.hero-heading,
.hero-footer {
  position: relative;
  z-index: 1;
  text-align: center;
  pointer-events: none;
}
.hero-heading {
  padding-top: clamp(0.5rem, 3vh, 2rem);
}
.hero-title {
  line-height: 1.12;
  letter-spacing: -0.055em;
}
/* SplitText gives each character its own transformed layer. Paint the brand
   gradient on that layer too, so the X remains visible during and after reveal. */
.hero-title :deep(.brand-text .split-char) {
  background: inherit;
  background-clip: text;
  -webkit-background-clip: text;
}
.hero-keywords {
  margin-top: clamp(0.5rem, 1.6vh, 1rem);
}
/* Keep daisyUI's grid, rotator keyframes and longest-word width. Each row gets
   enough line-box space for italic glyphs and the tagline's arrows / symbols. */
.hero-rotate {
  height: 1lh;
  line-height: 1.45;
  font-family: 'Outfit', sans-serif;
  letter-spacing: -0.02em;
  pointer-events: auto;
}
.hero-rotate > span {
  justify-items: stretch;
}
.hero-rotate > span > span {
  align-content: center;
  padding-inline: 0.25em;
  clip-path: none;
}
.hero-footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  margin-top: auto;
  padding-top: clamp(13rem, 32vh, 21rem);
}
.hero-lead {
  max-width: 34em;
  text-wrap: balance;
}
.hero-action {
  flex: none;
  pointer-events: auto;
}
@media (max-width: 639px) {
  .hero-footer {
    gap: 0.75rem;
  }
}

/* 只在够高的宽屏上显示，矮屏时首屏内容会挤到底边 */
.scroll-cue {
  left: var(--home-pad-x);
  z-index: 1;
}
@media (min-width: 1024px) and (min-height: 820px) {
  .scroll-cue {
    display: flex;
  }
}
.scroll-cue__line {
  position: relative;
  width: 1px;
  height: 2.5rem;
  overflow: hidden;
  background: color-mix(in oklch, var(--color-base-content) 15%, transparent);
}
.scroll-cue__line::after {
  content: '';
  position: absolute;
  inset: 0;
  background: currentColor;
  animation: scroll-cue 2.2s cubic-bezier(0.65, 0, 0.35, 1) infinite;
}
@keyframes scroll-cue {
  0% {
    transform: translateY(-100%);
  }
  60%,
  100% {
    transform: translateY(100%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .hero-rotate > span {
    animation: none;
    translate: none;
  }
  .scroll-cue__line::after {
    animation: none;
    transform: none;
  }
}
</style>

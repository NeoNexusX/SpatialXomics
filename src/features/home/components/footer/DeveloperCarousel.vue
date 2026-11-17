<script setup lang="ts">
/**
 * 团队成员卡轨道：横向滚动 + 吸附，左右箭头整页翻；触控板和触摸可直接横滑。
 * 一屏只放整数张卡（列数按轨道宽度用容器查询决定），不露出半张。
 */
import { useTemplateRef } from 'vue'
import { useScroll } from '@vueuse/core'
import DeveloperCard from './DeveloperCard.vue'
import { localized } from '@/shared/config/localizedText'
import { getContent } from '@/features/home/config/contentConfig'
import { vStagger } from '../../motion/directives'

const { team } = getContent()

const track = useTemplateRef<HTMLElement>('track')
// 滚到两端时对应的箭头置灰；容差吸收吸附和子像素取整带来的几像素偏差
const { arrivedState } = useScroll(track, { offset: { left: 8, right: 8 } })

/** 整页翻：一页正好是轨道可见宽度，吸附会对齐到下一页的第一张 */
function page(direction: 1 | -1) {
  const el = track.value
  if (el) el.scrollBy({ left: direction * el.clientWidth, behavior: 'smooth' })
}
</script>

<template>
  <div>
    <div class="mb-6 flex justify-end gap-2">
      <button
        type="button"
        class="dev-arrow"
        :disabled="arrivedState.left"
        :aria-label="$t('common.action.prev')"
        @click="page(-1)"
      >
        <SvgIcon type="chevron_left" class="h-5 w-5" />
      </button>
      <button
        type="button"
        class="dev-arrow"
        :disabled="arrivedState.right"
        :aria-label="$t('common.action.next')"
        @click="page(1)"
      >
        <SvgIcon type="chevron_right" class="h-5 w-5" />
      </button>
    </div>

    <ul
      ref="track"
      v-stagger
      class="dev-track no-scrollbar"
      role="region"
      :aria-label="$t('home.team.carousel')"
      tabindex="0"
    >
      <li v-for="member in team" :key="localized(member.name)" class="dev-cell">
        <DeveloperCard :member="member" />
      </li>
    </ul>
  </div>
</template>

<style scoped>
.dev-track {
  --gap: clamp(0.75rem, 1.5vw, 1.25rem);
  display: flex;
  gap: var(--gap);
  overflow-x: auto;
  /* 显式禁止纵向滚动：只写 overflow-x 时 overflow-y 会被算成 auto，内容高出零点几像素就算「可纵向滚动」，
     竖向滚轮会被锁在轨道上，页面滚不动 */
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  scroll-snap-type: x mandatory;
  /* 上下留出卡片悬停放大的余量，否则会被横向滚动容器裁掉 */
  padding-block: 0.75rem;
  /* 列数按轨道自身宽度决定 */
  container-type: inline-size;
}

/* 一屏放 --cols 张整卡，宽度均分轨道（100cqi 是轨道宽度） */
.dev-cell {
  --cols: 1;
  flex: 0 0 calc((100cqi - (var(--cols) - 1) * var(--gap)) / var(--cols));
  scroll-snap-align: start;
  /* DeveloperCard 的字号和头像按卡片宽度（cqi）缩放 */
  container-type: inline-size;
}
@container (min-width: 26rem) {
  .dev-cell {
    --cols: 2;
  }
}
@container (min-width: 40rem) {
  .dev-cell {
    --cols: 3;
  }
}
@container (min-width: 54rem) {
  .dev-cell {
    --cols: 4;
  }
}
@container (min-width: 70rem) {
  .dev-cell {
    --cols: 5;
  }
}

.dev-arrow {
  display: inline-grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 999px;
  border: 1px solid var(--home-line);
  color: var(--color-base-content);
  transition:
    background-color 0.2s,
    color 0.2s,
    opacity 0.2s;
}
.dev-arrow:hover:not(:disabled) {
  background: var(--color-primary);
  border-color: transparent;
  color: var(--color-primary-content);
}
.dev-arrow:disabled {
  opacity: 0.35;
  cursor: default;
}
</style>

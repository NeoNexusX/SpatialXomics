<script setup lang="ts">
/**
 * 数字滚动：进入视口时从 0 数到目标值。
 *
 * 最终值先以隐形文字占好宽度，计数过程中布局不抖；读屏器只读最终值。
 * 「减少动态」下直接显示最终值。
 */
import { onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import { formatNumber } from '@/shared/utils/format'
import { gsap, MOTION } from '../motion/gsap'

const props = defineProps<{ value: number }>()

const el = useTemplateRef<HTMLElement>('el')
const shown = shallowRef(formatNumber(props.value))
let media: gsap.MatchMedia | undefined
let played = false

onMounted(() => {
  media = gsap.matchMedia()
  media.add(MOTION.media, () => {
    if (played) return
    const state = { value: 0 }
    shown.value = formatNumber(0)
    gsap.to(state, {
      value: props.value,
      duration: 1.6,
      ease: 'power3.out',
      scrollTrigger: { trigger: el.value, start: 'top 92%', once: true },
      onUpdate: () => {
        shown.value = formatNumber(Math.round(state.value))
      },
      onComplete: () => {
        played = true
      },
    })
    return () => {
      played = true
      shown.value = formatNumber(props.value)
    }
  })
})

// 重新加载后值变了：不再重播，直接显示
watch(
  () => props.value,
  (value) => {
    played = true
    media?.revert()
    shown.value = formatNumber(value)
  },
)

onBeforeUnmount(() => media?.revert())
</script>

<template>
  <span ref="el" class="count-up">
    <span class="sr-only">{{ formatNumber(value) }}</span>
    <span class="invisible" aria-hidden="true">{{ formatNumber(value) }}</span>
    <span aria-hidden="true">{{ shown }}</span>
  </span>
</template>

<style scoped>
.count-up {
  display: inline-grid;
}
.count-up > [aria-hidden] {
  grid-area: 1 / 1;
}
</style>

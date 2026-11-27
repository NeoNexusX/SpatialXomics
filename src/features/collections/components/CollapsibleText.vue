<template>
  <!-- 长文本折叠：默认最多显示 4 行，内容确实被截断时才出现「展开全文」。
       是否被截断靠量而不是按字数猜：文本的自然高度超过「行高 × 行数」才算——按字数猜会随
       屏幕宽度失准（宽屏上没被截却出现按钮，点了没有反应）。
       父级（<dd>）提供字号与行高，这里只管截断与展开。 -->
  <div>
    <p ref="text" class="whitespace-pre-line" :class="expanded ? '' : CLAMP_CLASS">{{ value }}</p>
    <button
      v-if="canExpand"
      type="button"
      class="mt-0.5 text-primary hover:underline cursor-pointer kawaru-text-81"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      {{ expanded ? $t('collections.panel.collapse') : $t('collections.panel.expand') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'

const props = defineProps<{
  /** 要展示的全文 */
  value: string
}>()

/**
 * 折叠时的截断行数。行数写进类名——Tailwind 只认源码里完整出现的类名——再从类名读回来，
 * 保证量的高度和截的高度用的是同一个数。
 */
const CLAMP_CLASS = 'line-clamp-4'
const CLAMP_LINES = Number(CLAMP_CLASS.slice('line-clamp-'.length))

const text = useTemplateRef<HTMLElement>('text')
const expanded = ref(false)
/** 文本高度超过折叠上限，即此刻确实被截断：只有这时才显示展开按钮 */
const canExpand = ref(false)

function measure() {
  const el = text.value
  // 行高取不到像素值（或元素没有布局，如 jsdom）时无从比较，按「未被截断」处理
  const lineHeight = el ? Number.parseFloat(getComputedStyle(el).lineHeight) : Number.NaN
  if (!el || !Number.isFinite(lineHeight) || lineHeight <= 0) {
    canExpand.value = false
    return
  }
  // scrollHeight 是全部内容的高度，不受截断影响；+1 容忍行高的小数
  canExpand.value = el.scrollHeight > lineHeight * CLAMP_LINES + 1
}

onMounted(measure)

// 文本变了（保存后回到只读态、切换集合）：先收回折叠，再按新内容重量
watch(
  () => props.value,
  async () => {
    expanded.value = false
    await nextTick()
    measure()
  },
)

// 容器宽度变化（窗口缩放、侧栏开合）会改变换行，重新判定是否被截断
useResizeObserver(text, measure)
</script>

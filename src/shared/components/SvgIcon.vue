<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { ICON_MAP, type IconType } from './svgIcons'

const props = defineProps<{ type: IconType }>()

// 未命中（理论上被类型拦住，仅运行时兜底）回退为问号图标
const iconName = computed(() => ICON_MAP[props.type] ?? 'heroicons:question-mark-circle')
</script>

<template>
  <!-- 默认尺寸走 style.css 的 :where([data-svg-icon])（零特异性）：Tailwind 会把
       任意值工具类 h-[1.125em] 排在命名刻度（h-5/h-7…）之后，写在 class 里会
       反过来压制调用方传入的尺寸类——用 data 属性 + :where 才能保证任何
       h-*/w-* 类稳定覆盖默认值 -->
  <Icon v-bind="$attrs" :icon="iconName" data-svg-icon class="inline-block" aria-hidden="true" />
</template>

<script setup lang="ts">
/** 只有图标的圆形按钮：label 同时是悬停提示和无障碍名称 */
import { Button, type ButtonVariants } from '../ui/button'

const { size = 'icon-sm' } = defineProps<{ label: string; size?: ButtonVariants['size'] }>()
</script>

<template>
  <Button variant="ghost" :size="size" class="rounded-full" :title="label" :aria-label="label">
    <slot />
  </Button>
</template>

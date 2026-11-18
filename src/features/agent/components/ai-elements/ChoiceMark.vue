<script setup lang="ts">
/**
 * 选项前的选择标记：单选是圆，多选是方。没选中时里面放快捷键数字或图标，选中后填成强调色、换成对勾。
 * 外层高一行，标记和旁边文字的第一行居中对齐。
 */
import { CheckIcon } from '@lucide/vue'

defineProps<{ checked: boolean; multiple?: boolean }>()
</script>

<template>
  <span aria-hidden="true" class="flex h-[1lh] shrink-0 items-center">
    <span
      class="kawaru-text-56 flex size-4.5 items-center justify-center border font-medium tabular-nums transition-colors motion-reduce:transition-none"
      :class="[
        multiple ? 'rounded-[5px]' : 'rounded-full',
        checked
          ? 'border-transparent bg-(--sxo-accent) text-base-100'
          : 'border-input text-(--sxo-label-3)',
      ]"
    >
      <CheckIcon v-if="checked" class="size-3" :stroke-width="3" />
      <slot v-else />
    </span>
  </span>
</template>

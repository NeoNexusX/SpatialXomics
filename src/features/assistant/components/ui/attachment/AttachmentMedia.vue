<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/features/assistant/utils/cn"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="attachment-media"
    :class="cn('bg-muted relative flex aspect-square w-full shrink-0 items-center justify-center overflow-hidden rounded-lg', props.class)"
  >
    <slot />
  </div>
</template>

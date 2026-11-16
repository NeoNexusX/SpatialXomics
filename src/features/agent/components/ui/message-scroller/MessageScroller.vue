<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/features/agent/utils/cn"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="message-scroller"
    :class="cn('relative flex size-full min-h-0 flex-col overflow-hidden', props.class)"
  >
    <slot />
  </div>
</template>

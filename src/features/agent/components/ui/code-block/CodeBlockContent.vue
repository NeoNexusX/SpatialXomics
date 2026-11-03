<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/features/agent/utils/cn"
import { Primitive } from "reka-ui"

const props = defineProps<{
  wrap?: boolean
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <Primitive
    as="pre"
    data-slot="code-block-content"
    :data-wrap="wrap || undefined"
    dir="ltr"
    tabindex="0"
    :class="cn(
      'px-3 py-3 leading-relaxed group-has-data-[slot=code-block-header]/code-block:pt-2 group-data-[size=sm]/code-block:px-2.5 group-data-[size=sm]/code-block:py-2.5 group-data-[size=sm]/code-block:group-has-data-[slot=code-block-header]/code-block:pt-1.5 min-h-0 min-w-0 scrollbar-thin overflow-auto text-start font-mono outline-none data-wrap:wrap-break-word data-wrap:whitespace-pre-wrap',
      props.class,
    )"
  >
    <Primitive
      as="code"
      data-slot="code-block-code"
      class="grid min-h-lh min-w-max content-start in-data-wrap:min-w-0"
    >
      <slot />
    </Primitive>
  </Primitive>
</template>

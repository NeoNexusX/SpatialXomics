<script setup lang="ts">
import type { VNode } from "vue"
import { Comment, Fragment, Text, useSlots } from "vue"

const slots = useSlots()

function hasContent(nodes: VNode[]): boolean {
  return nodes.some((node) => {
    if (node.type === Comment)
      return false
    if (node.type === Text)
      return node.children !== ""
    if (node.type === Fragment)
      return Array.isArray(node.children) && hasContent(node.children as VNode[])
    return true
  })
}

// An empty line holds a newline so copying a selection keeps blank lines.
function isEmpty() {
  return !hasContent(slots.default?.() ?? [])
}
</script>

<template>
  <span
    data-slot="code-block-line"
    class="-mx-3 px-3 group-data-[size=sm]/code-block:-mx-2.5 group-data-[size=sm]/code-block:px-2.5 relative block min-h-lh"
  ><span data-slot="code-block-line-content" class="min-w-0"><template v-if="isEmpty()">{{ "\n" }}</template><slot v-else /></span></span>
</template>

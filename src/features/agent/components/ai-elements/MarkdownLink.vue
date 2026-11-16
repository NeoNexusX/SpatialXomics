<script setup lang="ts">
/** External Markdown sources render as Inline Citation; local links retain normal navigation. */
import { computed } from 'vue'
import InlineCitation from './InlineCitation.vue'

const props = defineProps<{ href?: string; title?: string }>()
const source = computed(() => {
  if (!props.href || !/^https?:\/\//i.test(props.href)) return undefined
  try {
    const url = new URL(props.href)
    if (!url.hostname || url.username || url.password) return undefined
    return url.href
  } catch {
    return undefined
  }
})
const safeHref = computed(() => {
  if (!props.href) return undefined
  try {
    const url = new URL(props.href, window.location.origin)
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? props.href
      : undefined
  } catch {
    return undefined
  }
})
</script>

<template>
  <InlineCitation v-if="source" :href="source" :description="title"><slot /></InlineCitation>
  <a
    v-else-if="safeHref"
    :href="safeHref"
    :title="title"
    target="_blank"
    rel="noopener noreferrer"
    class="text-(--sxo-accent) underline underline-offset-2"
    ><slot
  /></a>
  <span v-else><slot /></span>
</template>

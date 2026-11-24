<script setup lang="ts">
/** Render only session-artifact image references resolved by the active conversation. */
import { inject, onMounted, ref, watch } from 'vue'
import { t } from '@/i18n'
import type { FigureResolver } from './figureResolver'
import { FIGURE_RESOLVER } from './figureResolver'
const props = defineProps<{ src?: string; alt?: string; title?: string }>()
const resolver = inject(FIGURE_RESOLVER)
const resolve: FigureResolver | undefined = typeof resolver === 'function' ? resolver : undefined
const resolved = ref<string>()
const pending = ref(false)
// 句柄是清单给的 `fig-N`；也放行 UUID 及其前缀（模型把长 id 抄截断时的兜底），
// 具体认不认由 resolver 判断。
const isSessionArtifact = () =>
  /^session-artifact:(fig-\d{1,4}|[0-9a-f-]{8,36})$/i.exec(props.src ?? '')

// src 变化时旧的解析可能还在飞：没有代际守卫的话，慢的那个后回来会把 resolved
// 覆盖成上一张图，且再也不会纠正。
let generation = 0

async function load(): Promise<void> {
  const ticket = ++generation
  resolved.value = undefined
  const match = isSessionArtifact()
  if (!match || !resolve) {
    pending.value = false
    return
  }
  pending.value = true
  try {
    const value = await resolve(match[1]!)
    if (ticket === generation) resolved.value = value
  } finally {
    if (ticket === generation) pending.value = false
  }
}

onMounted(load)
watch(
  () => props.src,
  () => void load(),
)
</script>

<template>
  <figure v-if="isSessionArtifact()" class="my-3 w-full">
    <img
      v-if="resolved"
      :src="resolved"
      :alt="alt ?? ''"
      :title="title"
      class="mx-auto block h-auto w-full max-w-[25%] rounded-md"
    />
    <span v-else-if="pending" class="text-sm text-muted-foreground">{{
      t('common.agent.figureLoading')
    }}</span>
    <span v-else class="text-sm text-muted-foreground">
      {{ t('common.agent.figureUnavailable') }}
    </span>
    <figcaption v-if="alt" class="mt-1 text-center text-xs text-muted-foreground">
      {{ alt }}
    </figcaption>
  </figure>
  <img
    v-else-if="src && /^https?:\/\//i.test(src)"
    :src="src"
    :alt="alt ?? ''"
    :title="title"
    class="max-w-full rounded-md"
  />
  <span v-else>{{ alt ?? t('common.agent.imageAlt') }}</span>
</template>

<script setup lang="ts">
/** 一段思考。进行中自动展开，结束后收起；用户手动开合过就以用户的选择为准 */
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import { BrainIcon } from '@lucide/vue'
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '../ui/trace'

const props = defineProps<{ text: string; active: boolean }>()

const body = useTemplateRef<HTMLElement>('body')

// 思考内容超过可视高度时，进行中始终显示最新的部分
watch(
  () => props.text,
  async () => {
    if (!props.active) return
    await nextTick()
    if (body.value) body.value.scrollTop = body.value.scrollHeight
  },
)

const userChoice = shallowRef<boolean | null>(null)
const open = computed({
  get: () => userChoice.value ?? props.active,
  set: (value: boolean) => {
    userChoice.value = value
  },
})
</script>

<template>
  <TraceCollapsible v-model:open="open">
    <TraceCollapsibleTrigger>
      <TraceLine :status="active ? 'running' : undefined">
        <TraceIcon><BrainIcon /></TraceIcon>
        <TraceTitle>{{
          active ? $t('common.assistant.thinking') : $t('common.assistant.thought')
        }}</TraceTitle>
      </TraceLine>
    </TraceCollapsibleTrigger>
    <TraceCollapsibleContent class="text-xs">
      <div ref="body" class="max-h-56 overflow-y-auto whitespace-pre-wrap">{{ text }}</div>
    </TraceCollapsibleContent>
  </TraceCollapsible>
</template>

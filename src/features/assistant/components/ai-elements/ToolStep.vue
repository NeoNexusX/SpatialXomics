<script setup lang="ts">
/** 一次工具调用：一行显示工具名和入参，展开看完整入参和结果 */
import { computed } from 'vue'
import { CheckIcon, CircleSlashIcon, XIcon } from '@lucide/vue'
import type { UiPart } from '../../agenttypes/assistant'
import { CodeBlock, CodeBlockContent } from '../ui/code-block'
import { Spinner } from '../ui/spinner'
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '../ui/trace'

const props = defineProps<{ part: Extract<UiPart, { type: 'tool' }> }>()

const entries = computed(() => Object.entries((props.part.input ?? {}) as Record<string, unknown>))

const inputSummary = computed(() =>
  entries.value
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(', '),
)
const inputJson = computed(() => JSON.stringify(props.part.input, null, 2))

const lineStatus = computed(() => {
  if (props.part.state === 'running') return 'running'
  return props.part.state === 'error' ? 'error' : undefined
})
</script>

<template>
  <TraceCollapsible>
    <TraceCollapsibleTrigger class="w-full">
      <TraceLine :status="lineStatus">
        <TraceIcon>
          <Spinner v-if="part.state === 'running'" />
          <XIcon v-else-if="part.state === 'error'" />
          <CircleSlashIcon v-else-if="part.state === 'stopped'" />
          <CheckIcon v-else />
        </TraceIcon>
        <TraceTitle class="shrink-0">{{ part.name }}</TraceTitle>
        <TraceDescription v-if="inputSummary" class="min-w-0 shrink truncate">{{
          inputSummary
        }}</TraceDescription>
      </TraceLine>
    </TraceCollapsibleTrigger>
    <TraceCollapsibleContent class="space-y-1.5">
      <CodeBlock v-if="entries.length > 0" size="sm">
        <CodeBlockContent wrap>{{ inputJson }}</CodeBlockContent>
      </CodeBlock>
      <CodeBlock
        v-if="part.preview"
        size="sm"
        :variant="part.state === 'error' ? 'destructive' : 'default'"
      >
        <CodeBlockContent wrap class="max-h-48 overflow-y-auto">{{
          part.preview
        }}</CodeBlockContent>
      </CodeBlock>
    </TraceCollapsibleContent>
  </TraceCollapsible>
</template>

<script setup lang="ts">
/**
 * 助手的一个回合：思考、工具调用和正文按实际发生的顺序排列。
 * 连续的思考和工具调用归成一组步骤，正文不加气泡。
 */
import { computed } from 'vue'
import { RotateCcwIcon } from '@lucide/vue'
import type { UiChatItem, UiPart } from '../../plugins/session-transcript'
import { totalInputTokens } from '../../plugins/llm'
import AgentMarkdown from '../ai-elements/AgentMarkdown.vue'
import CopyButton from '../ai-elements/CopyButton.vue'
import IconButton from '../ai-elements/IconButton.vue'
import ReasoningStep from '../ai-elements/ReasoningStep.vue'
import ToolStep from '../ai-elements/ToolStep.vue'
import WorkingStep from '../ai-elements/WorkingStep.vue'
import { Message, MessageContent, MessageFooter } from '../ui/message'
import { Trace } from '../ui/trace'

type StepPart = Exclude<UiPart, { type: 'text' }>
type Block = { kind: 'steps'; parts: StepPart[] } | { kind: 'text'; text: string }

const props = defineProps<{ message: UiChatItem; canRetry: boolean }>()
const emit = defineEmits<{ retry: [] }>()

const blocks = computed<Block[]>(() => {
  const result: Block[] = []
  for (const part of props.message.parts ?? []) {
    if (part.type === 'text') {
      result.push({ kind: 'text', text: part.text })
      continue
    }
    const last = result[result.length - 1]
    if (last?.kind === 'steps') last.parts.push(part)
    else result.push({ kind: 'steps', parts: [part] })
  }
  return result
})

/** 模型正在处理但界面上还没有东西在动：刚发出请求，或工具跑完等下一步 */
const waiting = computed(() => {
  if (!props.message.pending) return false
  const last = props.message.parts?.[props.message.parts.length - 1]
  if (!last) return true
  return last.type === 'tool' && last.state !== 'running'
})

const compactCount = (count: number) =>
  count >= 1000 ? `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(count)

/** 这个回合用掉的 token：输入 / 输出 */
const usage = computed(() => {
  const { usage: total } = props.message
  if (!total) return null
  const input = totalInputTokens(total)
  return {
    text: `${compactCount(input)} / ${compactCount(total.outputTokens)}`,
    input: input.toLocaleString(),
    cached: (total.cacheReadTokens ?? 0).toLocaleString(),
    output: total.outputTokens.toLocaleString(),
  }
})
</script>

<template>
  <Message>
    <MessageContent class="gap-2">
      <template v-for="(block, index) in blocks" :key="index">
        <Trace v-if="block.kind === 'steps'" class="gap-0.5">
          <template v-for="(part, partIndex) in block.parts" :key="partIndex">
            <ReasoningStep
              v-if="part.type === 'reasoning'"
              :text="part.text"
              :active="part.active"
            />
            <ToolStep v-else :part="part" />
          </template>
        </Trace>
        <AgentMarkdown
          v-else
          :text="block.text"
          :streaming="message.pending && index === blocks.length - 1"
        />
      </template>

      <WorkingStep v-if="waiting" :retrying="message.retrying" />

      <p v-if="message.interrupted" class="kawaru-text-62 text-(--sxo-label-3)">
        {{ $t('common.agent.stopped') }}
      </p>

      <div v-if="message.error" class="kawaru-text-68 flex items-start gap-2">
        <span class="mt-[0.45em] size-2 shrink-0 rounded-full bg-error"></span>
        <p class="min-w-0 wrap-anywhere text-(--sxo-label-2)">{{ message.error }}</p>
      </div>

      <MessageFooter
        v-if="!message.pending && (message.content || canRetry)"
        class="-ml-1 gap-0.5 px-0 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100 has-data-[always=true]:opacity-100"
      >
        <CopyButton v-if="message.content" :text="message.content" />
        <IconButton
          v-if="canRetry"
          size="icon-xs"
          :data-always="!!message.error"
          :label="$t('common.action.retry')"
          @click="emit('retry')"
        >
          <RotateCcwIcon />
        </IconButton>
        <span
          v-if="usage"
          class="ml-1 tabular-nums"
          :title="
            $t('common.agent.usage', {
              input: usage.input,
              cached: usage.cached,
              output: usage.output,
            })
          "
        >
          {{ usage.text }}
        </span>
      </MessageFooter>
    </MessageContent>
  </Message>
</template>

<script setup lang="ts">
/**
 * 上下文用量。触发按钮是输入框里的百分比胶囊，点开看到会话累计消耗；
 * 上下文压缩也收在这块面板里，不再单独占输入框上方的一行。
 */
import { computed, shallowRef } from 'vue'
import { ChevronUpIcon, Minimize2Icon } from '@lucide/vue'
import { totalInputTokens, type TokenUsage } from '../../plugins/llm'
import { Button } from '../ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Progress } from '../ui/progress'

const props = defineProps<{
  used: number
  limit: number
  tokenUsage?: TokenUsage
  /** 有对话才有可压缩的内容 */
  canCompact?: boolean
  compactDisabled?: boolean
  /** false 表示最近一次读数锚定了 provider usage */
  estimated?: boolean
}>()

const emit = defineEmits<{ compact: [] }>()

const open = shallowRef(false)

const percent = computed(() => {
  if (props.limit <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((props.used / props.limit) * 100)))
})

const formattedUsed = computed(
  () => `${props.estimated === false ? '' : '≈ '}${props.used.toLocaleString()}`,
)
const formattedLimit = computed(() => props.limit.toLocaleString())
const formattedInputUsage = computed(() =>
  props.tokenUsage ? totalInputTokens(props.tokenUsage).toLocaleString() : '—',
)
const formattedOutputUsage = computed(() => props.tokenUsage?.outputTokens.toLocaleString() ?? '—')

/** 压缩期间面板没有可看的东西，点完直接收起，进度由消息列表反馈 */
function onCompact(): void {
  open.value = false
  emit('compact')
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        type="button"
        variant="outline"
        size="xs"
        class="h-7 gap-1 rounded-full px-2 tabular-nums"
        :aria-label="
          $t('common.agent.context.used', { used: formattedUsed, limit: formattedLimit })
        "
      >
        {{ percent }}%
        <ChevronUpIcon
          class="size-3 text-(--sxo-label-3) transition-transform duration-150"
          :class="{ 'rotate-180': open }"
        />
      </Button>
    </PopoverTrigger>
    <PopoverContent
      side="top"
      align="end"
      :side-offset="8"
      class="agent-scope z-[10001] w-72"
      :aria-label="$t('common.agent.context.title')"
    >
      <div class="flex items-baseline justify-between gap-3">
        <span class="text-sm font-medium">{{ $t('common.agent.context.title') }}</span>
        <span class="text-right text-xs text-muted-foreground tabular-nums">
          {{ $t('common.agent.context.used', { used: formattedUsed, limit: formattedLimit }) }}
        </span>
      </div>

      <Progress
        :model-value="percent"
        class="mt-2.5 h-1.5 rounded-full bg-muted"
        :aria-label="$t('common.agent.context.title')"
      />

      <div v-if="tokenUsage" class="mt-4">
        <p class="mb-2 text-[11px] text-muted-foreground">
          {{ $t('common.agent.context.sessionTokens') }}
        </p>
        <dl class="space-y-1.5 text-xs">
          <div class="flex items-baseline justify-between gap-4">
            <dt class="text-muted-foreground">{{ $t('common.agent.context.inputUsed') }}</dt>
            <dd class="font-medium tabular-nums">{{ formattedInputUsage }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-4">
            <dt class="text-muted-foreground">{{ $t('common.agent.context.outputUsed') }}</dt>
            <dd class="font-medium tabular-nums">{{ formattedOutputUsage }}</dd>
          </div>
        </dl>
      </div>

      <div v-if="canCompact" class="mt-3 border-t pt-1.5">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          class="h-8 w-full justify-start gap-2 rounded-lg px-2 font-normal"
          :disabled="compactDisabled"
          @click="onCompact"
        >
          <Minimize2Icon class="size-3.5 shrink-0 text-(--sxo-label-3)" />
          {{ $t('common.agent.compactNow') }}
        </Button>
      </div>
    </PopoverContent>
  </Popover>
</template>

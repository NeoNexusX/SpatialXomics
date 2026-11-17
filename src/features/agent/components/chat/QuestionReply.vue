<script setup lang="ts">
/**
 * 已回答的提问：右对齐的用户样式气泡，逐题列出问题和回答。
 * 选中的选项按界面语言的分隔符连成一行（「皮层、海马」/「Cortex, Hippocampus」），自由文本另起一行。
 * 自动填入的回答标「默认」，到点自动提交的整批在气泡下说明。
 */
import { computed } from 'vue'
import { parseRecommendedLabel, type QuestionRecord } from '../../plugins/user-questions'
import { Bubble, BubbleContent } from '../ui/bubble'

const props = defineProps<{ record: QuestionRecord }>()

const rows = computed(() =>
  props.record.questions.map((question) => {
    const answer = props.record.answers?.find((item) => item.id === question.id)
    return {
      id: question.id,
      question: question.question,
      selected: (answer?.selected ?? []).map((label) => parseRecommendedLabel(label).label),
      custom: answer?.custom ?? '',
      auto: !!answer?.auto,
    }
  }),
)
</script>

<template>
  <div class="flex max-w-[90%] min-w-0 flex-col items-end gap-1 self-end">
    <Bubble class="max-w-full">
      <BubbleContent class="rounded-[20px] px-4 py-2.5">
        <dl class="space-y-2.5">
          <div v-for="row in rows" :key="row.id">
            <dt class="kawaru-text-62 wrap-anywhere whitespace-pre-wrap text-(--sxo-label-3)">
              {{ row.question }}
            </dt>
            <dd class="mt-0.5 wrap-anywhere">
              <span v-if="row.selected.length">{{
                row.selected.join($t('common.agent.question.separator'))
              }}</span>
              <span v-if="row.custom" class="block whitespace-pre-wrap">{{ row.custom }}</span>
              <span v-if="!row.selected.length && !row.custom" class="text-(--sxo-label-3)">
                {{ $t('common.agent.question.skipped') }}
              </span>
              <span
                v-if="row.auto"
                class="kawaru-text-56 ml-1.5 rounded-full bg-viridis-ink/12 px-1.5 py-px font-medium whitespace-nowrap text-viridis-ink"
              >
                {{ $t('common.agent.question.auto') }}
              </span>
            </dd>
          </div>
        </dl>
      </BubbleContent>
    </Bubble>
    <p v-if="record.timedOut" class="kawaru-text-56 text-(--sxo-label-3)">
      {{ $t('common.agent.question.timedOut') }}
    </p>
  </div>
</template>

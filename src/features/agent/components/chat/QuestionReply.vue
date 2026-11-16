<script setup lang="ts">
/**
 * 已回答的提问：右对齐的用户样式气泡，逐题列出问题和回答。
 * 自动填入的回答标「默认」，到点自动提交的整批在气泡下说明。
 */
import { computed } from 'vue'
import { parseRecommendedLabel, type QuestionRecord } from '../../plugins/user-questions'
import { Bubble, BubbleContent } from '../ui/bubble'

const props = defineProps<{ record: QuestionRecord }>()

const rows = computed(() =>
  props.record.questions.map((question) => {
    const answer = props.record.answers?.find((item) => item.id === question.id)
    const values = [
      ...(answer?.selected ?? []).map((label) => parseRecommendedLabel(label).label),
      ...(answer?.custom ? [answer.custom] : []),
    ]
    return { id: question.id, question: question.question, values, auto: !!answer?.auto }
  }),
)
</script>

<template>
  <div class="flex min-w-0 max-w-[90%] flex-col items-end gap-1 self-end">
    <Bubble class="max-w-full">
      <BubbleContent class="rounded-[20px] px-4 py-3">
        <dl class="space-y-3">
          <div v-for="row in rows" :key="row.id">
            <dt
              class="kawaru-text-62 leading-relaxed wrap-anywhere whitespace-pre-wrap text-(--sxo-label-3)"
            >
              {{ row.question }}
            </dt>
            <dd class="mt-1 leading-relaxed wrap-anywhere whitespace-pre-wrap">
              <template v-if="row.values.length">{{ row.values.join(', ') }}</template>
              <span v-else class="text-(--sxo-label-3)">{{
                $t('common.agent.question.skipped')
              }}</span>
              <span
                v-if="row.auto"
                class="kawaru-text-62 ml-1.5 rounded-md bg-viridis-ink/10 px-1.5 py-0.5 whitespace-nowrap text-viridis-ink"
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

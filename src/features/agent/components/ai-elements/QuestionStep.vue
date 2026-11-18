<script setup lang="ts">
/** 还没有回答的提问：等待中显示「待回答」，这一轮结束时还没答显示「未回答」 */
import { MessageCircleQuestionMarkIcon } from '@lucide/vue'
import type { QuestionRecord } from '../../plugins/user-questions'
import { TraceDescription, TraceIcon, TraceLine, TraceTitle } from '../ui/trace'

defineProps<{ record: QuestionRecord }>()
</script>

<template>
  <TraceLine :status="record.state === 'waiting' ? 'running' : undefined">
    <TraceIcon><MessageCircleQuestionMarkIcon /></TraceIcon>
    <TraceTitle>{{ record.questions[0]!.header ?? record.questions[0]!.question }}</TraceTitle>
    <TraceDescription v-if="record.state === 'waiting'">
      {{ $t('common.agent.question.waiting') }}
    </TraceDescription>
    <TraceDescription v-else>{{ $t('common.agent.question.unanswered') }}</TraceDescription>
  </TraceLine>
</template>

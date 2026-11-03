<script setup lang="ts">
/** 模型正在处理、界面上还没有内容在更新时显示的一行 */
import { Spinner } from '../ui/spinner'
import { TraceIcon, TraceLine, TraceTitle } from '../ui/trace'

defineProps<{ retrying?: { retry: number; maxRetries: number } }>()
</script>

<template>
  <TraceLine status="running">
    <TraceIcon><Spinner /></TraceIcon>
    <TraceTitle>
      {{
        retrying
          ? $t('common.agent.retrying', { retry: retrying.retry, max: retrying.maxRetries })
          : $t('common.agent.working')
      }}
    </TraceTitle>
  </TraceLine>
</template>

<template>
  <!-- 顶部条：数据集上下文徽标 + 清空历史 -->
  <div class="flex items-center justify-between shrink-0 px-3 pt-2">
    <span
      v-if="hasContext"
      class="badge badge-primary badge-sm gap-1 kawaru-text-50"
      :title="$t('common.assistant.contextTooltip')"
    >
      <span class="w-1.5 h-1.5 rounded-full bg-primary-content"></span>
      {{ $t('common.assistant.contextOn') }}
    </span>
    <span v-else class="badge badge-ghost badge-sm kawaru-text-50 text-base-content/40">{{
      $t('common.assistant.contextOff')
    }}</span>
    <button
      v-if="messageCount > 0"
      class="btn btn-xs btn-ghost btn-square"
      :title="$t('common.assistant.clearHistory')"
      @click="$emit('clear')"
    >
      <svg-icon type="trash" class="w-4 h-4" />
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  hasContext: boolean
  messageCount: number
}>()

defineEmits<{ clear: [] }>()
</script>

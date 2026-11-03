<script setup lang="ts">
/** 复制按钮：复制成功后短暂显示对勾 */
import { CheckIcon, CopyIcon } from '@lucide/vue'
import { useClipboard } from '@vueuse/core'
import IconButton from './IconButton.vue'

defineProps<{ text: string }>()

const { copy, copied } = useClipboard({ copiedDuring: 1500, legacy: true })
</script>

<template>
  <IconButton size="icon-xs" :label="$t('common.action.copy')" @click="copy(text)">
    <CheckIcon v-if="copied" />
    <CopyIcon v-else />
  </IconButton>
</template>

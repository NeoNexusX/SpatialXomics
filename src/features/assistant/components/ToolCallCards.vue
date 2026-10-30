<template>
  <!-- 工具调用折叠卡：可展开查看每次工具调用的返回摘要 -->
  <div v-if="(message.toolCalls?.length ?? 0) > 0" class="mb-1.5 space-y-1">
    <div
      v-for="(t, i) in message.toolCalls"
      :key="i"
      class="border border-base-300 rounded-lg kawaru-text-62 overflow-hidden"
    >
      <button
        class="w-full flex items-center gap-1.5 px-2 py-1 text-left bg-base-200/60 hover:bg-base-200"
        @click="toggle(i)"
      >
        <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="t.isError ? 'bg-error' : 'bg-success'"></span>
        <span class="font-mono text-base-content/70 truncate">{{ t.name }}</span>
        <svg-icon
          :type="expanded.has(i) ? 'chevron_down' : 'chevron_right'"
          class="ml-auto w-3.5 h-3.5 shrink-0 text-base-content/40"
        />
      </button>
      <div
        v-if="expanded.has(i)"
        class="px-2 py-1.5 text-base-content/60 whitespace-pre-wrap break-words bg-base-100 border-t border-base-300 max-h-32 overflow-y-auto"
      >
        {{ t.preview }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import type { UiChatItem } from '../agenttypes/assistant'

defineProps<{ message: UiChatItem }>()

const expanded = reactive<Set<number>>(new Set())
function toggle(i: number) {
  if (expanded.has(i)) expanded.delete(i)
  else expanded.add(i)
}
</script>

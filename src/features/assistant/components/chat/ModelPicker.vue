<script setup lang="ts">
/** 输入框里的模型选择器：在通过测试的模型之间切换，也是连接设置的入口 */
import { computed } from 'vue'
import { CheckIcon, ChevronDownIcon, Settings2Icon } from '@lucide/vue'
import { endpointKey } from '../../agentconfig/connectionConfig'
import { useConnection } from '../../composables/useConnection'
import { useModelCatalog } from '../../composables/useModelCatalog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

const emit = defineEmits<{ openConnection: [] }>()

const { active, selectModel } = useConnection()
const { snapshot, available } = useModelCatalog()

/** 目录可能正停在连接设置里还没保存的端点上，那份结果不能拿来切换当前连接 */
const choices = computed(() => {
  const connection = active.value
  if (!connection) return []
  return snapshot.value.key === endpointKey(connection) ? available.value : [connection.model]
})
</script>

<template>
  <DropdownMenu :modal="false">
    <DropdownMenuTrigger
      class="kawaru-text-62 flex h-7 max-w-52 min-w-0 cursor-pointer items-center gap-1 rounded-full pr-1 pl-2 font-medium text-(--sxo-label-2) outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span class="truncate">{{
        active?.model ?? $t('common.assistant.connection.chooseModel')
      }}</span>
      <ChevronDownIcon class="size-3.5 shrink-0 text-(--sxo-label-3)" />
    </DropdownMenuTrigger>
    <DropdownMenuContent
      side="top"
      align="start"
      class="assistant-scope z-[10001] max-h-72 min-w-52 rounded-xl p-1"
    >
      <DropdownMenuItem
        v-for="model in choices"
        :key="model"
        class="min-h-9 rounded-[10px] px-2.5"
        @select="selectModel(model)"
      >
        <span class="min-w-0 flex-1 truncate">{{ model }}</span>
        <CheckIcon v-if="model === active?.model" class="size-4 shrink-0" />
      </DropdownMenuItem>
      <DropdownMenuSeparator v-if="choices.length > 0" />
      <DropdownMenuItem class="min-h-9 rounded-[10px] px-2.5" @select="emit('openConnection')">
        <Settings2Icon class="size-4 shrink-0" />
        {{ $t('common.assistant.connection.title') }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

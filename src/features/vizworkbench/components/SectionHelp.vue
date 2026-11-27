<script setup lang="ts">
/**
 * 放在标题或参数标签旁，点击展开说明，正文放在默认插槽。
 * 弹层挂到 body，避免侧栏 overflow-hidden 和滚动容器裁剪；class 等属性落在按钮上。
 */
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import SvgIcon from '@/shared/components/SvgIcon.vue'

defineOptions({ inheritAttrs: false })

defineProps<{ label: string }>()
</script>

<template>
  <PopoverRoot>
    <PopoverTrigger
      v-bind="$attrs"
      class="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center self-center rounded-full text-base-content/60 transition-colors outline-none hover:text-base-content focus-visible:ring-2 focus-visible:ring-primary/60 data-[state=open]:text-primary"
      :aria-label="$t('vizworkbench.helpFor', { label })"
    >
      <SvgIcon type="info" class="h-4 w-4" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        :aria-label="label"
        side="bottom"
        align="start"
        :side-offset="4"
        :collision-padding="8"
        hide-when-detached
        class="z-[1000] max-h-[var(--reka-popover-content-available-height)] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-box border border-base-content/20 bg-base-100 p-3 text-base-content shadow-lg outline-none kawaru-text-68"
      >
        <div class="mb-1 font-medium">{{ label }}</div>
        <div class="text-base-content/80">
          <slot />
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

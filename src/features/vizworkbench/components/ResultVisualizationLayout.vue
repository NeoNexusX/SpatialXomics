<script setup lang="ts">
import { shallowRef } from 'vue'
import CollapsibleSidePanel from './CollapsibleSidePanel.vue'

withDefaults(
  defineProps<{
    /** 左侧面板（Annotation）是否收起；收起时左列不占弹性份额，中列占满 */
    leftPanelCollapsed?: boolean
  }>(),
  {
    leftPanelCollapsed: false,
  },
)

const rightPanelExpanded = shallowRef(false)
</script>

<template>
  <div class="result-page flex flex-col bg-base-100 lg:h-[100dvh] lg:overflow-hidden">
    <div
      class="flex min-h-0 flex-1 flex-col gap-1 px-1 pb-2 pt-2 lg:flex-row lg:gap-6 lg:overflow-hidden lg:px-6"
    >
      <!-- 展开的左列至少 24rem：注释库的两个导入按钮（Choose CSV / 平台库）需要约
           210px 的控件宽度才能同排（实测 EN 210px、ZH 197px），低于此宽度标签列
           占位后控件区不够、按钮会换行。16rem 时控件会掉到标签下方（207px）仍差
           几像素，22rem 反而因改为左右排而更窄（182px）——24rem 是实测的可靠阈值。 -->
      <div
        :class="[
          'kawaru-text-75 w-full scrollbar-thin lg:h-full lg:min-h-0 lg:min-w-0 lg:self-stretch lg:overflow-y-auto',
          leftPanelCollapsed ? 'lg:flex-none lg:w-auto' : 'lg:min-w-96 lg:flex-[1_1_0%]',
        ]"
      >
        <slot name="left-panel"></slot>
      </div>

      <!-- 中列 -->
      <div
        class="kawaru-text-75 flex min-w-0 flex-col gap-2 no-scrollbar lg:h-full lg:min-h-0 lg:flex-[3_1_0%] lg:overflow-y-auto"
      >
        <div
          class="contents lg:flex lg:min-h-0 lg:flex-none lg:flex-col lg:gap-2 lg:h-[calc(100%_-_3.5rem)]"
        >
          <slot name="viz"></slot>
        </div>
        <!-- Compare uses its natural height. Collapsed it is a 2.5rem rail;
             expanded content extends the middle column's scroll area without
             resizing the viewport-sized visualization section above it. -->
        <div class="contents lg:block lg:shrink-0">
          <slot name="compare"></slot>
        </div>
      </div>
      <CollapsibleSidePanel
        v-model:expanded="rightPanelExpanded"
        side="right"
        :title="$t('vizworkbench.panel.title')"
        :expand-label="$t('vizworkbench.panel.expand')"
        :collapse-label="$t('vizworkbench.panel.collapse')"
        class="kawaru-text-75"
        :class="{ 'lg:flex-[1_1_0%] lg:max-w-[340px]': rightPanelExpanded }"
        content-class="overflow-x-hidden px-3 pb-4 scrollbar-thin lg:overflow-y-auto"
      >
        <slot name="side-panel" />
      </CollapsibleSidePanel>
    </div>
  </div>
</template>

<style scoped>
/* 三栏挂 kawaru-text-75（工作台正文锚点，12.2px@390 / 15.0px@1320+）的唯一作用：
   给栏内「没自带字号类」的 em 布局盒子（VizInfoPanel 的 w-[2em]/w-[4em]/h-[5em]、
   IonImageSection 的 w-[3em] 等）一个确定的继承参照。文字字号都是绝对档位，不靠这层。 */

.result-page :deep(.btn-ghost) {
  border-color: color-mix(in oklch, var(--color-base-content) 25%, transparent);
}
</style>

<script setup lang="ts">
withDefaults(
  defineProps<{
    /** 左侧面板（Annotation）是否收起；收起时左列不占弹性份额，中列占满 */
    leftPanelCollapsed?: boolean
  }>(),
  {
    leftPanelCollapsed: false,
  },
)
</script>

<template>
  <div class="result-page flex flex-col bg-base-100 lg:h-[100dvh] lg:overflow-hidden">
    <div
      class="flex min-h-0 flex-1 flex-col gap-1 px-1 pb-2 pt-2 lg:flex-row lg:gap-6 lg:overflow-hidden lg:px-6"
    >
      <!-- 展开的左列至少 16rem，保证容差和空间计算的整组控件能放在同一行。 -->
      <div
        :class="[
          'kawaru-text-75 w-full scrollbar-thin lg:h-full lg:min-h-0 lg:min-w-0 lg:self-stretch lg:overflow-y-auto',
          leftPanelCollapsed ? 'lg:flex-none lg:w-auto' : 'lg:min-w-64 lg:flex-[1_1_0%]',
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
      <!-- 右列：桌面下是弹性列（1 份）、封顶 340px，内部字号/图标用 em 等比缩放 -->
      <div
        class="kawaru-text-75 w-full scrollbar-thin lg:min-w-0 lg:flex-[1_1_0%] lg:max-w-[340px] lg:min-h-0 lg:overflow-y-auto"
      >
        <slot name="side-panel"></slot>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 三栏挂 kawaru-text-75（工作台正文锚点，12.2px@390 / 15.0px@1320+）的唯一作用：
   给栏内「没自带字号类」的 em 布局盒子（VizInfoPanel 的 w-[2em]/w-[4em]/h-[5em]、
   IonImageSection 的 w-[3em] 等）一个确定的继承参照。文字字号都是绝对档位，不靠这层。 */

/* 给本页原本透明的 ghost 按钮补一道自适应细边框，使其与 New/Confirm 等实心按钮
   一样具备清晰轮廓（亮色模式深边、暗色模式浅边）。DaisyUI 的 .btn-ghost 只是把
   --btn-border 设成 #0000，边框本身一直在；真正读取它的只有 .btn 里的
   border-color: var(--btn-border)，所以这里覆盖 border-color 一次即可覆盖全部
   状态（hover / focus-visible / active）。已有边框的 outline / filled 按钮、
   带动态彩色边框的 UMAP/KMeans 开关不受影响。
   按钮分布在 AnnotationPanel / OverlayControls 等子组件中，需要 :deep() 才能
   跨过 scoped 样式的组件边界。 */
.result-page :deep(.btn-ghost) {
  border-color: color-mix(in oklch, var(--color-base-content) 25%, transparent);
}
</style>

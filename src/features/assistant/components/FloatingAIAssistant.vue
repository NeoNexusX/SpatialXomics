<template>
  <!-- Draggable chat window -->
  <div
    v-if="isOpen && !isMinimized"
    ref="panelRef"
    class="assistant-scope fixed z-[10000] flex flex-col rounded-2xl shadow-2xl bg-base-100 border border-base-300 overflow-hidden select-none"
    :style="panelStyle"
  >
    <!-- Header -->
    <div
      class="flex items-center justify-between px-4 py-3 bg-base-200 border-b border-base-300 cursor-grab active:cursor-grabbing shrink-0"
      @mousedown="startDrag"
    >
      <div class="flex items-center gap-2">
        <div
          class="w-7 h-7 rounded-lg bg-primary text-primary-content flex items-center justify-center"
        >
          <svg-icon type="sparkles" class="w-4 h-4 text-white" />
        </div>
        <span class="font-semibold kawaru-text-87 text-base-content">{{ $t('common.assistant.title') }}</span>
      </div>
      <div class="flex items-center gap-1">
        <!-- BYOK 设置：自配 API key / 模型；已自定义时点亮 -->
        <button
          class="btn btn-xs btn-ghost btn-square relative"
          :class="{ 'text-primary': showSettings }"
          :title="$t('common.assistant.settings.title')"
          @mousedown.stop
          @click="showSettings = !showSettings"
        >
          <svg-icon type="settings" class="w-4 h-4" />
          <span
            v-if="hasCustom && !showSettings"
            class="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-primary"
          ></span>
        </button>
        <button
          class="btn btn-xs btn-ghost btn-square"
          @click="isMinimized = true"
          :title="$t('common.assistant.minimize')"
        >
          <svg-icon type="minus" class="w-4 h-4" />
        </button>
        <button class="btn btn-xs btn-ghost btn-square" @click="close" :title="$t('common.action.close')">
          <svg-icon type="close" class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- 聊天主体：TDesign 聊天视图（异步 chunk，首开零等待由下方空闲预取保证）；
         BYOK 设置面板打开时整体替换（设置属容器层） -->
    <component :is="chatComponent" v-if="isOpen && !showSettings" />
    <LlmSettingsPanel v-else-if="isOpen" @done="showSettings = false" />

    <!-- Resize handles -->
    <div class="absolute inset-0 pointer-events-none">
      <!-- Edges -->
      <div
        class="absolute top-0 left-2 right-2 h-1.5 cursor-n-resize pointer-events-auto"
        @mousedown.stop="startResize($event, 'n')"
      ></div>
      <div
        class="absolute bottom-0 left-2 right-2 h-1.5 cursor-s-resize pointer-events-auto"
        @mousedown.stop="startResize($event, 's')"
      ></div>
      <div
        class="absolute left-0 top-2 bottom-2 w-1.5 cursor-w-resize pointer-events-auto"
        @mousedown.stop="startResize($event, 'w')"
      ></div>
      <div
        class="absolute right-0 top-2 bottom-2 w-1.5 cursor-e-resize pointer-events-auto"
        @mousedown.stop="startResize($event, 'e')"
      ></div>
      <!-- Corners -->
      <div
        class="absolute top-0 left-0 w-4 h-4 cursor-nw-resize pointer-events-auto"
        @mousedown.stop="startResize($event, 'nw')"
      ></div>
      <div
        class="absolute top-0 right-0 w-4 h-4 cursor-ne-resize pointer-events-auto"
        @mousedown.stop="startResize($event, 'ne')"
      ></div>
      <div
        class="absolute bottom-0 left-0 w-4 h-4 cursor-sw-resize pointer-events-auto"
        @mousedown.stop="startResize($event, 'sw')"
      ></div>
      <div
        class="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize pointer-events-auto"
        @mousedown.stop="startResize($event, 'se')"
      ></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, defineAsyncComponent } from 'vue'
import { useLlmSettings } from '../composables/useLlmSettings'
import LlmSettingsPanel from './LlmSettingsPanel.vue'

const props = defineProps<{ show?: boolean }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

// 聊天视图（TDesign Chat，独立异步 chunk）
const chatComponent = defineAsyncComponent(() => import('./ChatTDesign.vue'))

// BYOK 设置面板（打开时替换聊天主体）
const showSettings = ref(false)
const { hasCustom, hasEnvDefault } = useLlmSettings()

onMounted(() => {
  // 空闲预取：首屏渲染完毕、浏览器空闲时后台静默下载聊天 chunk，
  // 用户点开助手时零等待。defineAsyncComponent 会复用已就绪的模块。
  const idle =
    window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 2000))
  idle(() => {
    void import('./ChatTDesign.vue')
  })
})

const isOpen = ref(false)
const isMinimized = ref(false)

watch(
  () => props.show,
  (v) => {
    if (v) {
      isOpen.value = true
      isMinimized.value = false
      // 既无用户自配也无 env 默认凭据 → 直接落到设置面板，别让用户发消息吃报错
      if (!hasCustom.value && !hasEnvDefault.value) showSettings.value = true
    }
  },
)

function close() {
  isOpen.value = false
  isMinimized.value = false
  emit('update:show', false)
}

// --- Drag logic ---
const MIN_W = 320,
  MIN_H = 400
const panelRef = ref<HTMLElement | null>(null)
const position = reactive({ x: 0, y: 0 })
const size = reactive({ w: 460, h: 620 })
const dragging = reactive({ active: false, startX: 0, startY: 0, origX: 0, origY: 0 })
const resizing = reactive({
  active: false,
  dir: '' as string,
  startX: 0,
  startY: 0,
  origX: 0,
  origY: 0,
  origW: 0,
  origH: 0,
})

// Default: 视口居中
position.x = Math.max(0, (window.innerWidth - size.w) / 2)
position.y = Math.max(0, (window.innerHeight - size.h) / 2)

const panelStyle = computed(() => ({
  width: `${size.w}px`,
  height: `${size.h}px`,
  left: `${position.x}px`,
  top: `${position.y}px`,
}))

function startDrag(e: MouseEvent) {
  dragging.active = true
  dragging.startX = e.clientX
  dragging.startY = e.clientY
  dragging.origX = position.x
  dragging.origY = position.y
  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', stopDrag)
}

function onDrag(e: MouseEvent) {
  if (!dragging.active) return
  position.x = Math.max(
    0,
    Math.min(window.innerWidth - size.w, dragging.origX + e.clientX - dragging.startX),
  )
  position.y = Math.max(
    0,
    Math.min(window.innerHeight - size.h, dragging.origY + e.clientY - dragging.startY),
  )
}

function stopDrag() {
  dragging.active = false
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
}

function startResize(e: MouseEvent, dir: string) {
  resizing.active = true
  resizing.dir = dir
  resizing.startX = e.clientX
  resizing.startY = e.clientY
  resizing.origX = position.x
  resizing.origY = position.y
  resizing.origW = size.w
  resizing.origH = size.h
  document.addEventListener('mousemove', onResize)
  document.addEventListener('mouseup', stopResize)
}

function onResize(e: MouseEvent) {
  if (!resizing.active) return
  const dx = e.clientX - resizing.startX,
    dy = e.clientY - resizing.startY
  let nw = resizing.origW,
    nh = resizing.origH,
    nx = resizing.origX,
    ny = resizing.origY
  if (resizing.dir.includes('e')) nw = Math.max(MIN_W, resizing.origW + dx)
  if (resizing.dir.includes('w')) {
    nw = Math.max(MIN_W, resizing.origW - dx)
    nx = resizing.origX + resizing.origW - nw
  }
  if (resizing.dir.includes('s')) nh = Math.max(MIN_H, resizing.origH + dy)
  if (resizing.dir.includes('n')) {
    nh = Math.max(MIN_H, resizing.origH - dy)
    ny = resizing.origY + resizing.origH - nh
  }
  size.w = nw
  size.h = nh
  position.x = nx
  position.y = ny
}

function stopResize() {
  resizing.active = false
  document.removeEventListener('mousemove', onResize)
  document.removeEventListener('mouseup', stopResize)
}
</script>

<style scoped>
/* ----------------------------------------------------------------------------
   字号/字体统一：面板内 TDesign Chat 组件（输入框、placeholder、reasoning
   面板头、ChatContent 容器等内部渲染的文字）默认用它自己的设计令牌
   （12/14/16/20px + "PingFang SC, Microsoft YaHei, Arial"），完全绕开全局
   kawaru-text 档位与 Poppins 字体栈——这是助手面板文字与主站不统一的根源。

   在面板根上把 --td-font-size-* 映射到 --kawaru-fs 刻度、--td-font-family
   对齐全局 :root 字体栈，自定义属性沿 DOM 树继承，面板内（含聊天体与设置
   面板两个子组件）所有 TDesign 内部文字一次跟随。kawaru 档位只在 :root
   声明 --kawaru-fs、任何地方不得覆盖（见 style.css），这里只消费不重定义。

   ⚠ --td-font-body-* 是 font 简写，其 var() 引用在 :root 定义处即被替换，
   单独覆盖 size token 不会改变已解析的简写——简写必须在此一并重声明。
   ---------------------------------------------------------------------------- */
.assistant-scope {
  --td-font-family:
    'Poppins', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans SC',
    system-ui, sans-serif;
  /* 档位对齐：medium/large 都是聊天正文级 → 同为 87（映射不同会显两种字号） */
  --td-font-size-body-small: calc(var(--kawaru-fs) * 0.75);
  --td-font-size-body-medium: calc(var(--kawaru-fs) * 0.875);
  --td-font-size-body-large: calc(var(--kawaru-fs) * 0.875);
  --td-font-size-title-medium: var(--kawaru-fs);
  --td-font-size-title-large: calc(var(--kawaru-fs) * 1.125);
  --td-font-size-headline-small: calc(var(--kawaru-fs) * 1.5);
  /* font 简写（size / line-height family）；行高沿用 TDesign 比例 */
  --td-font-body-medium: 400 var(--td-font-size-body-medium) /
    var(--td-line-height-body-medium) var(--td-font-family);
  --td-font-body-large: 400 var(--td-font-size-body-large) /
    var(--td-line-height-body-large) var(--td-font-family);
}
</style>

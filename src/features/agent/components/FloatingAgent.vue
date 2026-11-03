<script setup lang="ts">
/**
 * 助手悬浮窗的外壳：只管位置、尺寸和开关。
 * Navbar 静态引用它，所以这里不引用助手的其他代码，聊天和连接设置都在异步 chunk 里。
 */
import { defineAsyncComponent, h, onMounted, watch } from 'vue'
import { t } from '@/i18n'
import { useFloatingWindow, type ResizeDirection } from '../composables/useFloatingWindow'

const show = defineModel<boolean>('show', { default: false })

const loadWorkspace = () => import('./AgentWorkspace.vue')
const AgentWorkspace = defineAsyncComponent({
  loader: loadWorkspace,
  delay: 150,
  loadingComponent: () =>
    h('div', { class: 'flex flex-1 items-center justify-center' }, [
      h('span', { class: 'loading loading-spinner text-primary' }),
    ]),
  // 发布新版本后旧的 chunk 可能已经不在了，刷新页面才能拿到新地址。
  // 标题栏也在这个 chunk 里，加载失败时要在这里提供关闭
  errorComponent: () =>
    h('div', { class: 'flex flex-1 flex-col items-center justify-center gap-3' }, [
      h('p', { class: 'kawaru-text-75 text-base-content/70' }, t('common.feedback.loadFailed', { target: t('common.agent.title') })),
      h('div', { class: 'flex gap-2' }, [
        h(
          'button',
          { type: 'button', class: 'btn btn-sm btn-primary rounded-full', onClick: () => location.reload() },
          t('common.action.refresh'),
        ),
        h(
          'button',
          { type: 'button', class: 'btn btn-sm btn-ghost rounded-full', onClick: () => (show.value = false) },
          t('common.action.close'),
        ),
      ]),
    ]),
})

const { panelStyle, fitToViewport, startDrag, startResize } = useFloatingWindow()

const RESIZE_HANDLES: { direction: ResizeDirection; position: string }[] = [
  { direction: 'n', position: 'top-0 left-2 right-2 h-1.5 cursor-n-resize' },
  { direction: 's', position: 'bottom-0 left-2 right-2 h-1.5 cursor-s-resize' },
  { direction: 'w', position: 'left-0 top-2 bottom-2 w-1.5 cursor-w-resize' },
  { direction: 'e', position: 'right-0 top-2 bottom-2 w-1.5 cursor-e-resize' },
  { direction: 'nw', position: 'top-0 left-0 w-4 h-4 cursor-nw-resize' },
  { direction: 'ne', position: 'top-0 right-0 w-4 h-4 cursor-ne-resize' },
  { direction: 'sw', position: 'bottom-0 left-0 w-4 h-4 cursor-sw-resize' },
  { direction: 'se', position: 'bottom-0 right-0 w-4 h-4 cursor-se-resize' },
]

watch(show, (open) => {
  if (open) fitToViewport()
})

onMounted(() => {
  // 空闲时预取聊天 chunk，用户点开时零等待
  const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 2000))
  // 预取失败不要紧，用户点开时会再加载一次
  idle(() => void loadWorkspace().catch(() => {}))
})
</script>

<template>
  <div
    v-if="show"
    class="agent-scope fixed z-[10000] flex flex-col overflow-hidden rounded-2xl border bg-base-100 text-base-content shadow-2xl"
    role="dialog"
    :aria-label="$t('common.agent.title')"
    :style="panelStyle"
  >
    <AgentWorkspace class="min-h-0 flex-1" @drag-start="startDrag" @close="show = false" />

    <div
      v-for="handle in RESIZE_HANDLES"
      :key="handle.direction"
      class="absolute"
      :class="handle.position"
      @mousedown.stop="startResize($event, handle.direction)"
    ></div>
  </div>
</template>

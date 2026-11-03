/**
 * useFloatingWindow：悬浮面板的位置、尺寸、拖拽和缩放。默认停靠在视口右侧，不挡中间的内容。
 *
 * 属于首屏模块（Navbar 静态引用悬浮窗外壳），不能依赖助手的其他代码。
 */

import { computed, onBeforeUnmount, reactive } from 'vue'

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const MIN_WIDTH = 320
const MIN_HEIGHT = 400
const DEFAULT_WIDTH = 460
const VIEWPORT_MARGIN = 8

export function useFloatingWindow() {
  const rect = reactive({ x: 0, y: 0, width: DEFAULT_WIDTH, height: 0 })

  /** 打开时收进视口：首次停靠右侧，之后保留用户调整过的位置，只在超出时往回移 */
  let placed = false
  function fitToViewport(): void {
    const maxWidth = window.innerWidth - VIEWPORT_MARGIN * 2
    const maxHeight = window.innerHeight - VIEWPORT_MARGIN * 2
    if (!placed) {
      rect.width = Math.min(DEFAULT_WIDTH, maxWidth)
      rect.height = maxHeight
      rect.x = window.innerWidth - rect.width - VIEWPORT_MARGIN
      rect.y = VIEWPORT_MARGIN
      placed = true
      return
    }
    rect.width = Math.min(rect.width, maxWidth)
    rect.height = Math.min(rect.height, maxHeight)
    rect.x = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.x),
      window.innerWidth - rect.width - VIEWPORT_MARGIN,
    )
    rect.y = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.y),
      window.innerHeight - rect.height - VIEWPORT_MARGIN,
    )
  }

  const panelStyle = computed(() => ({
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  }))

  let stopPointer: (() => void) | null = null

  /** 跟踪一次按下到松开的鼠标移动，dx / dy 相对按下时的位置 */
  function trackPointer(event: MouseEvent, onMove: (dx: number, dy: number) => void): void {
    stopPointer?.()
    event.preventDefault()
    const { clientX: startX, clientY: startY } = event
    const move = (e: MouseEvent) => onMove(e.clientX - startX, e.clientY - startY)
    const up = () => stopPointer?.()
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
    stopPointer = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      stopPointer = null
    }
  }

  function startDrag(event: MouseEvent): void {
    const { x, y } = rect
    trackPointer(event, (dx, dy) => {
      rect.x = Math.max(0, Math.min(window.innerWidth - rect.width, x + dx))
      rect.y = Math.max(0, Math.min(window.innerHeight - rect.height, y + dy))
    })
  }

  function startResize(event: MouseEvent, direction: ResizeDirection): void {
    const { x, y, width, height } = rect
    trackPointer(event, (dx, dy) => {
      if (direction.includes('e')) rect.width = Math.max(MIN_WIDTH, width + dx)
      if (direction.includes('w')) {
        rect.width = Math.max(MIN_WIDTH, width - dx)
        rect.x = x + width - rect.width
      }
      if (direction.includes('s')) rect.height = Math.max(MIN_HEIGHT, height + dy)
      if (direction.includes('n')) {
        rect.height = Math.max(MIN_HEIGHT, height - dy)
        rect.y = y + height - rect.height
      }
    })
  }

  onBeforeUnmount(() => stopPointer?.())

  return { panelStyle, fitToViewport, startDrag, startResize }
}

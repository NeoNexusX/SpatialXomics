import { ref, onBeforeUnmount } from 'vue'

export function useZoomPan(
  // Arguments
  containerW: () => number,
  containerH: () => number,
) {
  // State
  const zoom = ref(1)
  const panX = ref(0)
  const panY = ref(0)

  // Track active document listeners so they can be removed on unmount
  let activePanMove: ((e: MouseEvent) => void) | null = null
  let activePanUp: (() => void) | null = null

  // Methods
  function resetZoom() {
    zoom.value = 1
    panX.value = 0
    panY.value = 0
  }

  /**
   * Shared clamp/scale/pan/reset-if-1 logic for zooming anchored at (mx, my)
   * in container coordinates.
   */
  function zoomAt(mx: number, my: number, newZoom: number) {
    const clamped = Math.max(1, Math.min(40, newZoom))
    if (clamped === zoom.value) return
    const scale = clamped / zoom.value
    panX.value = mx - scale * (mx - panX.value)
    panY.value = my - scale * (my - panY.value)
    zoom.value = clamped
    if (zoom.value === 1) {
      panX.value = 0
      panY.value = 0
    }
  }

  function setZoom(newZoom: number) {
    zoomAt(containerW() / 2, containerH() / 2, newZoom)
  }

  function zoomIn() {
    setZoom(zoom.value * 1.5)
  }

  function zoomOut() {
    setZoom(zoom.value / 1.5)
  }

  function onWheel(e: WheelEvent, containerRef: HTMLElement | null) {
    const rect = containerRef?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2
    zoomAt(mx, my, zoom.value * factor)
  }

  function onPanStart(e: MouseEvent) {
    if (zoom.value <= 1 || e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX - panX.value
    const startY = e.clientY - panY.value
    const onMove = (ev: MouseEvent) => {
      panX.value = ev.clientX - startX
      panY.value = ev.clientY - startY
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      activePanMove = null
      activePanUp = null
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    activePanMove = onMove
    activePanUp = onUp
  }

  // Remove any pending pan listeners if the component unmounts mid-drag
  onBeforeUnmount(() => {
    if (activePanMove) document.removeEventListener('mousemove', activePanMove)
    if (activePanUp) document.removeEventListener('mouseup', activePanUp)
  })

  return { zoom, panX, panY, resetZoom, zoomIn, zoomOut, setZoom, onWheel, onPanStart }
}

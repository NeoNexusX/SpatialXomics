import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import { useDebounceFn, usePreferredReducedMotion, useResizeObserver } from '@vueuse/core'
import { gsap, ScrollTrigger } from './gsap'

/**
 * 首页的平滑滚动：Lenis 只在首页存在期间接管 window 滚动，离开首页即销毁。
 * 它跟着 GSAP 的 ticker 走，ScrollTrigger 读到的是同一帧的滚动位置。
 *
 * 另外两件和「首页用 window 滚动」有关的事也在这里：
 * - 进出首页都回到顶部：路由没有 scrollBehavior，不复位就会带着上一页的滚动位置
 * - 页面高度变化（统计数据、字体、图片异步到达）后刷新所有触发点
 */
export function useSmoothScroll(rootRef: Readonly<Ref<HTMLElement | null>>) {
  const reducedMotion = usePreferredReducedMotion()
  let lenis: Lenis | null = null
  const raf = (time: number) => lenis?.raf(time * 1000)

  function stop() {
    gsap.ticker.remove(raf)
    lenis?.destroy()
    lenis = null
  }

  function start() {
    stop()
    if (reducedMotion.value === 'reduce') return
    lenis = new Lenis({
      anchors: true,
      // 助手面板、抽屉菜单、热力图等内部滚动区域保持原生滚动
      allowNestedScroll: true,
      // 抽屉、弹窗打开时 daisyUI 给 <html> 加 overflow: hidden，Lenis 随之暂停，背后的页面不再跟着滚
      autoToggle: true,
    })
    lenis.on('scroll', ScrollTrigger.update)
    gsap.ticker.add(raf)
  }

  useResizeObserver(
    rootRef,
    useDebounceFn(() => ScrollTrigger.refresh(), 200),
  )
  watch(reducedMotion, start)

  onMounted(() => {
    window.scrollTo(0, 0)
    start()
  })

  onBeforeUnmount(() => {
    stop()
    window.scrollTo(0, 0)
  })
}

/**
 * 首页动效的唯一入口：注册插件、统一节奏。
 *
 * GSAP 只有首页在用，首页组件都从这里取：插件只注册一次，各区块的缓动和时长保持一致，
 * 库也只会落进首页的懒加载 chunk。
 */
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import type { InjectionKey } from 'vue'

gsap.registerPlugin(ScrollTrigger, SplitText)

// 移动端地址栏伸缩只改变视口高度，不为此重算所有触发点，否则滚动中途会跳
ScrollTrigger.config({ ignoreMobileResize: true })

// 滚动由 Lenis 跟着 GSAP 的 ticker 走，卡顿后不能补帧追赶，否则滚动位置和动画对不上
gsap.ticker.lagSmoothing(0)

/** 入场节奏：统一 power3.out，错峰按粒度从细到粗 */
export const MOTION = {
  ease: 'power3.out',
  duration: 0.9,
  stagger: { chars: 0.035, lines: 0.09, items: 0.1 },
  /** 元素顶部到达视口 88% 处开始入场 */
  start: 'top 88%',
  media: '(prefers-reduced-motion: no-preference)',
} as const

/** HomeView owns refresh scheduling and cancellation for all descendant animations. */
export const homeMotionRefreshKey: InjectionKey<() => void> = Symbol('home-motion-refresh')

export { gsap, ScrollTrigger, SplitText }

/**
 * 首页的文字入场指令：模板里声明「这块怎么出场」，节奏统一取 MOTION。
 *
 * - v-split-reveal：文字按行（或按字）从遮罩下方升起
 * - v-stagger：直接子元素依次淡入上移
 *
 * 都在元素进入视口时播一次。初始状态在挂载时设置（首帧绘制之前），不靠 CSS 预先隐藏，
 * 脚本出错时内容照样可见。开启「减少动态」时什么都不做。卸载时 revert，切分和内联样式全部还原。
 */
import type { Directive } from 'vue'
import { gsap, MOTION, motionAllowed, SplitText } from './gsap'
import './motion.css'

type RevealOptions = { delay?: number }

const contexts = new WeakMap<Element, gsap.Context>()

function bind(el: Element, setup: () => void) {
  if (motionAllowed()) contexts.set(el, gsap.context(setup))
}

function unbind(el: Element) {
  contexts.get(el)?.revert()
  contexts.delete(el)
}

const onEnter = (trigger: Element) => ({ trigger, start: MOTION.start, once: true })

// 中文没有空格，要在字与字之间断开才能正确分行；拉丁文仍在空格后断开。
// 句末标点不能落到行首、开括号不能留在行尾，所以它们跟着相邻的字走。
const CJK = '\\u2E80-\\u9FFF\\uF900-\\uFAFF\\uFF00-\\uFFEF\\u3000-\\u303F'
const NO_LINE_START = '，。、；：？！）」』】》〉…—～”’'
const NO_LINE_END = '（「『【《〈“‘'
const WORD_DELIMITER = {
  delimiter: new RegExp(
    `(?<= )|(?<=[${CJK}])(?<![${NO_LINE_END}])(?![${NO_LINE_START}])|(?<![${NO_LINE_END}])(?=[${CJK}])(?![${NO_LINE_START}])`,
  ),
  replaceWith: '',
}

/**
 * 文字遮罩揭示。切分后元素内容由 SplitText 接管，Vue 之后改不到它：
 * 文字会变的地方（比如切换语言）要给元素加 `:key="文字"`，让 Vue 整块重建。
 */
export const vSplitReveal: Directive<
  HTMLElement,
  (RevealOptions & { by?: 'lines' | 'chars' }) | undefined
> = {
  mounted(el, { value }) {
    const byChars = value?.by === 'chars'
    bind(el, () => {
      SplitText.create(el, {
        type: byChars ? 'chars,lines' : 'lines',
        mask: 'lines',
        linesClass: 'split-line',
        charsClass: 'split-char',
        wordDelimiter: WORD_DELIMITER,
        // 字体异步加载，换上之后折行会变；重切时 SplitText 会接上原来的动画进度，不会重播
        autoSplit: true,
        onSplit: (self) =>
          gsap.from(byChars ? self.chars : self.lines, {
            // 遮罩向下放宽了 0.3em（见 motion.css），起点要更低才藏得住
            yPercent: 130,
            duration: MOTION.duration,
            ease: MOTION.ease,
            stagger: byChars ? MOTION.stagger.chars : MOTION.stagger.lines,
            delay: value?.delay,
            scrollTrigger: onEnter(el),
          }),
      })
    })
  },
  unmounted: unbind,
}

/** 直接子元素依次淡入上移。挂载之后才渲染出来的子元素（数据异步到达）不参与 */
export const vStagger: Directive<HTMLElement, (RevealOptions & { y?: number }) | undefined> = {
  mounted(el, { value }) {
    if (!el.children.length) return
    bind(el, () => {
      gsap.from(el.children, {
        y: value?.y ?? 32,
        autoAlpha: 0,
        duration: MOTION.duration,
        ease: MOTION.ease,
        stagger: MOTION.stagger.items,
        delay: value?.delay,
        scrollTrigger: onEnter(el),
      })
    })
  },
  unmounted: unbind,
}

import { onBeforeUnmount, onMounted, shallowRef, watch, nextTick, type Ref } from 'vue'
import { gsap, ScrollTrigger } from './gsap'
import { activeStackCard, cardStackLayout } from './cardStackLayout'
import type { HomeSectionContext } from './homeSectionContext'

/** The stack owns card geometry and motion. Its scene provides explicit sticky
 * bounds and flow space, so adding wrappers or card modules cannot break it. */
export function useCardStack(
  root: Readonly<Ref<HTMLElement | null>>,
  keys: () => readonly string[],
  scene?: HomeSectionContext,
) {
  const active = shallowRef(0)
  const enhanced = shallowRef(false)
  let media: gsap.MatchMedia | undefined
  let mounted = false

  function setup() {
    media?.revert()
    const element = root.value
    const panel = scene?.panel.value
    const anchor = scene?.anchor.value
    const viewport = element?.querySelector<HTMLElement>('[data-stack-viewport]')
    const cards = element?.querySelectorAll<HTMLElement>('[data-stack-card]')
    const introElements = scene?.introElements?.() ?? []
    if (!element || !panel || !anchor || !viewport || !cards?.length) return

    media = gsap.matchMedia()
    media.add(
      '(min-width: 1024px) and (min-height: 680px) and (prefers-reduced-motion: no-preference)',
      () => {
        if (cards.length < 2 && !introElements.length) return
        const originalStyles = [...cards, ...introElements].map((target) => ({
          target,
          style: target.getAttribute('style'),
        }))
        // Refresh rebuilds the tweens outside the initial media callback. Keep
        // the original inline styles so a breakpoint change restores normal flow.
        ScrollTrigger.saveStyles([...cards, ...introElements])
        element.setAttribute('data-stacked', '')
        enhanced.value = true
        let layout = cardStackLayout(cards.length, element.clientHeight)
        const timeline = gsap.timeline()
        const stickyTop = () => parseFloat(getComputedStyle(panel).top) || 0

        const measure = () => {
          const localTop = viewport.getBoundingClientRect().top - panel.getBoundingClientRect().top
          const entry = window.innerHeight - stickyTop() - localTop + 24
          const introEntries = introElements.map((target) => {
            // Measure the resting position even when refresh runs halfway through
            // a slide. Every card starts wholly below the same viewport edge.
            const top =
              target.getBoundingClientRect().top -
              panel.getBoundingClientRect().top -
              Number(gsap.getProperty(target, 'y'))
            return window.innerHeight - stickyTop() - top + 24
          })
          layout = cardStackLayout(cards.length, element.clientHeight, entry, introEntries)
          element.style.setProperty('--stack-trail', `${layout.trail}px`)
          const clearance = Math.max(0, window.innerHeight - stickyTop() - panel.offsetHeight)
          scene?.setDwell(layout.dwell + clearance)

          // Resize changes both landing positions and phase lengths. Rebuild the
          // timeline rather than invalidating transforms with stale timings.
          timeline.clear()
          for (const phase of layout.introPhases) {
            timeline.fromTo(
              introElements[phase.index]!,
              { y: phase.entry },
              {
                y: 0,
                duration: phase.end - phase.start,
                ease: 'none',
                immediateRender: true,
              },
              phase.start,
            )
          }
          if (layout.firstEntrance) {
            timeline.fromTo(
              cards[0]!,
              { y: layout.entry },
              {
                y: 0,
                duration: layout.firstEntrance.end - layout.firstEntrance.start,
                ease: 'none',
                immediateRender: true,
              },
              layout.firstEntrance.start,
            )
          }
          for (const phase of layout.phases) {
            timeline.fromTo(
              cards[phase.index]!,
              { y: layout.entry },
              {
                y: phase.landing,
                duration: phase.end - phase.start,
                ease: 'none',
                immediateRender: true,
              },
              phase.start,
            )
          }
          // Include the final reading interval in the scrubbed duration.
          timeline.to({}, { duration: layout.hold }, layout.travel)
        }
        measure()
        ScrollTrigger.addEventListener('refreshInit', measure)
        const updateActive = (progress: number) => {
          active.value = activeStackCard(layout, progress * layout.dwell)
        }
        ScrollTrigger.create({
          animation: timeline,
          trigger: anchor,
          start: () => `top ${stickyTop()}px`,
          end: () => `+=${layout.dwell}`,
          scrub: true,
          invalidateOnRefresh: true,
          onUpdate: (self) => updateActive(self.progress),
          onRefresh: (self) => updateActive(self.progress),
        })
        nextTick(() => {
          if (mounted) ScrollTrigger.refresh()
        })
        return () => {
          ScrollTrigger.removeEventListener('refreshInit', measure)
          // Refresh-created tweens can capture an in-progress pose as their
          // initial style. Restore the pre-animation state at every breakpoint.
          for (const { target, style } of originalStyles) {
            if (style === null) target.removeAttribute('style')
            else target.setAttribute('style', style)
          }
          scene?.setDwell(0)
          element.style.removeProperty('--stack-trail')
          element.removeAttribute('data-stacked')
          enhanced.value = false
          active.value = 0
        }
      },
    )
    ScrollTrigger.refresh()
  }

  watch([keys, () => scene?.introElements?.()], async () => {
    await nextTick()
    if (mounted) setup()
  })
  onMounted(async () => {
    mounted = true
    await nextTick()
    if (mounted) setup()
  })
  onBeforeUnmount(() => {
    mounted = false
    media?.revert()
  })
  return { active, enhanced }
}

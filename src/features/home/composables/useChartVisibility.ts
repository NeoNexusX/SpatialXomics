import { shallowRef, type Ref } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'

/** Once a lazy chart approaches the viewport, retain its canvas on later scrolls. */
export function useChartVisibility(element: Readonly<Ref<HTMLElement | null>>) {
  const visible = shallowRef(false)
  const { stop } = useIntersectionObserver(
    element,
    ([entry]) => {
      if (entry?.isIntersecting) {
        visible.value = true
        stop()
      }
    },
    { rootMargin: '180px' },
  )
  return visible
}

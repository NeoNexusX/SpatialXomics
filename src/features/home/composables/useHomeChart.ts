import { onBeforeUnmount, onMounted, watch, type Ref, type WatchSource } from 'vue'
import { usePreferredReducedMotion, useResizeObserver } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { init, type EChartsCoreOption, type ECharts } from 'echarts/core'
import { useTheme } from '@/shared/composables/useTheme'

/**
 * Imported only by lazy chart surfaces, keeping ECharts off the initial page path.
 * Returns the instance getter for surfaces that link chart hover with their own markup.
 */
export function useHomeChart(
  element: Readonly<Ref<HTMLElement | null>>,
  sources: WatchSource[],
  options: () => EChartsCoreOption,
) {
  const { isDark } = useTheme()
  const { locale } = useI18n()
  const reducedMotion = usePreferredReducedMotion()
  let chart: ECharts | undefined

  function render() {
    if (!chart || !element.value) return
    chart.setOption(
      {
        // Canvas text uses the page's own font stack, CJK fallbacks included.
        textStyle: { fontFamily: getComputedStyle(element.value).fontFamily },
        ...options(),
        animation: reducedMotion.value !== 'reduce',
      },
      { notMerge: true },
    )
  }

  onMounted(() => {
    if (!element.value) return
    chart = init(element.value, undefined, { renderer: 'canvas' })
    render()
    // Canvas text is drawn once with whatever face is ready; draw again after web fonts load.
    if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(render)
  })
  useResizeObserver(element, () => chart?.resize())
  watch([...sources, isDark, locale, reducedMotion], render)
  onBeforeUnmount(() => {
    chart?.dispose()
    chart = undefined
  })
  return () => chart
}

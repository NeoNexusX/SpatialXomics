import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import { onMounted, watch, nextTick } from 'vue'
import { useRoute } from 'vitepress'
import mediumZoom from 'medium-zoom'
import './custom.css'
import ArchDiagram from './ArchDiagram.vue'

// 继承 VitePress 默认主题，叠加自定义样式与图片点击放大（medium-zoom）
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ArchDiagram', ArchDiagram)
  },
  setup() {
    const route = useRoute()
    const initZoom = () => {
      // 仅对正文中的图片启用放大，排除本已带链接的图片
      mediumZoom('.vp-doc img:not(a img)', { background: 'var(--vp-c-bg)' })
    }
    onMounted(() => {
      nextTick(initZoom)
    })
    watch(
      () => route.path,
      () => nextTick(initZoom),
    )
  },
} satisfies Theme

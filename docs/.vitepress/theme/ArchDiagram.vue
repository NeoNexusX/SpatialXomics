<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useData } from 'vitepress'

// 架构图是自包含 HTML。?url 让 Vite 把文件原样输出到 assets/（带哈希）并返回地址。
const diagrams = import.meta.glob<string>('../../archit_image/*.html', {
  query: '?url',
  import: 'default',
  eager: true,
})

const props = defineProps<{ name: string; title: string }>()

const { isDark, lang } = useData()

// 名字是否存在由 config.ts 的 arch-diagrams 插件在构建时检查
const url = computed(() => diagrams[`../../archit_image/${props.name}.html`]!)
const hint = computed(() =>
  lang.value === 'zh-CN' ? '点击打开完整视图' : 'labels in Chinese · click to open the full view',
)

// 服务端渲染时 isDark 恒为 false，而水合不会修正属性。iframe 等挂载后再出现，
// 否则深色主题的读者会看到浅色的图。
const mounted = ref(false)
onMounted(() => (mounted.value = true))
const theme = computed(() => (isDark.value ? 'dark' : 'light'))
const viewerUrl = computed(() => (mounted.value ? `${url.value}?theme=${theme.value}` : url.value))

// 嵌入模式的 body 是 overflow: hidden，iframe 不够高时图会被裁掉且没有滚动条。
// 图和文档同源，可以读内容高度；宽度变化时图等比缩放，所以要持续跟随。
const frame = ref<HTMLIFrameElement>()
const height = ref<string>()
let observer: ResizeObserver | undefined

function fitHeight() {
  const body = frame.value?.contentDocument?.body
  if (!body) return
  observer?.disconnect()
  observer = new ResizeObserver(() => {
    height.value = `${body.scrollHeight}px`
  })
  observer.observe(body)
}

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <figure class="arch-diagram">
    <div class="arch-diagram__frame" :style="{ height }">
      <!-- 嵌入模式的图本身没有交互，inert 让键盘焦点不会掉进去；点击由上层的链接接管 -->
      <iframe
        v-if="mounted"
        ref="frame"
        :src="`${url}?embed=1&theme=${theme}`"
        :title="title"
        loading="lazy"
        inert
        @load="fitHeight"
      />
      <a :href="viewerUrl" target="_blank" rel="noreferrer" :aria-label="`${title} · ${hint}`" />
    </div>
    <figcaption>{{ title }} · {{ hint }}</figcaption>
  </figure>
</template>

<style scoped>
.arch-diagram {
  margin: 16px 0;
}

/* 边框用 box-shadow：不占内容高度，否则会把图的底部裁掉 2px */
.arch-diagram__frame {
  position: relative;
  /* 宽度必须写明：否则写入 height 后浏览器会按 aspect-ratio 反推宽度，图变宽又变高，无限增长 */
  width: 100%;
  aspect-ratio: 5 / 4; /* 图加载前的占位，height 写入后不再生效 */
  overflow: hidden;
  border-radius: 8px;
  box-shadow: 0 0 0 1px var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}

.arch-diagram__frame iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}

.arch-diagram__frame a {
  position: absolute;
  inset: 0;
  cursor: zoom-in;
}

.arch-diagram figcaption {
  margin-top: 8px;
  font-size: 13px;
  color: var(--vp-c-text-2);
  text-align: center;
}
</style>

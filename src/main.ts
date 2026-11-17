import './style.css'
import './shared/icons/offlineRegistry'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import SvgIcon from './shared/components/SvgIcon.vue'
import { loadConfig } from './shared/config/runtimeConfig'
import { initTheme } from './shared/composables/useTheme'
import { initLocale } from './shared/composables/useLocale'
import { i18n, loadCoreMessages } from './i18n'

/**
 * 启动顺序很关键：必须先 await loadConfig() 拉到 config.json，再动态导入 App 与 router。
 * 这样整棵组件树（含模块顶层通过 getConfig() 读取配置的常量）都在配置就位后才求值，
 * 下游模块无需关心加载时序。
 */
async function bootstrap() {
  // Apply theme before mounting to avoid a flash of the wrong theme (FOUC).
  initTheme()

  // 语言同理要在挂载前定下来。initLocale 只读 localStorage / navigator（纯本地、同步），
  // 核心语言包的下载则与 config.json 并行——不给启动链增加任何串行往返。
  const locale = initLocale()
  const [config] = await Promise.all([loadConfig(), loadCoreMessages(locale)])

  // 标题取自运行时 config.json 的 appName（index.html 里的静态标题仅作 JS 执行前兜底）
  document.title = config.appName

  const [{ default: App }, { default: router }] = await Promise.all([
    import('./app/App.vue'),
    import('./router'),
  ])

  const app = createApp(App)
  app.use(createPinia())
  app.use(i18n)
  app.use(router)

  // Register SvgIcon globally so templates can use <SvgIcon /> without local import
  app.component('SvgIcon', SvgIcon)

  app.mount('#app')
}

bootstrap().catch((err) => {
  console.error('Failed to start app: could not load config.json', err)
  // 应用尚未挂载（无 router 可跳转），直接整页渲染启动失败页。
  // 全部内联样式：此时不依赖任何组件/主题状态也能正常显示。
  const el = document.getElementById('app')
  if (el) {
    el.innerHTML = `
      <div style="min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:2rem;background:#f5f6f8;color:#1f2937;font-family:'Outfit',system-ui,-apple-system,sans-serif">
        <div style="max-width:30rem;text-align:center">
          <h1 style="margin:0 0 0.75rem;font-size:1.75rem;font-weight:600">Something went wrong</h1>
          <p style="margin:0 0 0.5rem;line-height:1.6;color:#4b5563">
            The application failed to start because the server configuration could not be loaded.
            This is not your fault &mdash; it&rsquo;s an error on our side.
          </p>
          <!-- 联系方式与 content.json 的 contact 块保持一致；此页恰在 config 加载失败时显示，只能写死 -->
          <p style="margin:0 0 1.75rem;line-height:1.6;color:#4b5563">
            Please try again in a moment, or contact the BioNet team via
            <a href="mailto:jydong@xmu.edu.cn" style="color:#2563eb;text-decoration:underline">email</a>
            or
            <a href="https://files.seeusercontent.com/2026/06/03/Yw8r/Snipaste_2026-06-03_11-14-27.png"
              target="_blank" rel="noopener" style="color:#2563eb;text-decoration:underline">WeChat</a>
            if the problem persists.
          </p>
          <button onclick="location.reload()"
            style="padding:0.6rem 1.6rem;border:0;border-radius:0.5rem;background:#2563eb;color:#fff;font-size:1rem;font-family:inherit;cursor:pointer">
            Reload
          </button>
          <p style="margin:1.75rem 0 0;font-size:0.8rem;color:#9ca3af">
            Technical detail: config.json is missing or not valid JSON.
          </p>
        </div>
      </div>`
  }
})

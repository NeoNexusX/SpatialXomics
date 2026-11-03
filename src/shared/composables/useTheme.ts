import { computed, ref } from 'vue'
import { STORAGE_KEYS } from '@/shared/config'

/**
 * 全站主题（light / dark）的单一数据源。
 *
 * 之前 main.ts 的 initTheme IIFE 与 Navbar 各写了一遍「读 localStorage → 回退系统偏好
 * → setAttribute」，逻辑分散、容易漂移（如 Navbar 切换后感知不到系统监听）。这里把
 * 状态与副作用收口到模块级单例：
 * - {@link initTheme} 在 main.ts 挂载前尽早调用，避免主题闪烁（FOUC）；
 * - 任何组件 `useTheme()` 拿到的都是同一个响应式 `theme`，切换即全局同步。
 */
type Theme = 'light' | 'dark'

const theme = ref<Theme>('light')
let initialized = false

function apply(t: Theme) {
  document.documentElement.setAttribute('data-theme', t)
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

function readSaved(): Theme | null {
  const saved = localStorage.getItem(STORAGE_KEYS.theme)
  return saved === 'light' || saved === 'dark' ? saved : null
}

/** 设置主题：更新状态、应用到 <html>、持久化到 localStorage */
function setTheme(t: Theme) {
  theme.value = t
  apply(t)
  localStorage.setItem(STORAGE_KEYS.theme, t)
}

/** 在 light / dark 之间切换 */
function toggleTheme() {
  setTheme(theme.value === 'dark' ? 'light' : 'dark')
}

/**
 * 初始化主题：优先用已保存值，否则跟随系统偏好；未保存时监听系统变化自动切换。
 * 应在挂载应用前尽早调用（main.ts），且幂等——重复调用只生效一次。
 */
export function initTheme() {
  if (initialized) return
  initialized = true

  const saved = readSaved()
  if (saved) {
    theme.value = saved
    apply(saved)
    return
  }

  const initial: Theme = systemPrefersDark() ? 'dark' : 'light'
  theme.value = initial
  apply(initial)

  // 用户尚未手动保存偏好时，跟随系统主题变化自动切换
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => {
    if (!readSaved()) {
      const next: Theme = e.matches ? 'dark' : 'light'
      theme.value = next
      apply(next)
    }
  })
}

export function useTheme() {
  const isDark = computed(() => theme.value === 'dark')
  return { theme, isDark, toggleTheme, initTheme }
}

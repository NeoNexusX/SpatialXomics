import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authStorage } from './authStorage'
import { getCurrentUser, logoutApi } from './authApi'
import { STORAGE_KEYS } from '@/shared/config'
import { registerUnauthorizedHandler } from '@/shared/api/httpClient'
import type { UsrProfile } from './types'

// Session user shape is the backend profile; extra keys are tolerated.
type SessionUser = UsrProfile & { [key: string]: unknown }

export const useAuthStore = defineStore('auth', () => {
  const user = ref<SessionUser | null>(null)
  const token = ref<string | null>(authStorage.getToken())

  const isAuthenticated = computed(() => !!token.value)
  const isAdmin = computed(() => user.value?.identity === 'admin')

  // 401 拦截器清 localStorage 时同步清内存态：否则 store 仍认为已登录，路由守卫
  // 会把过期用户从 /login 弹回业务页（过期 token 访问 /database 落到数据集列表的
  // 根因）。同标签页的 storage 事件不会触发，必须走这个钩子。
  registerUnauthorizedHandler(() => {
    token.value = null
    user.value = null
  })

  // In-flight dedup: every concurrent fetchUser() shares one GET /user.
  // A settled promise is cleared in .finally so the next call re-fetches.
  let fetchUserPromise: Promise<void> | null = null

  // Cross-tab sync: the token ref is the single source of truth for this tab,
  // so a logout/login in another tab (which writes localStorage) must be
  // mirrored here or this tab would keep acting on a stale session until
  // reload. The storage event fires only in *other* tabs, never the writer.
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key !== null && e.key !== STORAGE_KEYS.accessToken) return
      const live = authStorage.getToken()
      if (live !== token.value) {
        token.value = live
        user.value = null // profile no longer matches the (changed) token
      }
    })
  }

  async function fetchUser(): Promise<void> {
    if (!token.value) return
    if (!fetchUserPromise) {
      fetchUserPromise = (async () => {
        try {
          const response = await getCurrentUser()
          user.value = response.data as SessionUser
        } catch (error: any) {
          // Only logout on 401 Unauthorized; transient errors keep the session.
          if (error.response?.status === 401) {
            await logout()
          }
        }
      })().finally(() => {
        fetchUserPromise = null
      })
    }
    return fetchUserPromise
  }

  async function login(accessToken: string) {
    if (!accessToken) return
    token.value = accessToken
    authStorage.setToken(accessToken)
    // Fetch user immediately to update UI. Callers should await login() so
    // user/identity are settled before any navigation that depends on them.
    await fetchUser()
  }

  async function logout() {
    try {
      if (token.value) await logoutApi()
    } catch (error: any) {
      // 只打状态码/消息：打整个 AxiosError 会把含 Authorization 头的
      // error.config 一并带进控制台
      console.error('Logout API failed:', error?.response?.status ?? error?.message ?? error)
    } finally {
      token.value = null
      user.value = null
      authStorage.clearAuthData()
    }
  }

  return {
    user,
    token,
    isAuthenticated,
    isAdmin,
    login,
    logout,
    fetchUser,
  }
})

import axios, { AxiosError } from 'axios'
import { ENV } from '@/shared/config'
import { authStorage } from '@/shared/auth/authStorage'
import router from '@/router'

// Top-level Response body
interface ErrorResponse {
  detail: FastAPIError[]
}

// Response error model definition
interface FastAPIError {
  loc: string[]
  msg: string
  type: string
}

// Normalize backend error shapes into a readable string.
// Handles FastAPI validation arrays ([{ loc, msg, type }]), objects with msg/message,
// and plain strings. Objects/arrays without a message fall back to a safe JSON dump.
export function formatErrorMessage(detail: unknown): string {
  const safeStringify = (o: unknown) => {
    try {
      return JSON.stringify(o)
    } catch {
      return String(o)
    }
  }

  if (detail == null) return 'Unknown Error'

  // --- FastAPI-style array: [{ loc, msg, type }, ...] ---
  if (Array.isArray(detail)) {
    // Collect non-empty messages from all items
    const messages = detail
      .map((item) => (item as { msg?: string; message?: string })?.msg || (item as { msg?: string; message?: string })?.message || '')
      .filter(Boolean)
    if (messages.length > 0) {
      return messages.join('; ')
    }
    // Fallback: no extractable message in any item
    return safeStringify(detail) || 'Response Failed'
  }

  // --- Plain object: { msg } or { message } or { detail: "..." } ---
  if (typeof detail === 'object') {
    const obj = detail as Record<string, unknown>
    // Recursively unwrap nested detail
    if (obj.detail != null && (typeof obj.detail === 'string' || Array.isArray(obj.detail) || (typeof obj.detail === 'object' && (obj.detail as any)?.msg))) {
      return formatErrorMessage(obj.detail)
    }
    const msg = obj.msg || obj.message
    if (msg && typeof msg === 'string') return msg
    return safeStringify(detail) || 'Response Failed'
  }

  return String(detail) || 'Response Failed'
}

/**
 * session 失效（401）时的内存态清理钩子。
 *
 * 本模块清 localStorage 后，Pinia 里的 token/user 仍是旧值（storage 事件只在
 * **其他**标签页触发，写入方自己收不到）。若不清，路由守卫会把「已失效但 store
 * 仍认为已登录」的用户从 /login 弹回业务页——历史上表现为过期 token 访问
 * /database 却落到数据集列表。authStore 在创建时注册本钩子同步清理。
 */
let onUnauthorized: (() => void) | null = null

export function registerUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler
}

/**
 * Global 401 handler: any authenticated endpoint that rejects the token means
 * the session is dead. Clear the stored credentials so the request
 * interceptor stops attaching the stale token, reset the in-memory auth store,
 * and bounce to /login once (guarded by a module flag to avoid a redirect storm
 * when several requests fail together). Skipped when a skipAuthRedirect marker
 * is set on the config (e.g. logout itself, or a page that handles 401s on its
 * own).
 *
 * 公开路由上不跳登录：该页匿名本就可浏览（如 /datasets、分享页），过期 token
 * 只清会话，不该把访客踢走。需要登录态的页面仍按原逻辑跳转。
 */
function handleUnauthorized(error: AxiosError<ErrorResponse>): void {
  if ((error.config as any)?.skipAuthRedirect) return
  if (error.response?.status !== 401) return
  authStorage.clearAuthData()
  onUnauthorized?.()
  if (typeof window === 'undefined') return
  // 当前路由只要不是全链路需要登录，就不触发登录跳转
  if (!router.currentRoute.value.matched.some((record) => record.meta.requiresAuth)) return
  const path = window.location.pathname
  if (path === '/login' || path === '/register' || path === '/forgotpassword') return
  // 必须 SPA 内导航：httpClient 由懒加载 chunk 引入，401 时 router 已就绪。
  // 若用 window.location.assign 硬跳转会整页刷新，authStore 会重新读取
  // localStorage——而此时 token 尚未被 authStore.logout() 清除（router.push 不
  // 触发 storage 事件，本标签页拿不到跨标签同步），store 会带回已失效的 token，
  // 已登录用户跳 /login 的守卫再把页面踢回受保护页，造成 /login ↔ 受保护页死循环
  // （见 e2e/responsive.spec.ts 的历史回归）。
  router.push({ path: '/login', query: { redirect: path + window.location.search } })
}

const error_catch = (error: AxiosError<ErrorResponse>) => {
  handleUnauthorized(error)
  if (error.response?.data) {
    const raw = (error.response.data as any) || {}

    // If data is a plain string (e.g., text/plain response), try to parse it as JSON
    let candidate: unknown
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw)
        candidate = parsed?.detail ?? parsed?.message ?? parsed?.msg ?? parsed
      } catch {
        candidate = raw
      }
    } else {
      candidate = raw?.detail ?? raw?.message ?? raw?.msg ?? error.message ?? raw
    }

    const errorMessage = formatErrorMessage(candidate)
    // set formatted message on the error and also on response.data for callers
    try {
      error.message = errorMessage
    } catch {}
    try {
      ;(error.response.data as any).message = errorMessage
    } catch {}
  }
  return Promise.reject(error)
}

// Authenticated API
const auth_api = axios.create({ baseURL: ENV.apiBase })

// Inject auth token
auth_api.interceptors.request.use((config) => {
  const token = authStorage.getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

auth_api.interceptors.response.use((response) => response, error_catch)

// Public API
const api = axios.create({ baseURL: ENV.apiBase })

// Public API response interceptor
api.interceptors.response.use((response) => response, error_catch)

export function extractBackendError(error: any, fallback?: string): string {
  // Non-axios throws carry no backend payload; use the caller's fallback when given.
  if (fallback !== undefined && !axios.isAxiosError(error)) return fallback
  const candidate =
    error?.response?.data?.detail ??
    error?.response?.data?.message ??
    error?.response?.data?.msg ??
    error?.message
  return formatErrorMessage(candidate)
}

/**
 * 是否为「无权操作」错误（403，或后端 detail 写着 permission denied）。
 * 后端 detail 原文对用户没有意义（也不随资源变化），调用方据此换成自己的文案。
 */
export function isPermissionDenied(error: any): boolean {
  if (error?.response?.status === 403) return true
  // 不走 extractBackendError：它对非 axios 错误会直接返回 fallback，绕过后端文本
  const detail =
    error?.response?.data?.detail ??
    error?.response?.data?.message ??
    error?.response?.data?.msg ??
    error?.message
  return /permission\s+denied|forbidden|not\s+(the\s+)?owner/i.test(formatErrorMessage(detail))
}

export { auth_api, api }

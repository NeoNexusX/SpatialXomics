/**
 * 开发环境的同源转发：浏览器直连外部端点常被本机系统代理干扰（转发 502、SSE 长流被掐断），
 * dev 下改走 vite 的 node 端转发。部署默认端点走固定目标的 /llm-proxy，
 * 用户自填的端点走 /llm-relay，真实 origin 放在 x-llm-target 请求头里（见 vite.config.ts）。
 */

import type { ResolvedEndpoint } from '../agenttypes/assistant'

/** 返回交给 SDK 或手写请求使用的 fetch。生产环境返回 undefined，直接用全局 fetch */
export function devRelayFetch(endpoint: ResolvedEndpoint): typeof fetch | undefined {
  if (!import.meta.env.DEV) return undefined
  return (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.origin,
    )
    if (url.origin === window.location.origin) return fetch(input, init)
    const path = `${url.pathname}${url.search}`
    if (endpoint.source === 'deployment') return fetch(`/llm-proxy${path}`, init)
    const headers = new Headers(init?.headers)
    headers.set('x-llm-target', url.origin)
    return fetch(`/llm-relay${path}`, { ...init, headers })
  }
}

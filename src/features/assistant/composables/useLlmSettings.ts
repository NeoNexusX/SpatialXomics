/**
 * useLlmSettings：BYOK 设置的 Vue 桥（模块级单例 store）。
 *
 * 在 agentconfig/userLlmConfig（纯持久化模块）之上包响应式状态，供悬浮窗设置面板用：
 * - config：四项表单值（provider / baseUrl / apiKey / model），save/clear 落 localStorage
 * - testConnection：用**当前表单值**（保存前即可测）发一个 max_tokens=1 的最小请求
 *
 * 实际发消息时的凭据解析在各适配器内（用户配置 → env 兜底），这里不参与运行时请求链路。
 */

import { ref, computed } from 'vue'
import {
  loadUserLlmConfig,
  saveUserLlmConfig,
  clearUserLlmConfig,
  type UserLlmConfig,
} from '../agentconfig/userLlmConfig'
import { humanizeHttpError, devRelayTarget, resolveDefaultModel } from '../agentservices/openaiAdapter'
import { ENV } from '@/shared/config/env'

// ---- 模块级共享状态（设置面板与 header 徽标共享同一份） ----

const config = ref<UserLlmConfig>(loadUserLlmConfig())

/** 用户是否填了任意一项自定义配置 */
const hasCustom = computed(
  () => !!(config.value.baseUrl || config.value.apiKey || config.value.model),
)

/** 未自定义时，部署 env 是否带了可用的默认凭据 */
const hasEnvDefault = computed(() => ENV.llmProxyUrl !== '' && ENV.llmApiKey !== '')

// ---- composable 导出 ----

export function useLlmSettings() {
  /** 保存表单值（归一化空白后落库） */
  function save(next: UserLlmConfig): void {
    const normalized: UserLlmConfig = {
      baseUrl: next.baseUrl.trim(),
      apiKey: next.apiKey.trim(),
      model: next.model.trim(),
    }
    config.value = normalized
    saveUserLlmConfig(normalized)
  }

  /** 清除自定义配置，回到 env 默认 */
  function clear(): void {
    config.value = { baseUrl: '', apiKey: '', model: '' }
    clearUserLlmConfig()
  }

  return { config, hasCustom, hasEnvDefault, save, clear }
}

/**
 * 用给定配置测连通性（不要求已保存）。返回 null 表示成功，否则为用户可读的错误信息。
 * 发 max_tokens=1 的非流式最小请求，一次往返同时验证地址、密钥与模型名。
 * 端点解析与运行时一致（dev 下经 vite 同源转发，绕开本机代理对直连的干扰）。
 * 只支持 OpenAI 兼容端点（/chat/completions）。
 */
export async function testLlmConnection(cfg: UserLlmConfig): Promise<string | null> {
  const base = (cfg.baseUrl.trim() || ENV.llmProxyUrl).replace(/\/+$/, '')
  const key = cfg.apiKey.trim() || ENV.llmApiKey
  // 模型默认链与真实请求同源（openaiAdapter.resolveDefaultModel）：
  // config.json llm 块 → env → 内置兜底，不能在这里私自跳过 config.json 层
  const model = cfg.model.trim() || resolveDefaultModel()
  if (!base || !key) return 'Base URL and API key are both required'

  // 端点解析与运行时同一实现（openaiAdapter.devRelayTarget）：dev 下转 vite
  // 同源转发，绕开本机代理对直连的干扰
  const direct = `${base}/chat/completions`
  const relay = devRelayTarget(direct, cfg.baseUrl.trim())
  const url = relay?.url ?? direct

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        ...(relay?.targetOrigin ? { 'x-llm-target': relay.targetOrigin } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1,
        stream: false,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return humanizeHttpError(res.status, body)
    }
    // 200 不代表成功：若地址指向了前端/静态站点，SPA fallback 会回退 index.html
    // （也是 200），导致「密钥模型乱填也显示连接成功」。校验返回确是 LLM JSON。
    const bodyText = await res.text().catch(() => '')
    try {
      const parsed = JSON.parse(bodyText) as { choices?: unknown }
      if (parsed && Array.isArray(parsed.choices)) return null
    } catch {
      /* 非 JSON，落入下面的报错 */
    }
    return 'Got HTTP 200 but the response is not a valid LLM reply (looks like an HTML page). The Base URL likely points at a website, not an API — try appending /v1 (e.g. https://host/v1).'
  } catch (err) {
    return `Cannot reach ${base} — check the URL and that the endpoint allows browser (CORS) access. (${
      (err as Error)?.message || 'network error'
    })`
  }
}

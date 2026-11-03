/**
 * 用户自配 LLM（BYOK：Bring Your Own Key）的持久化与解析。
 *
 * 用户可在助手面板设置里填 API 地址 / 密钥 / 模型名，覆盖部署时的 env 默认
 * （VITE_LLM_*）。值存 localStorage（明文——只存在用户自己的浏览器，不经任何
 * 后端，这是 BYOK 的常规做法，设置面板里有对应提示）。
 *
 * 只支持 OpenAI 兼容协议（/chat/completions）。
 *
 * 这里是**无 Vue 依赖的纯模块**：services 层的适配器直接 import 读值
 * （依赖方向 services → config），composable 层的 useLlmSettings 在其上包响应式给设置 UI。
 */

import { STORAGE_KEYS } from '@/shared/config/storageKeys'

/** 用户自配的三项；空字符串表示「未填、走兜底」 */
export interface UserLlmConfig {
  /** OpenAI 兼容基地址，如 https://api.deepseek.com/v1（末尾斜杠会归一化） */
  baseUrl: string
  apiKey: string
  model: string
}

const EMPTY: UserLlmConfig = { baseUrl: '', apiKey: '', model: '' }

/** localStorage → 内存。损坏/缺失一律回退全空（与 useAssistant.loadHistory 同策略） */
export function loadUserLlmConfig(): UserLlmConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.assistantLlmConfig)
    if (!raw) return { ...EMPTY }
    const parsed = JSON.parse(raw) as Partial<UserLlmConfig>
    return {
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim() : '',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '',
      model: typeof parsed.model === 'string' ? parsed.model.trim() : '',
    }
  } catch {
    return { ...EMPTY }
  }
}

/** 内存 → localStorage；全空时直接删除 key（回到 env 兜底） */
export function saveUserLlmConfig(config: UserLlmConfig): void {
  const normalized: UserLlmConfig = {
    baseUrl: config.baseUrl.trim(),
    apiKey: config.apiKey.trim(),
    model: config.model.trim(),
  }
  try {
    if (!normalized.baseUrl && !normalized.apiKey && !normalized.model) {
      localStorage.removeItem(STORAGE_KEYS.assistantLlmConfig)
    } else {
      localStorage.setItem(STORAGE_KEYS.assistantLlmConfig, JSON.stringify(normalized))
    }
  } catch {
    // localStorage 不可用（隐私模式等）时静默跳过
  }
}

/** 清除用户配置（回到 env 兜底） */
export function clearUserLlmConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.assistantLlmConfig)
  } catch {
    // 同上
  }
}

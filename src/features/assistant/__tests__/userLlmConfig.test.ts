import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearUserLlmConfig,
  loadUserLlmConfig,
  saveUserLlmConfig,
} from '../agentconfig/userLlmConfig'
import {
  humanizeHttpError,
  isLlmConfigured,
  resolveApiKey,
  resolveEndpoint,
  resolveModel,
} from '../agentservices/openaiAdapter'
import { STORAGE_KEYS } from '@/shared/config/storageKeys'

/** 种一份用户配置（测试环境无 VITE_LLM_* env，用户配置是唯一来源）。 */
function seedUserConfig(baseUrl?: string, apiKey?: string, model?: string): void {
  saveUserLlmConfig({ baseUrl: baseUrl ?? '', apiKey: apiKey ?? '', model: model ?? '' })
}

describe('userLlmConfig（BYOK 持久化）', () => {
  beforeEach(() => localStorage.clear())

  it('returns empty config when nothing stored', () => {
    expect(loadUserLlmConfig()).toEqual({ baseUrl: '', apiKey: '', model: '' })
  })

  it('round-trips and trims values', () => {
    saveUserLlmConfig({ baseUrl: ' https://api.test/v1/ ', apiKey: ' sk-1 ', model: ' m ' })
    expect(loadUserLlmConfig()).toEqual({
      baseUrl: 'https://api.test/v1/',
      apiKey: 'sk-1',
      model: 'm',
    })
  })

  it('removes the storage key when saving all-empty config', () => {
    seedUserConfig('https://x', 'sk', 'm')
    saveUserLlmConfig({ baseUrl: '', apiKey: '', model: '' })
    expect(localStorage.getItem(STORAGE_KEYS.assistantLlmConfig)).toBeNull()
  })

  it('clearUserLlmConfig removes the key', () => {
    seedUserConfig('https://x', 'sk', 'm')
    clearUserLlmConfig()
    expect(loadUserLlmConfig()).toEqual({ baseUrl: '', apiKey: '', model: '' })
  })

  it('tolerates corrupted JSON', () => {
    localStorage.setItem(STORAGE_KEYS.assistantLlmConfig, '{not json')
    expect(loadUserLlmConfig()).toEqual({ baseUrl: '', apiKey: '', model: '' })
  })

  it('ignores legacy provider field from older records (旧记录多出的字段不炸)', () => {
    localStorage.setItem(
      STORAGE_KEYS.assistantLlmConfig,
      JSON.stringify({ baseUrl: 'https://x', apiKey: 'sk', model: 'm', provider: 'anthropic' }),
    )
    const cfg = loadUserLlmConfig()
    expect(cfg).toEqual({ baseUrl: 'https://x', apiKey: 'sk', model: 'm' })
  })
})

describe('openaiAdapter resolve*（用户配置 → env 兜底）', () => {
  beforeEach(() => localStorage.clear())

  it('endpoint falls back to env when no user config (env 为空 → 相对路径)', () => {
    expect(resolveEndpoint().url).toBe('/chat/completions')
  })

  it('user baseUrl overrides env and trailing slashes are normalized', () => {
    seedUserConfig('https://api.deepseek.com/v1//')
    // dev（含测试）模式下 BYOK 改走 vite 同源 relay 转发（绕开本机代理），
    // 绝对端点用 resolveEndpoint().absolute 断言
    expect(resolveEndpoint().url).toBe('/llm-relay/v1/chat/completions')
    expect(resolveEndpoint().absolute).toBe('https://api.deepseek.com/v1/chat/completions')
  })

  it('user apiKey overrides env', () => {
    seedUserConfig('', 'sk-user')
    expect(resolveApiKey()).toBe('sk-user')
  })

  it('user model takes priority without touching runtime config', () => {
    // 用户填了 model 时不应读 config.json（测试环境未 loadConfig，读了会抛错）
    seedUserConfig('', '', 'deepseek-reasoner')
    expect(resolveModel()).toBe('deepseek-reasoner')
  })

  it('isLlmConfigured requires both baseUrl and apiKey from either source', () => {
    expect(isLlmConfigured()).toBe(false)
    seedUserConfig('https://api.test')
    expect(isLlmConfigured()).toBe(false)
    seedUserConfig('', 'sk-1')
    expect(isLlmConfigured()).toBe(false)
    seedUserConfig('https://api.test', 'sk-1')
    expect(isLlmConfigured()).toBe(true)
  })
})

describe('humanizeHttpError', () => {
  it('translates 401 with upstream message', () => {
    expect(humanizeHttpError(401, '{"error":{"message":"Invalid key"}}')).toBe(
      'API key rejected (HTTP 401): Invalid key',
    )
  })

  it('translates 404 with Base URL hint', () => {
    expect(humanizeHttpError(404, '')).toBe(
      'Endpoint not found (HTTP 404) — check the API Base URL',
    )
  })

  it('keeps raw status for non-JSON bodies', () => {
    expect(humanizeHttpError(503, 'oops')).toBe('LLM provider error (HTTP 503)')
  })
})

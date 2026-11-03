/**
 * 助手的连接配置：用户设置的持久化，以及「用户设置 + 部署默认 → 实际连接」的解析规则。
 *
 * 纯模块，不依赖 Vue、cordis 和 SDK。运行期状态由 ctx.connection 持有，
 * 设置界面经 useConnection 读写。密钥明文存在用户自己的 localStorage，不经过任何后端。
 */

import { ENV } from '@/shared/config/env'
import { getConfig } from '@/shared/config/runtimeConfig'
import { STORAGE_KEYS } from '@/shared/config/storageKeys'
import { fnv1a } from '@/shared/utils/fnv1a'
import type { EndpointType, ResolvedConnection, ResolvedEndpoint } from './types'

/** 用户保存的连接设置；空字符串表示没填 */
export interface ConnectionConfig {
  endpoint: EndpointType
  baseUrl: string
  apiKey: string
  model: string
}

/** 每种端点协议的内置默认值。设置界面按这张表列出可选协议 */
export const ENDPOINT_PROFILES: Record<
  EndpointType,
  { label: string; baseUrl: string; requestPath: string }
> = {
  anthropic: {
    label: 'Anthropic Messages',
    baseUrl: 'https://api.anthropic.com',
    requestPath: '/messages',
  },
}

export const ENDPOINT_TYPES = Object.keys(ENDPOINT_PROFILES) as EndpointType[]

export function emptyConnectionConfig(): ConnectionConfig {
  return { endpoint: 'anthropic', baseUrl: '', apiKey: '', model: '' }
}

function normalizeConfig(config: Partial<ConnectionConfig>): ConnectionConfig {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  return {
    endpoint: ENDPOINT_TYPES.includes(config.endpoint as EndpointType)
      ? (config.endpoint as EndpointType)
      : 'anthropic',
    baseUrl: text(config.baseUrl),
    apiKey: text(config.apiKey),
    model: text(config.model),
  }
}

/** localStorage → 内存。损坏或缺失时回退全空 */
export function loadConnectionConfig(): ConnectionConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.agentConnection)
    if (!raw) return emptyConnectionConfig()
    return normalizeConfig(JSON.parse(raw) as Partial<ConnectionConfig>)
  } catch {
    return emptyConnectionConfig()
  }
}

/** 内存 → localStorage，返回去掉首尾空白后的值。全空时删除 key，回到部署默认 */
export function saveConnectionConfig(config: ConnectionConfig): ConnectionConfig {
  const normalized = normalizeConfig(config)
  try {
    if (!normalized.baseUrl && !normalized.apiKey && !normalized.model) {
      localStorage.removeItem(STORAGE_KEYS.agentConnection)
    } else {
      localStorage.setItem(STORAGE_KEYS.agentConnection, JSON.stringify(normalized))
    }
  } catch {
    // localStorage 不可用（隐私模式等）时只在内存里生效
  }
  return normalized
}

/**
 * 规范基地址：补协议头，去掉末尾斜杠和误填的 /messages，没有版本段时补 /v1。
 * https://api.example.com、https://api.example.com/v1、https://api.example.com/v1/messages
 * 都解析到同一个基地址；https://host/anthropic 这类带前缀的地址得到 https://host/anthropic/v1。
 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/messages$/i, '')
    .replace(/\/+$/, '')
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return /\/v\d+[a-z0-9]*$/i.test(withScheme) ? withScheme : `${withScheme}/v1`
}

/**
 * 解析端点。地址和密钥作为一组决定，不混用：
 * - 用户填了密钥：走用户这组，地址留空时用协议的官方地址。用户的密钥不会被发到部署的中转地址。
 * - 用户没填密钥：走部署默认，用户填的地址不生效，部署密钥不会被发到别处。
 * - 两者都没有：返回 null。
 * 部署密钥会被打进前端包，只能放中转站的子 key，不要放官方 API key。
 */
export function resolveEndpoint(config: ConnectionConfig): ResolvedEndpoint | null {
  if (config.apiKey) {
    return {
      endpoint: config.endpoint,
      baseUrl: normalizeBaseUrl(config.baseUrl || ENDPOINT_PROFILES[config.endpoint].baseUrl),
      apiKey: config.apiKey,
      source: 'user',
    }
  }
  if (!ENV.llmProxyUrl || !ENV.llmApiKey) return null
  return {
    endpoint: config.endpoint,
    baseUrl: normalizeBaseUrl(ENV.llmProxyUrl),
    apiKey: ENV.llmApiKey,
    source: 'deployment',
  }
}

/** 解析实际连接：端点 + 模型。用户的连接必须选过模型，部署连接可以用部署配置的模型 */
export function resolveConnection(config: ConnectionConfig): ResolvedConnection | null {
  const endpoint = resolveEndpoint(config)
  if (!endpoint) return null
  const model =
    config.model || (endpoint.source === 'deployment' ? getConfig().llm?.model || ENV.llmModel : '')
  return model ? { ...endpoint, model } : null
}

/**
 * 端点的指纹，用来区分测试结果属于哪个端点。
 * 换了密钥要重新测（不同密钥能用的模型可能不同），但结果里不能存密钥本身，所以只存哈希。
 */
export function endpointKey(endpoint: ResolvedEndpoint): string {
  return `${endpoint.endpoint}|${endpoint.baseUrl}|${fnv1a(endpoint.apiKey).toString(16)}`
}

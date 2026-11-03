import type { ResolvedEndpoint } from '../connection'
import { STORAGE_KEYS } from '@/shared/config/storageKeys'

/** 单次模型调用的输出上限。思考也计入这个上限，所以不能给小 */
export const MAX_OUTPUT_TOKENS = 64_000

export const DEFAULT_CONTEXT_WINDOW = 256_000
export const MIN_CONTEXT_WINDOW = 1024
export const MAX_CONTEXT_WINDOW = 16_000_000

export function modelLimitKey(endpoint: ResolvedEndpoint, model: string): string {
  return JSON.stringify([endpoint.endpoint, endpoint.baseUrl.replace(/\/+$/, ''), model])
}

function readLimits(): Record<string, number> {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEYS.agentModelLimits) ?? '{}',
    )
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value).filter(([, limit]) => validContextWindow(limit)),
      )
    }
  } catch {
    // A missing or damaged preference uses the engineering default.
  }
  return {}
}

export function validContextWindow(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= MIN_CONTEXT_WINDOW &&
    Number(value) <= MAX_CONTEXT_WINDOW
  )
}

export function getContextWindowOverride(
  endpoint: ResolvedEndpoint,
  model: string,
): number | undefined {
  return readLimits()[modelLimitKey(endpoint, model)]
}

export function getContextWindow(
  endpoint: ResolvedEndpoint,
  model: string,
  fallback = DEFAULT_CONTEXT_WINDOW,
): number {
  return getContextWindowOverride(endpoint, model) ?? fallback
}

export function saveContextWindow(endpoint: ResolvedEndpoint, model: string, tokens: number): void {
  if (!model.trim() || !validContextWindow(tokens)) throw new Error('Invalid model context window')
  const limits = readLimits()
  limits[modelLimitKey(endpoint, model)] = tokens
  localStorage.setItem(STORAGE_KEYS.agentModelLimits, JSON.stringify(limits))
}

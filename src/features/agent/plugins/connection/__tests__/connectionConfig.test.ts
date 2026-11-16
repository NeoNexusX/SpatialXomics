import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { STORAGE_KEYS } from '@/shared/config/storageKeys'
import {
  emptyConnectionConfig,
  loadConnectionConfig,
  normalizeBaseUrl,
  resolveConnection,
  resolveEndpoint,
  saveConnectionConfig,
} from '../config'
import { ConnectionManager } from '../index'

const env = vi.hoisted(() => ({ llmProxyUrl: '', llmApiKey: '', llmModel: '' }))

vi.mock('@/shared/config/env', () => ({ ENV: env }))
vi.mock('@/shared/config/runtimeConfig', () => ({ getConfig: () => ({ llm: {} }) }))

const config = (over: Partial<ReturnType<typeof emptyConnectionConfig>> = {}) => ({
  ...emptyConnectionConfig(),
  ...over,
})

describe('normalizeBaseUrl', () => {
  it.each([
    ['https://api.neonexus.top', 'https://api.neonexus.top/v1'],
    ['https://api.neonexus.top/', 'https://api.neonexus.top/v1'],
    ['https://api.neonexus.top/v1', 'https://api.neonexus.top/v1'],
    ['https://api.neonexus.top/v1/', 'https://api.neonexus.top/v1'],
    ['https://api.neonexus.top/v1/messages', 'https://api.neonexus.top/v1'],
    ['api.neonexus.top', 'https://api.neonexus.top/v1'],
    ['http://47.113.198.26/v1', 'http://47.113.198.26/v1'],
    ['https://host/anthropic', 'https://host/anthropic/v1'],
    ['https://host/api/v2', 'https://host/api/v2'],
    ['https://host/v1beta', 'https://host/v1beta'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeBaseUrl(input)).toBe(expected)
  })
})

describe('resolveConnection', () => {
  beforeEach(() => {
    env.llmProxyUrl = ''
    env.llmApiKey = ''
    env.llmModel = ''
  })

  it('returns null without any credentials', () => {
    expect(resolveConnection(config())).toBeNull()
    expect(resolveConnection(config({ baseUrl: 'https://x', model: 'm' }))).toBeNull()
  })

  it('uses the official address for a key on its own, and needs a model to connect', () => {
    expect(resolveEndpoint(config({ apiKey: 'sk-1' }))).toEqual({
      endpoint: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-1',
      source: 'user',
    })
    expect(resolveConnection(config({ apiKey: 'sk-1' }))).toBeNull()
    expect(resolveConnection(config({ apiKey: 'sk-1', model: 'k3' }))?.model).toBe('k3')
  })

  it('never sends a user key to the deployment relay', () => {
    env.llmProxyUrl = 'http://relay.test/v1'
    env.llmApiKey = 'shared'
    env.llmModel = 'relay-model'
    const connection = resolveConnection(config({ apiKey: 'sk-1', model: 'k3' }))
    expect(connection?.baseUrl).toBe('https://api.anthropic.com/v1')
    expect(connection?.model).toBe('k3')
    // 部署配置的模型不跟用户的密钥混用
    expect(resolveConnection(config({ apiKey: 'sk-1' }))).toBeNull()
  })

  it('never sends the deployment key to a user-supplied address', () => {
    env.llmProxyUrl = 'http://relay.test'
    env.llmApiKey = 'shared'
    env.llmModel = 'relay-model'
    const connection = resolveConnection(config({ baseUrl: 'https://evil.test' }))
    expect(connection?.baseUrl).toBe('http://relay.test/v1')
    expect(connection?.apiKey).toBe('shared')
    expect(connection?.source).toBe('deployment')
  })

  it('lets a user pick the model on the deployment connection', () => {
    env.llmProxyUrl = 'http://relay.test/v1'
    env.llmApiKey = 'shared'
    env.llmModel = 'relay-model'
    expect(resolveConnection(config())?.model).toBe('relay-model')
    expect(resolveConnection(config({ model: 'mine' }))?.model).toBe('mine')
  })

  it('needs both address and key for the deployment default', () => {
    env.llmProxyUrl = 'http://relay.test/v1'
    env.llmModel = 'relay-model'
    expect(resolveConnection(config())).toBeNull()
  })

  it('needs a model for the deployment default too', () => {
    env.llmProxyUrl = 'http://relay.test/v1'
    env.llmApiKey = 'shared'
    expect(resolveEndpoint(config())?.source).toBe('deployment')
    expect(resolveConnection(config())).toBeNull()
  })
})

describe('persistence', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips trimmed values', () => {
    saveConnectionConfig(config({ baseUrl: ' https://x ', apiKey: ' k ', model: ' m ' }))
    expect(loadConnectionConfig()).toEqual(
      config({ baseUrl: 'https://x', apiKey: 'k', model: 'm' }),
    )
  })

  it('removes the key when everything is empty', () => {
    saveConnectionConfig(config({ apiKey: 'k' }))
    saveConnectionConfig(config())
    expect(localStorage.getItem(STORAGE_KEYS.agentConnection)).toBeNull()
  })

  it('falls back to empty on corrupt data', () => {
    localStorage.setItem(STORAGE_KEYS.agentConnection, '{not json')
    expect(loadConnectionConfig()).toEqual(config())
  })

  it('ignores an unknown endpoint type', () => {
    localStorage.setItem(
      STORAGE_KEYS.agentConnection,
      JSON.stringify({ endpoint: 'nope', apiKey: 'k' }),
    )
    expect(loadConnectionConfig().endpoint).toBe('anthropic')
  })
})

describe('ctx.connection', () => {
  beforeEach(() => localStorage.clear())

  it('saves, clears and announces changes', async () => {
    const ctx = new Context()
    await ctx.plugin(ConnectionManager)
    const changed = vi.fn()
    ctx.on('connection/changed', changed)

    expect(ctx.connection.current()).toBeNull()

    ctx.connection.save(config({ baseUrl: 'https://api.neonexus.top', apiKey: 'k', model: 'k3' }))
    expect(changed).toHaveBeenCalledTimes(1)
    expect(ctx.connection.current()).toMatchObject({
      baseUrl: 'https://api.neonexus.top/v1',
      model: 'k3',
      source: 'user',
    })
    expect(loadConnectionConfig().apiKey).toBe('k')

    ctx.connection.clear()
    expect(changed).toHaveBeenCalledTimes(2)
    expect(ctx.connection.current()).toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.agentConnection)).toBeNull()
  })
})

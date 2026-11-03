import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test as base, expect, type Page, type Route } from '@playwright/test'

export const MODEL = 'e2e-vision'
export const API_KEY = 'e2e-fake-key'
export const LLM_ORIGIN = 'https://llm.e2e.invalid'
export const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII='

export interface ModelRequest {
  model: string
  system?: unknown
  tools?: { name: string }[]
  messages: { role: string; content: { type: string; [key: string]: unknown }[] }[]
}

export interface ProcessRecord {
  id: number
  filename: string
  status: 'completed' | 'failed' | 'processing'
  created_at: string
  finished_at: string | null
  started_at: string | null
  error_message: string | null
  source_file_public_id: string
  params_json: string
}

export function processRecord(id: number, overrides: Partial<ProcessRecord> = {}): ProcessRecord {
  return {
    id, filename: `Brain_${id}.imzML`, status: 'completed',
    created_at: new Date().toISOString(), started_at: null,
    finished_at: new Date().toISOString(), error_message: null,
    source_file_public_id: 'E2eDataset0000001', params_json: '{}', ...overrides,
  }
}

/** Protocol responses, not a replacement for the production adapter or runtime. */
export function sseText(text: string): string {
  return sse([{ type: 'text', text }], 'end_turn')
}

export function sseTool(name: string, input: Record<string, unknown> = {}): string {
  return sse([{ type: 'tool_use', id: 'e2e-tool-call', name, input }], 'tool_use')
}

function sse(blocks: Record<string, unknown>[], stopReason: string): string {
  const events: Record<string, unknown>[] = [{
    type: 'message_start', message: {
      id: 'e2e-message', type: 'message', role: 'assistant', model: MODEL, content: [],
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 50, output_tokens: 0 },
    },
  }]
  blocks.forEach((block, index) => {
    const isText = block.type === 'text'
    events.push(
      { type: 'content_block_start', index, content_block: isText ? { type: 'text', text: '' } : { ...block, input: {} } },
      { type: 'content_block_delta', index, delta: isText
        ? { type: 'text_delta', text: block.text }
        : { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } },
      { type: 'content_block_stop', index },
    )
  })
  events.push(
    { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 12 } },
    { type: 'message_stop' },
  )
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
}

export async function fulfillSse(route: Route, body: string): Promise<void> {
  await route.fulfill({ contentType: 'text/event-stream', headers: { 'access-control-allow-origin': '*' }, body })
}

export interface OfflineBackend {
  processes: ProcessRecord[]
  lists: { page: number; size: number; filter: Record<string, string> }[]
  deleted: number[]
  deleteStatus: number
  userStatus: number
  requests: ModelRequest[]
  reply: (route: Route, request: ModelRequest) => Promise<void>
}

export const test = base.extend<{
  backend: OfflineBackend
  connectionModel: string
  signedIn: boolean
  temporaryStorage: boolean
}>({
  context: async ({ context, browserName, playwright, headless, baseURL, locale, viewport, temporaryStorage }, use) => {
    if (browserName !== 'webkit' || temporaryStorage) {
      await use(context)
      return
    }
    // WebKit's private context can reject native getDirectory() with UnknownError.
    // A fresh on-disk profile exercises real OPFS without sharing state between tests.
    const profile = await mkdtemp(join(tmpdir(), 'sxo-e2e-webkit-'))
    try {
      const persistent = await playwright.webkit.launchPersistentContext(profile, {
        headless, baseURL, locale, viewport,
      })
      try {
        // Some WebKit ports share the persistent origin store across profile paths.
        // Reset only this test origin before mounting any application code.
        const resetUrl = new URL('/__e2e_storage_reset__', baseURL).href
        await persistent.route(resetUrl, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>E2E storage reset</title>' }))
        const reset = await persistent.newPage()
        await reset.goto(resetUrl)
        await reset.evaluate(async () => {
          localStorage.clear()
          const root = await navigator.storage.getDirectory()
          try { await root.removeEntry('sxo-sessions-v1', { recursive: true }) }
          catch (error) { if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error }
        })
        await reset.close()
        await persistent.unroute(resetUrl)
        await use(persistent)
      }
      finally { await persistent.close() }
    } finally { await rm(profile, { recursive: true, force: true }) }
  },
  connectionModel: [MODEL, { option: true }],
  signedIn: [true, { option: true }],
  temporaryStorage: [false, { option: true }],
  backend: [async ({ context, connectionModel, signedIn, temporaryStorage }, use) => {
    const backend: OfflineBackend = {
      processes: [], lists: [], deleted: [], deleteStatus: 200, userStatus: 200, requests: [],
      reply: (route) => fulfillSse(route, sseText('E2E answer ready.')),
    }
    const unexpected: string[] = []
    const pageErrors: string[] = []
    context.on('page', (page) => page.on('pageerror', (error) => pageErrors.push(error.message)))
    await context.addInitScript(({ connectionModel, signedIn, temporaryStorage, origin, key }) => {
      if (!/^https?:$/.test(location.protocol)) return
      if (!localStorage.getItem('e2e-initialized')) {
        localStorage.setItem('e2e-initialized', 'true')
        if (signedIn) localStorage.setItem('access_token', 'e2e-fake-token')
        localStorage.setItem('assistant_connection', JSON.stringify({
          endpoint: 'anthropic', baseUrl: origin, apiKey: key, model: connectionModel,
        }))
      }
      if (temporaryStorage) {
        Object.defineProperty(Object.getPrototypeOf(navigator.storage), 'getDirectory', {
          configurable: true,
          value: undefined,
        })
      }
    }, { connectionModel, signedIn, temporaryStorage, origin: LLM_ORIGIN, key: API_KEY })

    const config = JSON.parse(readFileSync(new URL('../../public/config.json', import.meta.url), 'utf8'))
    config.pagination.defaultPageSize = 2
    config.pagination.pageSizeOptions = [2, 5, 10]
    // Deterministic deployment settings; keys and models belong exclusively to this test context.
    config.llm = { ...config.llm, model: '' }
    await context.route('**/config.json', (route) => route.fulfill({ json: config }))
    await context.route((url) => url.pathname.startsWith('/api/'), async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const path = url.pathname.replace(/^\/api/, '')
      if (path === '/user') {
        await route.fulfill({ status: backend.userStatus, json: backend.userStatus === 200
          ? { id: 1, username: 'e2e-user', identity: 'user', email: 'e2e@example.invalid' }
          : { detail: 'Token expired' } })
      } else if (path === '/stats/processing') {
        const counts = (status: string) => backend.processes.filter((p) => p.status === status).length
        await route.fulfill({ json: { processing: counts('processing'), completed: counts('completed'), failed: counts('failed') } })
      } else if (path === '/processes/mine' && request.method() === 'POST') {
        const filter = request.postDataJSON() as Record<string, string>
        const page = Number(url.searchParams.get('page'))
        const size = Number(url.searchParams.get('size'))
        backend.lists.push({ page, size, filter })
        const matches = backend.processes.filter((p) => !filter.filename || p.filename.includes(filter.filename))
        await route.fulfill({ json: {
          data: matches.slice((page - 1) * size, page * size),
          meta: { current_page: page, total_pages: Math.max(1, Math.ceil(matches.length / size)), total_records: matches.length },
        } })
      } else if (/^\/processes\/\d+$/.test(path) && request.method() === 'DELETE') {
        const id = Number(path.split('/').pop())
        backend.deleted.push(id)
        if (backend.deleteStatus === 200) backend.processes = backend.processes.filter((p) => p.id !== id)
        await route.fulfill({ status: backend.deleteStatus, json: { detail: 'E2E delete result' } })
      } else if (path === '/logout') {
        await route.fulfill({ json: {} })
      } else {
        unexpected.push(`${request.method()} ${path}`)
        await route.fulfill({ status: 501, json: { detail: 'Unconfigured E2E endpoint' } })
      }
    })
    // Same adapter in dev (relay) and production (direct fetch).
    await context.route(/(?:llm\.e2e\.invalid|\/llm-relay\/|\/llm-proxy\/)/, async (route) => {
      const request = route.request()
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: {
          'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
        } })
      } else if (new URL(request.url()).pathname.endsWith('/models')) {
        await route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { data: [
          { id: MODEL, input_modalities: ['text', 'image'] },
          { id: 'e2e-text-only', input_modalities: ['text'] },
          { id: 'e2e-blind', input_modalities: ['text', 'image'] },
        ] } })
      } else {
        const body = request.postDataJSON() as ModelRequest
        const probe = body.messages.some((m) => m.content.some((part) => part.type === 'text' && part.text === 'What color is this image? Reply with one word.'))
        if (probe) await fulfillSse(route, sseText(body.model === 'e2e-blind' ? 'red' : 'green'))
        else {
          backend.requests.push(body)
          await backend.reply(route, body)
        }
      }
    })
    await use(backend)
    expect(unexpected, 'All backend requests must have explicit fixtures').toEqual([])
    expect(pageErrors, 'Browser must not have uncaught errors').toEqual([])
  }, { auto: true }],
})

export { expect }

export async function openAgent(page: Page) {
  await page.getByRole('button', { name: 'Open menu', exact: true }).click()
  await page.locator('button[data-tip="SXO-Harness"]').click()
  const panel = page.getByRole('dialog', { name: 'SXO Harness Agent', exact: true })
  await expect(panel).toBeVisible()
  return panel
}

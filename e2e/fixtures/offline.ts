import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test as base, expect, type Page, type Route } from '@playwright/test'

export const MODEL = 'e2e-vision'
export const API_KEY = 'e2e-fake-key'
export const LLM_ORIGIN = 'https://llm.e2e.invalid'
export const OSS_ORIGIN = 'https://oss.e2e.invalid'
/** 1x1 PNG。Firefox 严格校验 chunk CRC，Chromium 不校验，改动后要确认 CRC 仍然正确。 */
export const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='

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

export interface FileRecord {
  public_id: string
  filename: string
  size: number
  status: string
  is_public: boolean
  uploaded_at: string
  first_uploaded_by: string
  organism: string
  organism_part: string
  polarity: string
  image_path: string | null
  default_run_id: number | null
  spectrum_mode?: string
  storage_mode?: string
}

export function fileRecord(publicId: string, overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    public_id: publicId, filename: `${publicId}_Brain.imzML`, size: 1_048_576, status: 'completed',
    is_public: true, uploaded_at: new Date().toISOString(), first_uploaded_by: 'e2e-user',
    organism: 'Human (Homo sapiens)', organism_part: 'Brain', polarity: 'Positive', image_path: null, default_run_id: null,
    ...overrides,
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
  /** 覆盖 GET /user 的身份字段，用来制造资料不完整的账号 */
  profile: Record<string, string>
  files: FileRecord[]
  /** 每次 POST /processes 的请求体 */
  created: { file_public_id: string; algorithms: Record<string, unknown> }[]
  /** 每次 GET /files/{id}/download_raw 请求的 public_id */
  rawDownloads: string[]
  rawDownloadStatus: number
  requests: ModelRequest[]
  reply: (route: Route, request: ModelRequest) => Promise<void>
}

export const test = base.extend<{
  backend: OfflineBackend
  connectionModel: string
  signedIn: boolean
  temporaryStorage: boolean
  /** Linux WebKit 没有 navigator.storage，依赖 OPFS 落盘的用例在那里跳过 */
  opfs: boolean
}>({
  opfs: async ({ browserName }, use) => {
    await use(browserName !== 'webkit' || process.platform === 'darwin')
  },
  context: async ({ context, browserName, playwright, headless, baseURL, locale, viewport, temporaryStorage, opfs }, use) => {
    if (browserName !== 'webkit' || !opfs || temporaryStorage) {
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
      processes: [], lists: [], deleted: [], deleteStatus: 200, userStatus: 200, profile: {},
      files: [], created: [], rawDownloads: [], rawDownloadStatus: 200, requests: [],
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
      if (temporaryStorage && navigator.storage) {
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
          ? {
              id: 1, username: 'e2e-user', identity: 'user', email: 'e2e@example.invalid',
              institution: 'E2E Institute', position: 'Researcher', research_field: 'Imaging', region: 'CN',
              ...backend.profile,
            }
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
      } else if (path === '/processes' && request.method() === 'POST') {
        const body = request.postDataJSON() as OfflineBackend['created'][number]
        backend.created.push(body)
        const process = processRecord(backend.processes.length + 1, {
          status: 'processing', finished_at: null, source_file_public_id: body.file_public_id,
          filename: backend.files.find((f) => f.public_id === body.file_public_id)?.filename ?? 'unknown',
          params_json: JSON.stringify(body.algorithms),
        })
        backend.processes.unshift(process)
        await route.fulfill({ json: process })
      } else if (/^\/processes\/\d+$/.test(path) && request.method() === 'DELETE') {
        const id = Number(path.split('/').pop())
        backend.deleted.push(id)
        if (backend.deleteStatus === 200) backend.processes = backend.processes.filter((p) => p.id !== id)
        await route.fulfill({ status: backend.deleteStatus, json: { detail: 'E2E delete result' } })
      } else if (path === '/files/list_files' || path === '/files/list_user_files') {
        const size = Number(url.searchParams.get('size')) || backend.files.length
        await route.fulfill({ json: {
          data: backend.files.slice(0, size),
          meta: { current_page: 1, total_pages: 1, total_records: backend.files.length },
        } })
      } else if (path === '/users/quota') {
        await route.fulfill({ json: {} })
      } else if (/^\/files\/\w+\/download_raw$/.test(path) && request.method() === 'GET') {
        const publicId = path.split('/')[2]!
        backend.rawDownloads.push(publicId)
        await route.fulfill(backend.rawDownloadStatus === 200
          ? { json: { files: ['imzML', 'ibd'].map((ext) => ({
              filename: `${publicId}.${ext}`, url: `${OSS_ORIGIN}/${publicId}.${ext}?signature=e2e`, size: 1024,
            })) } }
          : { status: backend.rawDownloadStatus, json: { detail: 'E2E download refused' } })
      } else if (path === '/logout') {
        await route.fulfill({ json: {} })
      } else {
        unexpected.push(`${request.method()} ${path}`)
        await route.fulfill({ status: 501, json: { detail: 'Unconfigured E2E endpoint' } })
      }
    })
    await context.route(`${OSS_ORIGIN}/**`, (route) => route.fulfill({
      contentType: 'application/octet-stream', headers: { 'content-disposition': 'attachment' }, body: 'e2e',
    }))
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

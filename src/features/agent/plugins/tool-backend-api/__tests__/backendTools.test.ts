import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SystemPrompt } from '../../system-prompt'
import { ToolRuntime } from '../../tools'
import * as backend from '../index'
import {
  listFiles,
  listUserFiles,
  getFileMetadata,
  listMyProcesses,
} from '@/features/datasets/api/datasetApi'
import { getUserQuota } from '@/shared/api/quotaApi'

vi.mock('@/features/datasets/api/datasetApi', () => ({
  listFiles: vi.fn(),
  listUserFiles: vi.fn(),
  getFileMetadata: vi.fn(),
  listMyProcesses: vi.fn(),
}))
vi.mock('@/shared/api/quotaApi', () => ({ getUserQuota: vi.fn() }))
let ctx: Context
beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(backend)
})
afterEach(async () => {
  await ctx.fiber.dispose()
  vi.clearAllMocks()
})

const run = (name: string, args = {}) =>
  ctx.tools.execute({
    name,
    arguments: args,
    callId: 'test',
    signal: new AbortController().signal,
  })

it('preserves public_id through list to metadata and exposes pagination', async () => {
  const publicId = '0012345678901234'
  vi.mocked(listFiles).mockResolvedValue({
    data: [{ public_id: publicId, filename: 'brain.imzML', uploaded_at: '2026-11-03' }],
    meta: { current_page: 1, total_pages: 3, total_records: 30 },
  })
  vi.mocked(getFileMetadata).mockResolvedValue({ name: 'brain' })
  const list = await run('list_files')
  expect(list.content).toContain(`public_id=${publicId}`)
  expect(list.content).toContain('page: 1 / 3')
  expect(list.content).toContain('2026-11-03')
  expect((await run('get_file_metadata', { fileId: publicId })).content).toContain('name: brain')
  expect(getFileMetadata).toHaveBeenCalledWith(publicId, expect.any(AbortSignal))
})

it('passes execution signals to every backend request', async () => {
  vi.mocked(listFiles).mockResolvedValue([])
  vi.mocked(listUserFiles).mockResolvedValue([])
  vi.mocked(getFileMetadata).mockResolvedValue({})
  vi.mocked(listMyProcesses).mockResolvedValue({ data: [] })
  vi.mocked(getUserQuota).mockResolvedValue({} as never)
  for (const name of [
    'list_files',
    'list_my_files',
    'get_file_metadata',
    'list_my_processes',
    'get_user_quota',
  ])
    expect((await run(name, { fileId: '0012345678901234' })).isError).toBe(false)
  for (const fn of [listFiles, listUserFiles, getFileMetadata, listMyProcesses, getUserQuota]) {
    const call = vi.mocked(fn).mock.calls[0]!
    expect(call[call.length - 1]).toBeInstanceOf(AbortSignal)
  }
})

it('turns an authentication failure into an actionable tool error', async () => {
  vi.mocked(listUserFiles).mockRejectedValue({
    response: { status: 401, data: { detail: 'Login required' } },
  })
  expect(await run('list_my_files')).toMatchObject({
    isError: true,
    content: expect.stringContaining('HTTP 401: Login required'),
  })
})

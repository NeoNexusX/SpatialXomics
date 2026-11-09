import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@/features/datasets/api/datasetApi', () => ({
  listMyProcesses: vi.fn(),
  deleteProcess: vi.fn(),
  getProcessingStats: vi.fn(),
}))

vi.mock('@/shared/config/runtimeConfig', () => ({
  getConfig: () => ({ pagination: { defaultPageSize: 10 } }),
}))

import { getProcessingStats, listMyProcesses } from '@/features/datasets/api/datasetApi'
import { useWorkspaceDashboard } from '../useWorkspaceDashboard'

const listMock = vi.mocked(listMyProcesses)
const statsMock = vi.mocked(getProcessingStats)

/** composable 里有 onMounted，要挂在组件上才和真实页面一致 */
function mountDashboard() {
  let dash!: ReturnType<typeof useWorkspaceDashboard>
  mount({
    setup() {
      dash = useWorkspaceDashboard()
      return () => null
    },
  })
  return dash
}

describe('useWorkspaceDashboard.applySearch', () => {
  beforeEach(() => {
    listMock.mockReset().mockResolvedValue({
      data: [],
      meta: { current_page: 1, total_pages: 1, total_records: 0 },
    })
    statsMock.mockReset().mockResolvedValue({ processing: 0, completed: 0, failed: 0 } as any)
  })

  it('sends only the filename filter and resets to page 1', async () => {
    const dash = mountDashboard()

    await dash.applySearch('mouse')

    // RunFilter 是 AND 语义：params 必须空置，否则与 filename 互相收窄搜不到
    expect(listMock).toHaveBeenLastCalledWith(1, expect.any(Number), { filename: 'mouse' })
  })

  it('trims the query before sending', async () => {
    const dash = mountDashboard()

    await dash.applySearch('  kidney  ')

    expect(listMock).toHaveBeenLastCalledWith(1, expect.any(Number), { filename: 'kidney' })
  })

  it('clears the filter on empty query', async () => {
    const dash = mountDashboard()

    await dash.applySearch('mouse')
    await dash.applySearch('')

    expect(listMock).toHaveBeenLastCalledWith(1, expect.any(Number), {})
  })
})

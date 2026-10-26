import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, type Component } from 'vue'
import { createPinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { authStorage } from '@/shared/auth/authStorage'
import type { DatabaseListParams } from '../../types/database'

// fetcher 链路（sources → siDb → siDbApi）依赖 httpClient：mock 掉避免拖入真实的
// axios / router 模块。authStore 创建时注册 401 清理钩子，mock 模块也要提供。
vi.mock('@/shared/api/httpClient', () => ({
  auth_api: { get: vi.fn(), post: vi.fn() },
  api: { get: vi.fn(), post: vi.fn() },
  registerUnauthorizedHandler: vi.fn(),
}))

// 数据层（api/siDb 的 listSiDbPage）换成内存实现：25 行数据 / 每页 10 条 → 3 页，
// 足够覆盖分页与钳位逻辑；Origin 交替以便筛选测试。failAll 供失败路径用例切换。
// vi.hoisted 让 dataset 在 vi.resetModules() 后仍被闭包引用，调用计数随之累计。
const dataset = vi.hoisted(() => {
  const rows = Array.from({ length: 25 }, (_, i) => ({
    id: `HMDB${String(i + 1).padStart(6, '0')}`,
    name: `Compound ${i + 1}`,
    formula: `C${i + 2}H6`,
    mass: 100 + i + 0.5,
    origin: i % 2 === 0 ? 'endogenous' : 'exogenous',
    inchi: 'InChI=1S/x',
  }))
  return { rows, failAll: false, calls: 0 }
})

vi.mock('../../api/siDb', () => ({
  // 语义对齐真实 fetcher：关键词按 id/名称/分子式子串过滤（大小写不敏感）、
  // origin 精确、质量闭区间、越界页码钳回有效范围
  listSiDbPage: async ({ keyword = '', filters: controls = {}, page, size }: DatabaseListParams) => {
    dataset.calls++
    if (dataset.failAll) throw new Error('backend offline')
    const kw = keyword.trim().toLowerCase()
    const origin = typeof controls.origin === 'string' ? controls.origin : ''
    const mass = controls.mass && typeof controls.mass === 'object' ? controls.mass : {}
    const rows = dataset.rows.filter(
      (r) =>
        (!kw || `${r.id}|${r.name}|${r.formula}`.toLowerCase().includes(kw)) &&
        (!origin || r.origin === origin) &&
        (mass.min == null || r.mass >= mass.min) &&
        (mass.max == null || r.mass <= mass.max),
    )
    const totalPages = Math.max(1, Math.ceil(rows.length / size))
    const current = Math.max(1, Math.min(totalPages, page))
    return {
      data: rows.slice((current - 1) * size, current * size),
      meta: { current_page: current, total_pages: totalPages, total_records: rows.length },
    }
  },
  downloadSiDbCsv: async () => {},
}))

/** 在真实组件 setup 里跑 composable，让 onMounted 生效；authStore 需要 Pinia */
function withSetup<T>(composable: () => T): T {
  let result: T | undefined
  const app = createApp({
    setup() {
      result = composable()
      return () => h('div')
    },
  } satisfies Component)
  app.use(createPinia())
  app.mount(document.createElement('div'))
  app.unmount()
  return result!
}

// composable 静态依赖数据层，用例间重置模块图保持隔离
async function freshApi() {
  const { useDatabaseList } = await import('../useDatabaseList')
  return withSetup(useDatabaseList)
}

beforeEach(() => {
  vi.resetModules()
  dataset.failAll = false
  dataset.calls = 0
  // 页面要求登录：默认带 token
  authStorage.setToken('test-token')
})

afterEach(() => {
  authStorage.clearAuthData()
})

describe('useDatabaseList', () => {
  it('fetches the first page on mount (default page size 50) and fills the meta', async () => {
    const api = await freshApi()
    await flushPromises()
    expect(api.loggedIn.value).toBe(true)
    expect(api.pageSize.value).toBe(50)
    expect(api.pageSizeOptions).toEqual([50, 100])
    expect(api.rows.value).toHaveLength(25)
    expect(api.meta.total_records).toBe(25)
    expect(api.meta.total_pages).toBe(1)
    expect(api.error.value).toBe('')
  })

  it('does not fetch while logged out', async () => {
    authStorage.clearAuthData()
    const api = await freshApi()
    await flushPromises()
    expect(api.loggedIn.value).toBe(false)
    expect(api.rows.value).toHaveLength(0)
    expect(api.loading.value).toBe(false)
    expect(dataset.calls).toBe(0)
  })

  it('clamps goToPage beyond the last page', async () => {
    const api = await freshApi()
    await flushPromises()
    api.changeSize(10)
    await flushPromises()
    api.goToPage(99)
    await flushPromises()
    expect(api.currentPage.value).toBe(3)
    expect(api.meta.current_page).toBe(3)
  })

  it('resets to page 1 when the page size changes', async () => {
    const api = await freshApi()
    await flushPromises()
    api.changeSize(10)
    await flushPromises()
    api.goToPage(3)
    await flushPromises()
    api.changeSize(6)
    await flushPromises()
    expect(api.currentPage.value).toBe(1)
    expect(api.meta.total_pages).toBe(5) // ceil(25/6)
  })

  it('resets to page 1 on search and applies the keyword', async () => {
    const api = await freshApi()
    await flushPromises()
    api.changeSize(10)
    await flushPromises()
    api.goToPage(3)
    await flushPromises()
    api.keyword.value = 'HMDB000005'
    api.handleSearch()
    await flushPromises()
    expect(api.currentPage.value).toBe(1)
    expect(api.rows.value).toHaveLength(1)
    expect(api.rows.value[0]!.id).toBe('HMDB000005')
    // 清空关键词恢复全量
    api.resetSearch()
    await flushPromises()
    expect(api.meta.total_records).toBe(25)
  })

  it('applies filter controls on search and resetSearch clears the whole form', async () => {
    const api = await freshApi()
    await flushPromises()
    expect(api.filtersActive.value).toBe(false)

    api.setFilter('origin', 'exogenous')
    api.handleSearch()
    await flushPromises()
    // 25 行里 Origin 交替：偶数行 endogenous（13），奇数行 exogenous（12）
    expect(api.meta.total_records).toBe(12)
    expect(api.filtersActive.value).toBe(true)

    api.resetSearch()
    await flushPromises()
    expect(api.meta.total_records).toBe(25)
    expect(api.filtersActive.value).toBe(false)
  })

  it('records the error and clears loading when the fetch fails', async () => {
    dataset.failAll = true
    const api = await freshApi()
    await flushPromises()
    expect(api.error.value).toBeTruthy()
    expect(api.loading.value).toBe(false)
    expect(api.rows.value).toHaveLength(0)
  })
})

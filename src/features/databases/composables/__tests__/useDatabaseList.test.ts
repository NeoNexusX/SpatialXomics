import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, type Component } from 'vue'
import { flushPromises } from '@vue/test-utils'

// 测试环境没有 bootstrap 过的 config.json，getConfig() 会抛错 → mock 掉分页配置
vi.mock('@/shared/config/runtimeConfig', () => ({
  getConfig: () => ({ pagination: { defaultPageSize: 10, pageSizeOptions: [6, 10, 20] } }),
}))

// 25 行数据 / 每页 10 条 → 3 页，足够覆盖分页与钳位逻辑
const CSV = [
  'ID,Name,Formula,InChI,Mass',
  ...Array.from(
    { length: 25 },
    (_, i) => `HMDB${String(i + 1).padStart(6, '0')},Compound ${i + 1},C${i + 2}H6,"InChI=1S/x",${100 + i}.5`,
  ),
].join('\n')

function stubFetch(body: string, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
    })),
  )
}

/** 在真实组件 setup 里跑 composable，让 onMounted 生效 */
function withSetup<T>(composable: () => T): T {
  let result: T | undefined
  const app = createApp({
    setup() {
      result = composable()
      return () => h('div')
    },
  } satisfies Component)
  app.mount(document.createElement('div'))
  app.unmount()
  return result!
}

// composable 静态依赖 hmdbCsv 适配器（带模块级缓存），用例间重置模块图保持隔离
async function freshApi() {
  const { useDatabaseList } = await import('../useDatabaseList')
  return withSetup(useDatabaseList)
}

beforeEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()
})

describe('useDatabaseList', () => {
  it('fetches the first page on mount and fills the pagination meta', async () => {
    stubFetch(CSV)
    const api = await freshApi()
    await flushPromises()
    expect(api.rows.value).toHaveLength(10)
    expect(api.meta.total_records).toBe(25)
    expect(api.meta.total_pages).toBe(3)
    expect(api.error.value).toBe('')
  })

  it('clamps goToPage beyond the last page', async () => {
    stubFetch(CSV)
    const api = await freshApi()
    await flushPromises()
    api.goToPage(99)
    await flushPromises()
    expect(api.currentPage.value).toBe(3)
    expect(api.meta.current_page).toBe(3)
  })

  it('resets to page 1 when the page size changes', async () => {
    stubFetch(CSV)
    const api = await freshApi()
    await flushPromises()
    api.goToPage(3)
    await flushPromises()
    api.changeSize(6)
    await flushPromises()
    expect(api.currentPage.value).toBe(1)
    expect(api.meta.total_pages).toBe(5) // ceil(25/6)
  })

  it('resets to page 1 on search and applies the keyword', async () => {
    stubFetch(CSV)
    const api = await freshApi()
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
    api.resetKeyword()
    await flushPromises()
    expect(api.meta.total_records).toBe(25)
  })

  it('records the error and clears loading when the fetch fails', async () => {
    stubFetch('', false)
    const api = await freshApi()
    await flushPromises()
    expect(api.error.value).toBeTruthy()
    expect(api.loading.value).toBe(false)
    expect(api.rows.value).toHaveLength(0)
  })
})

import { test, expect } from '@playwright/test'

/**
 * /database（SI_DB · HMDB 注释库浏览页）E2E 冒烟
 * ============================================================
 * 逻辑层（请求形状 / CSV 解析）已被单测覆盖；这里只测真实浏览器
 * 才能暴露的渲染与装配层：路由守卫、表格与筛选交互、整库 CSV 两步下载
 * （拦截接口，不做真实 38.5MB 下载）、后端不可用时的错误态与重试。
 *
 * 断言基于 live 全量库与本地样本共有的数据（两边第一行都是 HMDB0000001 /
 * 1-Methylhistidine 附近的数据），不依赖具体总数。
 */

/** 未登录组：storageState 清空（与 auth.spec 组 1 同款） */
test.describe('Database · unauthenticated', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('route guard — redirects to login with redirect param', async ({ page }) => {
    await page.goto('/database')

    await expect(page).toHaveURL(/\/login/)
    expect(page.url()).toContain('redirect=')
  })
})

test.describe('Database · signed in', () => {
  test('renders the HMDB tab, table rows and pagination footer', async ({ page }) => {
    await page.goto('/database')

    await expect(page.getByRole('heading', { name: 'Database' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'HMDB 4.0 Metabolites' })).toBeVisible()
    // 首行是 HMDB 编号（loading 骨架行没有文本，等待自动落到真实数据行上）
    await expect(page.locator('tbody tr').first()).toContainText('HMDB')
    await expect(page.getByText(/^Page 1 of/)).toBeVisible()
  })

  test('keyword search narrows the table', async ({ page }) => {
    await page.goto('/database')

    await page.getByPlaceholder('Search ID, name or formula...').fill('1-Methylhistidine')
    await page.getByRole('button', { name: 'Search' }).click()

    await expect(page.locator('tbody tr').first()).toContainText('1-Methylhistidine')
  })

  test('origin select applies immediately and filters rows', async ({ page }) => {
    await page.goto('/database')

    // select 即选即搜（aria-label 来自 databases.hmdb.filter.origin）
    await page.getByLabel('Origin').selectOption({ label: 'Endogenous' })

    await expect(page.locator('tbody tr').first()).toContainText('Endogenous')
  })

  test('pagination — Next advances the page summary', async ({ page }) => {
    await page.goto('/database')

    // 样本 60 条 → 2 页；live 11 万条 → 上千页，Next 两边都可点
    await expect(page.getByText(/^Page 1 of/)).toBeVisible()
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByText(/^Page 2 of/)).toBeVisible()
  })

  test('download full CSV — two-step flow hands the browser a relay link', async ({ page }) => {
    // 第一步换直链：拦截并回一个指向本页 origin 的 relay 地址（真实后端回的是
    // 它自己的绝对地址，浏览器直接导航过去；同 origin 便于第二步也拦截）
    const firstStepUrls: string[] = []
    await page.route('**/api/annotations/si-db/download*', async (route) => {
      firstStepUrls.push(route.request().url())
      const relay = new URL('/api/annotations/si-db/relay/download?token=e2e', page.url()).toString()
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ filename: 'SI_DB.csv', url: relay, size: 57 }),
      })
    })
    // 第二步直链：回一个极小的 CSV，断言下载事件而非真实 38.5MB
    await page.route('**/api/annotations/si-db/relay/download*', (route) =>
      route.fulfill({
        contentType: 'text/csv',
        headers: { 'Content-Disposition': 'attachment; filename="SI_DB.csv"' },
        body: 'ID,Name,Formula\nHMDB0000001,1-Methylhistidine,C7H11N3O2\n',
      }),
    )

    await page.goto('/database')
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download full CSV' }).click(),
    ])

    expect(firstStepUrls).toHaveLength(1)
    expect(await download.suggestedFilename()).toBe('SI_DB.csv')
  })

  test('shows the error state with retry when the list endpoint is unreachable', async ({ page }) => {
    // 模拟后端不可达（连接失败）：明确报错（不回退样本），错误态提供重试
    await page.route('**/api/annotations/si-db/list*', (route) => route.abort())

    await page.goto('/database')

    await expect(page.locator('.alert-error')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
    // 行数据为空：表格走空态而不是残缺数据
    await expect(page.getByText('No records found.')).toBeVisible()
  })
})

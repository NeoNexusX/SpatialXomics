import { expect, test, type Locator, type Page } from '@playwright/test'

const mobileViewport = { width: 390, height: 844 }
const emptyStorage = { cookies: [], origins: [] }

async function expectNoHorizontalPageOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true)
}

async function expectInsideViewport(target: Locator) {
  await target.scrollIntoViewIfNeeded()
  await expect(target).toBeVisible()
  await expect(target).toBeInViewport({ ratio: 1 })
  const box = await target.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(mobileViewport.width)
}

test.describe('mobile responsive layout', () => {
  test.use({ storageState: emptyStorage, viewport: mobileViewport })

  test('keeps the home join and dataset actions within the mobile viewport', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    // 注册入口在 Hero，数据集入口已移到 Stats 的 KPI 卡；分别滚动到对应入口检查。
    const join = page.locator('#hero').getByRole('link', { name: 'Join to start', exact: true })
    const datasets = page.locator('#stats').getByRole('link', { name: 'View Datasets', exact: true })
    await expect(join).toHaveAttribute('href', '/register')
    await expectInsideViewport(join)
    await expect(datasets).toHaveAttribute('href', '/datasets')
    await expectInsideViewport(datasets)
    await expectNoHorizontalPageOverflow(page)
  })

  test('keeps dataset controls readable without page overflow', async ({ page }) => {
    await page.goto('/datasets')

    await expect(page.getByRole('heading', { name: 'Public Datasets' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Search' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add filter' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Upload New Dataset' })).toBeVisible()

    // 排序下拉的 option value 是「字段:方向」复合值（DatasetFilterBar），
    // 不再是裸的 submission_time；用前缀匹配避免方向字面量写死在这里。
    const sort = page
      .locator('select')
      .filter({ has: page.locator('option[value^="submission_time"]') })
    await expect(sort).toBeVisible()
    expect((await sort.boundingBox())!.width).toBeGreaterThan(120)
    await expectNoHorizontalPageOverflow(page)
  })

  test('keeps auth forms within the phone viewport', async ({ page }) => {
    for (const path of ['/login', '/register', '/forgotpassword']) {
      await page.goto(path)
      await expectNoHorizontalPageOverflow(page)
    }

    await page.goto('/register')
    const heading = page.getByRole('heading', { name: 'Create Account' })
    await expect(heading).toBeVisible()
    const fontSize = await heading.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    )
    expect(fontSize).toBeLessThanOrEqual(40)
  })
})

test.describe('authenticated mobile shells', () => {
  test.use({ storageState: emptyStorage, viewport: mobileViewport })

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('access_token', 'responsive-layout-token'))
    // 用假 token 假后端，因此必须兜住所有可能 401 的 /api 请求，而不只是 /user：
    // 一旦漏拦，httpClient 的全局 401 处理会清掉 localStorage 里的 token 并跳
    // /login，测试就变成在测「未登录守卫」而非响应式布局。
    //
    // 必须把 /api 锚在站点根路径上：glob '**/api/**' 会连 dev server 直供的源码
    // 模块 /src/shared/api/httpClient.ts 一起拦下，让 router 的动态 import 收到
    // application/json 而整页启动失败（CI 跑构建产物没有源码路径，只有本地 dev 会中招）。
    await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
      if (route.request().url().includes('/api/user')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            username: 'responsive-user',
            identity: 'user',
            email: 'responsive@example.com',
            institution: '',
            position: '',
            research_field: '',
            region: '',
            orcid: '',
            homepage: '',
          }),
        })
      } else {
        // 其余接口（列表、配额、统计等）一律返回空 JSON；页面有兜底渲染
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: '{}',
        })
      }
    })
  })

  for (const [path, headingName] of [
    ['/mydatasets', 'My Datasets'],
    ['/workspace', 'Workspace'],
    ['/workspace/new', 'Create New Analysis'],
    ['/profile', 'Profile'],
  ] as const) {
    test(`${path} fits the mobile viewport`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: headingName })).toBeVisible()
      await expectNoHorizontalPageOverflow(page)
    })
  }
})

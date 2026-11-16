import { test, expect, type APIRequestContext } from '@playwright/test'

/**
 * 公开 Overview 分享链接 E2E — 真实后端
 * ====================================
 * 路由 /s/:token（router/index.ts 的 SharedDatasetOverview）。
 * token 是 16 位 public_id 明文（buildOverviewShareUrl 产出的链接格式）。
 *
 * 后端契约：分享内容也需要登录态——匿名访问 401，页面就地渲染
 * 「登录 / 注册」引导（useDatasetDetail.requiresAuth），不再直接出内容。
 * 因此分两组：
 *   - 未登录（默认清空登录态）：登录引导 / 无效链接 / Back 回公开列表
 *   - 已登录：分享链接打开内容；合法格式但后端无此文件 → No data available
 */

/** 刻意拼一个格式合法（16 位 base62）但后端不存在的 public_id */
const NONEXISTENT_PUBLIC_ID = 'NoSuChId00000000'

/** 从后端取一个真实的公开数据集（public_id 直接来自列表响应），取不到则由调用方 test.skip */
async function firstPublicFile(request: APIRequestContext) {
  const res = await request.post('/api/files/list_files?page=1&size=1', { data: {} })
  if (!res.ok()) return null
  const body = await res.json()
  const item = body?.data?.[0]
  return item?.public_id
    ? { publicId: item.public_id as string, filename: item.filename as string }
    : null
}

test.describe('Shared Dataset Overview — signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('shows a sign-in gate instead of dataset content', async ({ page, request }) => {
    const file = await firstPublicFile(request)
    if (!file) {
      test.skip(true, 'No public dataset available on this backend')
      return
    }

    await page.goto(`/s/${file.publicId}`)
    await expect(page.locator('.skeleton')).toHaveCount(0, { timeout: 15_000 })

    // 匿名 401 → 登录/注册引导卡；数据内容不出现在页面或 a11y 树里
    const gate = page.locator('.card', { hasText: 'Sign in to view dataset details' })
    await expect(gate).toBeVisible()
    await expect(gate.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await expect(gate.getByRole('button', { name: 'Register' })).toBeVisible()
    await expect(page.getByText(file.filename)).toHaveCount(0)
    await expect(page.getByText('Invalid share link')).toHaveCount(0)
  })

  test('treats a malformed id as an invalid link', async ({ page }) => {
    await page.goto('/s/not-base64-%20')

    await expect(page.getByText('Invalid share link')).toBeVisible()
    await expect(page.getByText('This public overview link is invalid.')).toBeVisible()
  })

  test('sends the visitor back to the public dataset list', async ({ page, request }) => {
    const file = await firstPublicFile(request)
    if (!file) {
      test.skip(true, 'No public dataset available on this backend')
      return
    }

    await page.goto(`/s/${file.publicId}`)
    await expect(page.locator('.skeleton')).toHaveCount(0, { timeout: 15_000 })

    await page.getByRole('button', { name: 'Back to Public Datasets' }).click()

    await expect(page).toHaveURL(/\/datasets/)
    await expect(page.locator('h1:has-text("Public Datasets")')).toBeVisible()
  })
})

test.describe('Shared Dataset Overview — signed in', () => {
  // 后端要求分享内容也带登录态；这组复用 auth setup 存的登录态
  test.use({ storageState: '.auth/user.json' })

  test('opens a shared dataset and shows its content', async ({ page, request }) => {
    const file = await firstPublicFile(request)
    if (!file) {
      test.skip(true, 'No public dataset available on this backend')
      return
    }

    await page.goto(`/s/${file.publicId}`)
    await expect(page.locator('.skeleton')).toHaveCount(0, { timeout: 15_000 })

    await expect(page.locator('h1:has-text("Dataset Overview")')).toBeVisible()
    await expect(page.getByText(file.filename).first()).toBeVisible()
    await expect(page.getByText('File Information')).toBeVisible()
    await expect(page.getByText('Invalid share link')).toHaveCount(0)
  })

  test('reports a link that decodes but points nowhere', async ({ page }) => {
    // 格式合法、后端无此公开文件 → 不是「链接无效」，而是「查不到数据」
    await page.goto(`/s/${NONEXISTENT_PUBLIC_ID}`)

    await expect(page.locator('.skeleton')).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByText('No data available')).toBeVisible()
  })
})

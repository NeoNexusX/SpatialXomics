import { test, expect, fileRecord, OSS_ORIGIN } from './fixtures/offline.js'

const PUBLIC_ID = 'E2eDataset000001'

/**
 * 下载链路的前端行为：签发、触发、限流提示都不依赖 OSS 和账号配额，这里在各浏览器上确定地验证。
 * 真实后端签发和真实 OSS 下载由 datasets.spec.ts 和 upload.spec.ts 覆盖。
 */
for (const path of ['/datasets', '/mydatasets'] as const) {
  test.describe(`downloads on ${path}`, () => {
    test.beforeEach(({ backend }) => {
      backend.files = [fileRecord(PUBLIC_ID)]
    })

    test('requests one signed pair, opens both files, then enforces the cooldown', async ({ page, backend, browserName }) => {
      // 只等 Chromium 的 download 事件：Linux WebKit 的 headless 下载不稳定，Firefox 由 upload.spec 的真实下载覆盖
      const downloads = browserName === 'chromium'
        ? Promise.all([
            page.waitForEvent('download', (d) => d.suggestedFilename().endsWith('.imzML')),
            page.waitForEvent('download', (d) => d.suggestedFilename().endsWith('.ibd')),
          ])
        : null
      await page.goto(path)
      const download = page.getByRole('button', { name: 'Download', exact: true })
      await download.click()
      await expect(page.getByText('Download started', { exact: true })).toBeVisible()
      expect(backend.rawDownloads).toEqual([PUBLIC_ID])
      await expect(page.locator(`iframe[src^="${OSS_ORIGIN}/"]`)).toHaveCount(2)
      await downloads

      await download.click()
      await expect(page.getByText(/^Download is limited/)).toBeVisible()
      expect(backend.rawDownloads).toEqual([PUBLIC_ID])
    })

    test('reports the server download limit without starting a cooldown', async ({ page, backend }) => {
      backend.rawDownloadStatus = 403
      await page.goto(path)
      const download = page.getByRole('button', { name: 'Download', exact: true })
      await download.click()
      await expect(page.getByText('Download limit reached', { exact: true })).toBeVisible()
      await expect(page.locator('iframe')).toHaveCount(0)

      backend.rawDownloadStatus = 200
      await download.click()
      await expect(page.getByText('Download started', { exact: true })).toBeVisible()
      expect(backend.rawDownloads).toEqual([PUBLIC_ID, PUBLIC_ID])
    })

    test('asks for a complete profile before requesting signed URLs', async ({ page, backend }) => {
      backend.profile = { region: '' }
      await page.goto(path)
      await page.getByRole('button', { name: 'Download', exact: true }).click()
      await expect(page.getByText(/^Please complete your institution/)).toBeVisible()
      expect(backend.rawDownloads).toEqual([])
    })
  })
}

test.describe('downloads when signed out', () => {
  test.use({ signedIn: false })

  test('sends the visitor to login and back to the public list', async ({ page, backend }) => {
    backend.files = [fileRecord(PUBLIC_ID)]
    await page.goto('/datasets')
    await page.getByRole('button', { name: 'Download', exact: true }).click()
    await expect(page).toHaveURL(/\/login\?redirect=(\/|%2F)datasets$/)
    expect(backend.rawDownloads).toEqual([])
  })
})

import { test, expect } from '@playwright/test'

/**
 * Workspace E2E 测试 — 真实后端
 * ==============================
 * /workspace 任务列表页的纯 UI：summary 卡与 Recent Results、入口导航，
 * 以及不带任务状态直接进入 /vizworkbench 的空态。
 *
 * 涉及真实后端任务的链路不在本文件：
 *   - Peak Alignment 链路（submit → 查看 → 清理）见 new-analysis.spec.ts
 */

test.describe('Workspace', () => {

  test('page loads with summary cards and recent results', async ({ page }) => {
    await page.goto('/workspace')

    await expect(page.locator('h1:has-text("Workspace")')).toBeVisible()

    // 三张 SummaryCard（通过唯一副标题区分）
    await expect(page.getByText('Active preprocessing tasks')).toBeVisible()
    await expect(page.getByText('Successfully completed')).toBeVisible()
    await expect(page.getByText('Requires review')).toBeVisible()

    // Recent Results 区块
    await expect(page.getByText('Recent Results')).toBeVisible()
  })

  test('New Task — navigates to create analysis page', async ({ page }) => {
    await page.goto('/workspace')

    await page.getByRole('link', { name: 'New Task' }).click()

    await expect(page).toHaveURL(/\/workspace\/new/)
    await expect(page.locator('h1:has-text("Create New Analysis")')).toBeVisible()
  })

  test('Go to MyDatasets — navigates to my datasets page', async ({ page }) => {
    await page.goto('/workspace')

    await page.getByRole('link', { name: 'Go to MyDatasets' }).click()

    await expect(page).toHaveURL(/\/mydatasets/)
    await expect(page.locator('h1:has-text("My Datasets")')).toBeVisible()
  })
})

// ============================================================
// 可视化工作台（空态，无后端任务依赖，全浏览器）
// ============================================================

// 无 history.state 直接访问 /vizworkbench：Workspace 任务结果页的空态。
// 带真实结果的渲染/交互见 new-analysis.spec.ts 的 Peak Alignment journey。
test.describe('VizWorkbench', () => {
  test('shows stale state when accessed directly', async ({ page }) => {
    await page.goto('/vizworkbench')
    await expect(page.getByText('No result selected')).toBeVisible()
  })
})

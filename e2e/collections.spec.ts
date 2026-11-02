import { test, expect, type Locator, type Page } from '@playwright/test'

/**
 * Collections E2E 测试 — 真实后端
 * ==============================
 * 覆盖：列表页（加载 / 服务端搜索与清空）、创建→编辑→成员管理（添加 / 调序；
 * 移除成员因后端 DELETE 500 暂跳过，见用例内注释）→ 删除全流程、
 * 分享页（查看需登录：匿名弹登录页，登录态只读可看）。
 *
 * 全流程依赖后端已有 ≥4 个「public + completed + imzML」数据集（建集合选 3 个、
 * 加成员弹窗再加 1 个）；不足时跳过，避免空环境下误报（与 datasets.spec 的
 * skip 策略一致）。
 */

/**
 * 选择器里可加入集合的行：跳过被禁选的「已在集合中」行（创建页与加成员弹窗共用）。
 * 用原生 :has(> …) 而不是 filter({ has })：has 的内层 locator 会被重新挂到
 * 候选 li 下解析，带上弹窗作用域前缀就永远匹配不到（首跑即踩坑）
 */
function eligibleRows(scope: Page | Locator) {
  return scope.locator('li:has(> input[type="checkbox"][aria-label^="Select "]:not([disabled]))')
}

/** 在 scope（创建页 / 加成员弹窗）里勾选第 index 个可加入的公开 imzML 数据集，返回名称 */
async function pickEligibleDataset(scope: Page | Locator, index = 0): Promise<string | null> {
  const rows = eligibleRows(scope)
  await expect(rows.nth(index).or(scope.getByText('No public datasets found.'))).toBeVisible({
    timeout: 15_000,
  })
  if ((await rows.count()) <= index) return null

  const row = rows.nth(index)
  const label = (await row.locator('input[type="checkbox"]').getAttribute('aria-label')) || ''
  await row.click()
  return label.replace(/^Select /, '')
}

/** Step 4 元数据表单：给 list 字段（TagInput，data-field = 字段显示名）追加一个词表值 */
async function fillTagField(page: Page, field: string, value: string) {
  const input = page.locator(`[data-field="${field}"] input`)
  await input.click()
  await input.fill(value)
  await input.press('Enter')
}

/**
 * 必填 list 字段的词表原值。Member Type / Collection Type 不能从成员推导，
 * 总是手填；其余 6 个字段选中数据集时会自动预填，Create 仍禁用说明后端数据
 * 不全，逐个兜底——让用例只取决于测试可控项，而不依赖数据集元数据质量。
 */
const REQUIRED_FALLBACK: readonly (readonly [field: string, value: string])[] = [
  ['Member Type', 'MSI'],
  ['Collection Type', 'Serial sections'],
  ['Organism', 'Human (Homo sapiens)'],
  ['Organism Part', 'Brain'],
  ['Sample Stabilization', 'Fresh frozen'],
  ['Polarity', 'Positive'],
  ['Ionisation Source', 'MALDI'],
  ['Analyzer', 'Orbitrap Exploris 480'],
]

// ============================================================
// 列表页
// ============================================================

test.describe('Collections list', () => {
  test('page loads with header, search and toolbar controls', async ({ page }) => {
    await page.goto('/collections')

    await expect(page.locator('h1:has-text("Collections")')).toBeVisible()
    await expect(page.getByPlaceholder('Search collections')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create Collection' })).toBeVisible()
    // 工具栏：筛选面板入口 + 范围切换（排序是 updated_at 倒序单选项，无交互可测）
    await expect(page.getByRole('button', { name: 'Add filter' })).toBeVisible()
    await expect(page.getByText('My collections only')).toBeVisible()

    // 列表或空态至少呈现一个
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })
  })

  test('server search shows no-result state, clear restores', async ({ page }) => {
    await page.goto('/collections')
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })

    // 搜索走服务端 name 模糊（POST body），无结果空态由前端渲染。
    // 不先等 .animate-pulse 清零再断言：骨架未挂出时 count(0) 会提前通过，
    // 随后的空态断言就撞上加载中（firefox 上实测踩到），直接等空态本身
    await page.getByPlaceholder('Search collections').fill('zzz-no-such-collection')
    await page.getByRole('button', { name: 'Search' }).click()
    await expect(page.getByText('No collections found')).toBeVisible({ timeout: 15_000 })

    // Clear Search：清词重拉，输入框跟着清空（searchApplied watcher 联动）
    await page.getByRole('button', { name: 'Clear Search' }).click()
    await expect(page.getByPlaceholder('Search collections')).toHaveValue('', { timeout: 15_000 })
    await expect(page.getByText('No collections found')).toHaveCount(0, { timeout: 15_000 })
  })
})

// ============================================================
// 全流程：创建 → 编辑 → 成员管理 → 删除
// ============================================================

test.describe('Collection full lifecycle', () => {
  test('create, edit metadata, add/reorder/remove members, then delete', async ({ page }) => {
    test.setTimeout(120_000)
    const name = `E2E Collection ${Date.now()}`

    // ---- 创建：选 3 个成员 + Step 4 必填元数据 ----
    await page.goto('/collections/new')
    await expect(page.locator('h2:has-text("Step 1: Choose Datasets")')).toBeVisible()

    const rows = eligibleRows(page)
    await expect(rows.first().or(page.getByText('No public datasets found.'))).toBeVisible({
      timeout: 15_000,
    })
    test.skip((await rows.count()) < 4, '需要 ≥4 个可加入集合的公开 imzML 数据集（建集合选 3 个 + 加成员 1 个）')
    for (let i = 0; i < 3; i++) await pickEligibleDataset(page, i)

    await expect(page.locator('h2:has-text("Step 2: Arrange Order")')).toBeVisible()
    await page.getByPlaceholder('e.g. Human Kidney MALDI Atlas').fill(name)

    // 两个不可推导的必填字段总填；其余按 Create 是否解禁逐个兜底（见 REQUIRED_FALLBACK）
    await fillTagField(page, 'Member Type', 'MSI')
    await fillTagField(page, 'Collection Type', 'Serial sections')
    const createBtn = page.getByRole('button', { name: 'Create Collection' })
    for (const [field, value] of REQUIRED_FALLBACK.slice(2)) {
      if (await createBtn.isEnabled()) break
      await fillTagField(page, field, value)
    }
    await expect(createBtn).toBeEnabled()
    await createBtn.click()

    // 跳转 overview（public_id 进路径，与列表页新标签页打开的 URL 同构）
    await expect(page).toHaveURL(/\/collections\/overview\/[A-Za-z0-9]+$/, { timeout: 15_000 })
    await expect(page.locator('.toast')).toContainText('Created', { timeout: 10_000 })
    await expect(page.locator('h1')).toContainText(name)
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Collection Metadata' })).toBeVisible()

    // ---- 分享页（查看需登录，与数据集分享页统一）----
    // 匿名弹登录的契约由「Public collection page (login required)」组覆盖：本机
    // browser.newContext() 会带上已登录的 localStorage，造不出真匿名态，不可靠。
    // 此处验证登录态访问分享 URL 的只读渲染（与 overview 同构）。
    const publicId = page.url().match(/\/collections\/overview\/([A-Za-z0-9]+)/)?.[1]
    expect(publicId, 'overview URL 应带 publicId').toBeTruthy()
    await page.goto(`/collections/${publicId}`)
    await expect(page.locator('.skeleton')).toHaveCount(0, { timeout: 15_000 })
    await expect(page.locator('h1')).toContainText(name)
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible()
    await expect(page.getByText('Collection not found')).toHaveCount(0)
    // 回到 overview 继续后续「编辑」环节
    await page.goto(`/collections/overview/${publicId}`)
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible({ timeout: 15_000 })

    // ---- 编辑：页内原地改元数据（改名 + 简介 + 学术字段 Title）----
    // toast 是保存真正落到后端的信号（头部是草稿联动，不能单独作数）
    await page.getByRole('button', { name: 'Edit' }).click()
    const renamed = `${name} (edited)`
    const newTitle = 'E2E Title Before Delete'
    await page.locator('input[maxlength="80"]').fill(renamed)
    // 编辑表单里 Description/Citation/Abstract 三个 textarea 同为 maxlength=300，按角色+名称定位
    await page.getByRole('textbox', { name: 'Description' }).fill('E2E description before delete')
    await page.getByPlaceholder('Enter the article title').fill(newTitle)
    await page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(page.locator('.toast')).toContainText('Updated', { timeout: 15_000 })
    await expect(page.locator('h1')).toContainText(renamed)
    // 保存后只读面板回显新 Title（头部副标题同源，first() 避免双命中）
    await expect(page.getByText(newTitle).first()).toBeVisible()

    // ---- 成员管理 ----
    // 可见的 Select 复选框只有成员行的：加成员弹窗关闭时不进可访问性树，
    // 元数据面板（非编辑态）也没有复选框
    const memberNames = () =>
      page
        .locator('input[type="checkbox"][aria-label^="Select "]:visible')
        .evaluateAll((els) =>
          els.map((e) => (e.getAttribute('aria-label') || '').replace(/^Select /, '')),
        )
    await expect
      .poll(async () => (await memberNames()).length, { timeout: 15_000 })
      .toBe(3)

    // 添加：弹窗选择器自动排除已在集合中的成员（行禁选）
    await page.getByRole('button', { name: 'Add Members' }).click()
    const modal = page.locator('dialog.modal-open .modal-box')
    await expect(modal).toBeVisible()
    const added = await pickEligibleDataset(modal, 0)
    expect(added, '加成员弹窗里应有未入集的公开 imzML 数据集').toBeTruthy()
    await modal.getByRole('button', { name: /^Add 1 dataset$/ }).click()
    await expect(page.locator('.toast')).toContainText('Added', { timeout: 15_000 })
    await expect(modal).toBeHidden()
    await expect
      .poll(async () => (await memberNames()).length, { timeout: 15_000 })
      .toBe(4)

    // 调序：调序控件（手柄拖拽 + 上移/下移）仅编辑态出现，先进 Edit 再操作
    await page.getByRole('button', { name: 'Edit' }).click()
    const before = await memberNames()
    await page.getByRole('button', { name: `Move ${before[0]!} down`, exact: true }).click()
    await expect
      .poll(memberNames, { timeout: 15_000 })
      .toEqual([before[1]!, before[0]!, before[2]!, before[3]!])
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()

    // ---- 移除成员：整块跳过 ----
    // 后端 DELETE /collections/{public_id}/members 自 public_id 迁移起 500
    // （2026-09-24 实测连空数组都挂），该功能先不测——不发请求也不做对账断言。
    // 不能用 test.skip：会连带跳过下面的删集合收尾，留下脏数据。
    // 后端修复后恢复为：勾选首行 → Remove Selected (1) → 成功 toast + 成员数回到 3。

    // ---- 删除集合 → 回列表 ----
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    const confirmBox = page.locator('dialog.modal-open .modal-box')
    await expect(confirmBox).toContainText('Delete collection?')
    await confirmBox.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page).toHaveURL(/\/collections$/, { timeout: 15_000 })
  })
})

// ============================================================
// 分享链接复制（c0455d9：卡片 Share → navigator.clipboard）
// ============================================================

test.describe('Share link copy', () => {
  test('copies the public collection URL to the clipboard', async ({ page, request, browserName }) => {
    // 剪贴板权限只有 Chromium 支持 grantPermissions（Firefox/WebKit 会挂）
    test.skip(browserName !== 'chromium', 'clipboard 权限仅 Chromium 可授予')
    // 后端不保证有存量集合：API 建临时集合 → 测 → 删，自足不依赖环境。
    // request fixture 不带登录态（实测 POST /api/collections 401），显式登录拿 token
    const files = await request.post('/api/files/list_files?page=1&size=1', { data: {} })
    const memberId = ((await files.json())?.data ?? [])[0]?.public_id
    test.skip(!memberId, 'No public dataset available on this backend')

    const username = process.env.E2E_USERNAME
    const password = process.env.E2E_PASSWORD
    if (!username || !password) {
      test.skip(true, '缺少 E2E_USERNAME / E2E_PASSWORD 环境变量')
      throw new Error('skipped')
    }
    const login = await request.post('/api/login', { form: { username, password } })
    test.skip(!login.ok(), '登录失败，无法建临时集合')
    const auth = { Authorization: `Bearer ${(await login.json()).access_token}` }

    const name = `E2E Share Copy ${Date.now()}`
    const created = await request.post('/api/collections', {
      headers: auth,
      data: { name, file_public_ids: [memberId] },
    })
    const publicId = (await created.json())?.public_id
    test.skip(!publicId, '临时集合创建失败')
    try {
      // 授予剪贴板读写权限（localhost 属安全上下文，API 可用）
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

      await page.goto('/collections')
      await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })

      // 服务端搜索锁定刚建的集合，再点卡片上的 Share 按钮（title 钉死）
      await page.getByPlaceholder('Search collections').fill(name)
      await page.getByRole('button', { name: 'Search' }).click()
      await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })
      await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 })

      await page.locator('button[title="Copy share link"]').first().click()

      // 剪贴板内容 = 分享页 URL（与 PublicCollectionView 同构；查看需登录）
      const copied = await page.evaluate(() => navigator.clipboard.readText())
      expect(copied).toContain(`/collections/${publicId}`)
    } finally {
      await request.delete(`/api/collections/${publicId}`, { headers: auth })
    }
  })
})

// ============================================================
// 分享页（查看需登录）
// ============================================================

test.describe('Public collection page (login required)', () => {
  // 清空登录态：匿名访问任何 /collections/:id（含无效 id）都被路由守卫
  // 弹去 /login 且带回跳地址，页面本身不再渲染
  test.use({ storageState: { cookies: [], origins: [] } })

  test('anonymous visit redirects to login with redirect back', async ({ page }) => {
    await page.goto('/collections/00000000000000000000000000000000')
    // vue-router 不对 query 值做百分号编码，斜杠原样出现在 URL 里
    await expect(page).toHaveURL(/\/login\?redirect=(\/|%2F)collections\//, { timeout: 15_000 })
    await expect(page.getByText('Collection not found')).toHaveCount(0)
  })
})

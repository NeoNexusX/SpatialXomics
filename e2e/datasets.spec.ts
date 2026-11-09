import { test, expect, type Page, type Locator } from '@playwright/test'
import { sizeToMB, startRawDownload, ALGO_DATASET_NAMES } from './utils.js'

const MAX_DOWNLOAD_MB = 300

/**
 * 为 visualize 入口用例挑一个**已有默认运行**的 ALGO_DATASET_NAMES 数据集并返回其
 * 卡片（按钮为 Visualize）。按声明顺序尝试；全部未转换或不存在时返回 null
 * （调用方据此 test.skip）。
 *
 * 注意：数据集被 PA journey（new-analysis.spec）或历史上的 explore 跑过一次后，
 * 卡片按钮就从 Explore 变成 Visualize（"已转换"标记不随 Cleanup 删任务行清除）。
 */
async function findVisualizableDatasetCard(page: Page): Promise<{ card: Locator; name: string } | null> {
  for (const name of ALGO_DATASET_NAMES) {
    const search = page.getByPlaceholder('Search my datasets')
    await search.fill(name)
    await page.getByRole('button', { name: 'Search' }).click()
    // 直接等搜索结果里的目标卡片出现，不用 .animate-pulse 计数兜底——
    // 骨架未挂出时 count(0) 会提前通过（collections.spec 踩过同款坑），
    // 卡片没渲染就去数按钮会误判"没有 Visualize"
    const heading = page.locator('h3[aria-label^="Dataset name:"]').filter({ hasText: name }).first()
    const found = await heading.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)
    if (!found) continue
    const card = heading.locator('..').locator('..')
    const visualizeBtn = card.getByRole('button', { name: 'Visualize' })
    if (await visualizeBtn.isVisible().catch(() => false)) return { card, name }
  }
  return null
}

/**
 * 真实下载（/mydatasets 与 /datasets 各跑一遍）：后端真实签发 + 浏览器真实访问 OSS，
 * 只在 chromium 上跑。按钮、限流提示、资料校验这些前端行为在各浏览器上由
 * datasets.offline.spec.ts 确定地验证，这里不再重复，也不多耗账号的下载配额。
 */
async function expectRealDownloadStarts(page: Page, path: '/mydatasets' | '/datasets') {
  await page.goto(path)
  await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })

  const downloadBtns = page.locator('button').filter({ hasText: /Download/ })
  await downloadBtns.first().waitFor({ state: 'visible', timeout: 10_000 })

  // 选第一张 < 300MB 的卡，失败时可复现
  let pick = -1
  for (let i = 0, count = await downloadBtns.count(); i < count && pick < 0; i++) {
    const sizeText = await downloadBtns.nth(i).locator('..').locator('..').locator('p:has-text("File Size:")').innerText()
    if (sizeToMB(sizeText) < MAX_DOWNLOAD_MB) pick = i
  }
  test.skip(pick < 0, `No card under ${MAX_DOWNLOAD_MB}MB on this backend`)

  // 卡片里还有一个内联的 Share Dataset 确认弹窗（h3 常驻 DOM），
  // 用 aria-label 前缀钉死数据集名那个 h3
  const card = downloadBtns.nth(pick).locator('..').locator('..')
  const cardName = (await card.locator('h3[aria-label^="Dataset name:"]').innerText()).replace('Dataset name: ', '').trim()
  expect(cardName).not.toBe('')

  // 只验证下载已开始：不等文件下完，后面立刻取消，省 OSS 流量
  const downloads = await startRawDownload(page, downloadBtns.nth(pick))
  test.skip(downloads === null, 'Account download quota exhausted (HTTP 403)')
  for (const download of downloads!) expect(download.suggestedFilename()).toContain(cardName)
  await Promise.all(downloads!.map((download) => download.cancel().catch(() => {})))
}

/**
 * 排序（服务端）共用体（/mydatasets 与 /datasets 各跑一遍）：选 File size
 * 降/升序，先确认请求带上了 sort_by/order（防「下拉只改 UI 不发请求」的
 * 假阳性），再按卡片 File Size 文本验证第一页的真实顺序，且方向必须真的
 * 翻转（防止排序参数被后端忽略）。两侧原本各有一份逐行相同的实现，
 * 与 download 共用体同一收敛思路。
 * @param path 列表页路径（决定去哪个页面操作）
 * @param api  列表端点名（list_user_files / list_files，用于钉住请求）
 */
async function expectFileSizeSortApplied(page: Page, path: '/mydatasets' | '/datasets', api: string) {
  await page.goto(path)
  await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })

  const sortSelect = page
    .locator('select')
    .filter({ has: page.locator('option[value="size_bytes:desc"]') })
  await expect(sortSelect).toBeVisible()

  /** 当前第一页所有卡片的体积（MB），按卡片出现顺序 */
  const cardSizes = async () =>
    (await page.locator('p:has-text("File Size:")').allInnerTexts()).map(sizeToMB)

  // 降序：请求带 sort_by=size&order=desc，卡片体积应非升序排列
  const [descResp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(api) && r.url().includes('sort_by=size') && r.url().includes('order=desc'),
    ),
    sortSelect.selectOption('size_bytes:desc'),
  ])
  expect(descResp.ok()).toBeTruthy()
  await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })

  let sizes = await cardSizes()
  test.skip(sizes.length < 2, '后端数据不足 2 条，无法验证排序顺序')
  for (let i = 1; i < sizes.length; i++) {
    expect(sizes[i]!, `row ${i} should be <= row ${i - 1} (desc)`).toBeLessThanOrEqual(
      sizes[i - 1]!,
    )
  }

  // 反向切升序：方向必须真的翻转（防止排序参数被后端忽略）
  const [ascResp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(api) && r.url().includes('sort_by=size') && r.url().includes('order=asc'),
    ),
    sortSelect.selectOption('size_bytes:asc'),
  ])
  expect(ascResp.ok()).toBeTruthy()
  await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })

  sizes = await cardSizes()
  for (let i = 1; i < sizes.length; i++) {
    expect(sizes[i]!, `row ${i} should be >= row ${i - 1} (asc)`).toBeGreaterThanOrEqual(
      sizes[i - 1]!,
    )
  }
}

/**
 * Datasets E2E 测试 — 真实后端
 * ==============================
 * PublicDatasets：公开页 /datasets（依赖已有公开数据）
 * MyDatasets：需登录 /mydatasets（基于后端已有真实数据集）
 */

// ============================================================
// My Datasets（需登录，基于后端已有真实数据集）
// ============================================================

test.describe('My Datasets', () => {
  /**
   * 页面加载：quota bar + 数据集卡片
   */
  test('page loads with quota bar and dataset cards', async ({ page }) => {
    await page.goto('/mydatasets')

    await expect(page.locator('h1:has-text("My Datasets")')).toBeVisible()
    await expect(page.getByPlaceholder('Search my datasets')).toBeVisible()

    await expect(page.getByText(/Storage \d/)).toBeVisible()
    await expect(page.getByText(/Files \d/)).toBeVisible()
    await expect(page.getByText(/Processing \d/)).toBeVisible()
    await expect(page.getByText(/Downloads \d/)).toBeVisible()

    await expect(page.getByRole('button', { name: 'Upload New Dataset' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Refresh Status' })).toBeVisible()

    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByText('Organism:').first()).toBeVisible()
  })

  /**
   * 卡片状态、可见性、编辑与删除按钮
   */
  test('each card shows status, visibility, and delete button', async ({ page }) => {
    await page.goto('/mydatasets')
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })

    await expect(
      page
        .locator('button, div')
        .filter({ hasText: /Uploaded|Processing|Failed/ })
        .first(),
    ).toBeVisible()

    // 可见性标志已挪到文件名同一行、只留 svg：文案不在 DOM 文本里，改按 title 定位
    await expect(page.locator('[title="Public"], [title="Private"]').first()).toBeVisible()

    await expect(page.getByRole('button', { name: 'Edit' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete' }).first()).toBeVisible()
  })

  test('download — starts the real imzML + ibd download', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', '其余浏览器由 datasets.offline.spec.ts 覆盖')
    // 后端排队实测可到 55s+，留足单次下载的等待
    test.setTimeout(120_000)
    await expectRealDownloadStarts(page, '/mydatasets')
  })

  /** Overview 在新标签页打开，public_id 进路径参数（刷新不丢），可读取 private 数据。 */
  test('overview — opens in a new tab, shows content, then back', async ({ page }) => {
    await page.goto('/mydatasets')
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })

    const overviewBtns = page.getByRole('button', { name: 'Overview' })
    await overviewBtns.first().waitFor({ state: 'visible', timeout: 10_000 })
    const count = await overviewBtns.count()
    const pick = count > 1 ? Math.floor(Math.random() * count) : 0
    const [popup] = await Promise.all([page.waitForEvent('popup'), overviewBtns.nth(pick).click()])
    await expect(popup).toHaveURL(/\/overview\/[A-Za-z0-9_-]+/)
    await expect(popup.locator('.skeleton')).toHaveCount(0, { timeout: 15_000 })
    await expect(popup.locator('h1:has-text("Dataset Overview")')).toBeVisible()

    const hasContent = await popup
      .getByRole('button', { name: 'Download' })
      .isVisible()
      .catch(() => false)
    if (hasContent) {
      await expect(popup.getByText('Size', { exact: true })).toBeVisible()
      await expect(popup.getByText(/Sample Info/)).toBeVisible()
      await expect(popup.getByText('File Information')).toBeVisible()
    }

    const backBtn = popup.getByRole('button', { name: 'Back to My Datasets' })
    await expect(backBtn).toBeVisible()
    await backBtn.click()
    await expect(popup).toHaveURL(/\/mydatasets/)
    await expect(popup.getByText('Organism:').first()).toBeVisible()
  })

  /**
   * 排序（服务端）：选 File size 升/降序后，断言后端确实按该顺序返回。
   * 断言细节（请求参数 + 双向顺序）见共用体 expectFileSizeSortApplied。
   */
  test('sort — file size ordering is applied by the server', async ({ page }) => {
    await expectFileSizeSortApplied(page, '/mydatasets', 'list_user_files')
  })

  /**
   * Filter 面板
   */
  test('filter bar — Add filter panel opens', async ({ page }) => {
    await page.goto('/mydatasets')

    await page.getByRole('button', { name: 'Add filter' }).click()

    await expect(page.getByRole('button', { name: 'Apply' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible()
  })

  /**
   * Edit 元数据弹窗（非破坏性）：打开即预填文件名、未改动时 Save 保持禁用
   * （差量提交的 dirty 门控）、Cancel 关闭不保存。
   */
  test('edit metadata — opens prefilled dialog, save disabled until dirty, cancel closes', async ({ page }) => {
    await page.goto('/mydatasets')
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })

    const editBtn = page.getByRole('button', { name: 'Edit' }).first()
    await editBtn.waitFor({ state: 'visible', timeout: 10_000 })
    // 在卡片内取数据集名，弹窗副标题应回显它
    const card = editBtn.locator('..').locator('..')
    const cardName = (await card.locator('h3[aria-label^="Dataset name:"]').innerText())
      .replace('Dataset name: ', '')
      .trim()

    await editBtn.click()

    const dialog = page.locator('dialog.modal-open .modal-box')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('h3')).toHaveText('Edit Metadata')
    await expect(dialog.getByText(cardName)).toBeVisible()

    // 刚打开、未改任何字段：差量提交无内容可发 → Save 禁用
    await expect(dialog.getByRole('button', { name: 'Save Changes' })).toBeDisabled()

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('dialog.modal-open')).toHaveCount(0)
  })

  /**
   * 进入可视化结果（轻量入口用例）：已转换数据集的卡片按钮是 Visualize，
   * 点击直接跳 /vizworkbench 查看已有默认运行——不建任务、不等待、无需清理。
   *
   * 原重链路版本（Explore 二次确认 → 建 raw-convert 任务 → 等完成 → TIC 图/
   * 逐像素谱图验证 → 删任务）已删除：每跑一次就把所用数据集永久标记为"已转换"
   * （删任务行不清除），两个 ALGO 数据集都被用过后必然 skip；结果页的渲染与
   * 交互断言由 PA 链路（new-analysis.spec）覆盖同套组件。
   */
  test('visualize — opens the default run result from the dataset card', async ({ page }) => {
    await page.goto('/mydatasets')
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })

    const found = await findVisualizableDatasetCard(page)
    if (!found) {
      test.skip(true, 'No ALGO_DATASET_NAMES dataset with a default run (Visualize button)')
      return
    }

    await found.card.getByRole('button', { name: 'Visualize' }).click()
    await expect(page).toHaveURL(/\/vizworkbench/, { timeout: 15_000 })

    // 结果页真正渲染：标题非空、状态 completed、离子图加载完成（占位文案消失）
    await expect(page.locator('h1')).not.toBeEmpty()
    await expect(page.getByText('completed')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/^Loading ion image/)).not.toBeVisible({ timeout: 30_000 })
  })
})

// ============================================================
// Public Datasets（依赖已有的公开数据）
// ============================================================

test.describe('Public Datasets', () => {
  test('page loads and renders dataset cards with metadata', async ({ page }) => {
    await page.goto('/datasets')

    await expect(page.locator('h1:has-text("Public Datasets")')).toBeVisible()
    await expect(page.getByPlaceholder('Search datasets')).toBeVisible()

    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })

    await expect(page.getByText('Organism:').first()).toBeVisible()
    await expect(page.getByText('Organism Part:').first()).toBeVisible()
    await expect(page.getByText('Ionisation Source:').first()).toBeVisible()
    await expect(page.getByText('Analyzer:').first()).toBeVisible()
    await expect(page.getByText('File Size:').first()).toBeVisible()
    await expect(page.getByText('Submitted by:').first()).toBeVisible()
    await expect(page.getByText('Submit Time:').first()).toBeVisible()
  })

  test('pagination shows page info and can go to next page', async ({ page }) => {
    await page.goto('/datasets')
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })

    const perPageSelect = page.locator('label:has-text("Per page")').locator('..').locator('select')
    // 每页条数选项来自 config.json（pagination.pageSizeOptions），不写死具体数值
    const firstSize = await perPageSelect.locator('option').first().getAttribute('value')
    await perPageSelect.selectOption(firstSize!)

    await expect(page.getByText(/Page \d+ of \d+/)).toBeVisible()
    await expect(page.getByText(/records/)).toBeVisible()

    const nextBtn = page.getByRole('button', { name: 'Next' })
    if (await nextBtn.isEnabled()) {
      await nextBtn.click()
      await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })
      await expect(page.getByText('Organism:').first()).toBeVisible()
    }
  })

  /**
   * 「每页条数」下拉的选项来自 public/config.json，不写死在组件里。
   * 改配置忘了同步测试正是上一次 pagination 用例挂掉的原因，这里把两者绑定起来。
   */
  test('per-page options mirror config.json', async ({ page }) => {
    await page.goto('/datasets')
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })

    const config = await (await page.request.get('/config.json')).json()
    const expected: string[] = config.pagination.pageSizeOptions.map(String)

    const perPageSelect = page.locator('label:has-text("Per page")').locator('..').locator('select')
    await expect(perPageSelect.locator('option')).toHaveText(expected)
    await expect(perPageSelect).toHaveValue(String(config.pagination.defaultPageSize))
  })

  /**
   * 卡片预览图（DatasetPreviewGallery）：固定 3 个槽位，
   * 第 2/3 张推迟到首次悬停才拿到 src（一屏 10 张卡即省下 20 个请求）。
   *
   * 断言分两层：
   * - 悬停前只能有 1 个 <img>，没有元素就不可能发请求（这是省流量的真实保证）；
   * - 悬停后看 DOM 里的 src 是否补齐，而不是看是否真的发出请求——
   *   loading="lazy" 下各浏览器的取图时机不同（Firefox 对悬停区外的图可以一直不取），
   *   而预览图在 OSS 上也可能尚未生成（404），此时该槽位降级为占位 SVG。
   */
  test('preview gallery defers its hidden slots until hover', async ({ page }) => {
    const previewRequests: string[] = []
    page.on('request', (req) => {
      if (/\/images\/file_\d+\/preview/.test(req.url())) previewRequests.push(req.url())
    })

    await page.goto('/datasets')
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })

    const gallery = page.locator('figure.hover-gallery').first()
    await expect(gallery).toBeVisible()
    const slots = gallery.locator('> div')
    await expect(slots).toHaveCount(3)

    // 悬停前：只有第 1 张挂了 src，第 2/3 张连 <img> 都没有
    await expect(gallery.locator('img')).toHaveCount(1)
    expect(previewRequests.filter((u) => /preview_[23]\.jpg/.test(u))).toHaveLength(0)

    await gallery.hover()

    // 悬停后：三个槽位各自补齐，且每格要么是图片、要么是占位 SVG，不留空白
    const expectedSlot = ['preview.jpg', 'preview_2.jpg', 'preview_3.jpg']
    for (let i = 0; i < 3; i++) {
      const slot = slots.nth(i)
      await expect(slot.locator('img, svg')).toHaveCount(1, { timeout: 15_000 })
      const src = await slot
        .locator('img')
        .getAttribute('src')
        .catch(() => null)
      if (src !== null) expect(src).toContain(expectedSlot[i]!)
    }
  })

  /**
   * 排序（服务端）：与 My Datasets 侧同一套断言，走 /files/list_files 公开端点。
   */
  test('sort — file size ordering is applied by the server', async ({ page }) => {
    await expectFileSizeSortApplied(page, '/datasets', '/files/list_files')
  })

  test('download — starts the real imzML + ibd download', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', '其余浏览器由 datasets.offline.spec.ts 覆盖')
    test.setTimeout(120_000)
    await expectRealDownloadStarts(page, '/datasets')
  })

  /** 随机进入一张卡的 Overview（新标签页），验证内容后返回。 */
  test('overview — opens a random card in a new tab, shows content, then back', async ({
    page,
  }) => {
    await page.goto('/datasets')
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })

    const overviewBtns = page.getByRole('button', { name: 'Overview' })
    await overviewBtns.first().waitFor({ state: 'visible', timeout: 10_000 })
    const count = await overviewBtns.count()
    const pick = count > 1 ? Math.floor(Math.random() * count) : 0
    const [popup] = await Promise.all([page.waitForEvent('popup'), overviewBtns.nth(pick).click()])
    await expect(popup).toHaveURL(/\/overview\/[A-Za-z0-9_-]+/)
    await expect(popup.locator('.skeleton')).toHaveCount(0, { timeout: 15_000 })
    await expect(popup.locator('h1:has-text("Dataset Overview")')).toBeVisible()

    const hasContent = await popup
      .getByRole('button', { name: 'Download' })
      .isVisible()
      .catch(() => false)
    if (hasContent) {
      await expect(popup.getByText('Size', { exact: true })).toBeVisible()
      await expect(popup.getByText(/Sample Info/)).toBeVisible()
      await expect(popup.getByText('File Information')).toBeVisible()
    }

    const backBtn = popup.getByRole('button', { name: 'Back to Public Datasets' })
    await expect(backBtn).toBeVisible()
    await backBtn.click()
    await expect(popup).toHaveURL(/\/datasets/)
    await expect(popup.getByText('Organism:').first()).toBeVisible()
  })

  test('filter bar — Add filter panel opens', async ({ page }) => {
    await page.goto('/datasets')

    await page.getByRole('button', { name: 'Add filter' }).click()

    await expect(page.getByRole('button', { name: 'Apply' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible()
  })

  /**
   * Filter 真实生效（服务端）：filename 单值模糊匹配。用第一张卡的名字片段
   * （含 hash 前缀，唯一命中）做筛选——先确认请求体带上 filename（防「面板只改
   * UI 不发请求」的假阳性），再验证卡片确实只剩命中的；Reset 后请求体清空、
   * 列表恢复原样（默认排序不变，首卡应回到原来的名字）。
   */
  test('filter — filename applies server-side and Reset restores the list', async ({ page }) => {
    await page.goto('/datasets')
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })

    const firstName = (
      await page.locator('h3[aria-label^="Dataset name:"]').first().innerText()
    ).replace('Dataset name: ', '').trim()
    // 取 "hash_物种_器官" 三段：足够唯一，又不绑死完整文件名
    const fragment = firstName.split('_').slice(0, 3).join('_')

    await page.getByRole('button', { name: 'Add filter' }).click()
    await page.getByPlaceholder('Filename', { exact: true }).fill(fragment)

    const [applyResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/files/list_files')),
      page.getByRole('button', { name: 'Apply' }).click(),
    ])
    // 过滤条件在 POST body（分页/排序在 query string，见 datasetApi.listFiles）
    expect(applyResp.request().postDataJSON()).toMatchObject({ filename: fragment })
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })

    const names = await page.locator('h3[aria-label^="Dataset name:"]').allInnerTexts()
    expect(names.length, '按第一张卡的片段筛选，至少命中它自己').toBeGreaterThanOrEqual(1)
    for (const n of names) expect(n).toContain(fragment)

    // Reset：面板重开（Apply 后自动关闭），请求体回到无筛选
    await page.getByRole('button', { name: 'Add filter' }).click()
    const [resetResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/files/list_files')),
      page.getByRole('button', { name: 'Reset' }).click(),
    ])
    expect(resetResp.request().postDataJSON().filename ?? '').toBe('')
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })

    await expect(page.locator('h3[aria-label^="Dataset name:"]').first()).toHaveText(firstName)
  })
})

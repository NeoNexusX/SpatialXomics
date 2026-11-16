import { test, expect, type Locator, type Page } from '@playwright/test'
import { ALGO_DATASET_NAMES } from './utils.js'

/**
 * New Analysis + Peak Alignment 全链路 E2E — 真实后端
 * =====================================================
 * 覆盖页面：/workspace/new（创建分析表单）+ Peak Alignment 链路进入的
 * /vizworkbench（结果查看）。/workspace 任务列表页与 vizworkbench 空态的
 * 纯 UI 用例在 workspace.spec.ts。
 *
 * 核心链路：submit 在 chromium 上用真实数据集创建 Peak Alignment 任务并等它完成
 * → 查看用例进入 vizworkbench 验证渲染与交互 → 末尾 Cleanup 删除任务。
 * 链路在同一文件内按声明顺序执行（查看用例包在 test.describe.serial 里，
 * 组内某用例失败时后续查看用例自动 skip）。
 *
 * 状态传递：submit 从 POST /processes 的响应拿到任务 id，记入模块变量
 * createdProcessId；后续用例与 Cleanup 只按它定位本轮创建的任务。submit 被
 * skip（数据集缺失 / 不支持 align / 非 chromium）或创建前失败时变量保持 null，
 * 依赖用例随之 skip、Cleanup 不删任何行——不会误删 Workspace 里的历史任务。
 *
 * Cleanup 放在 serial 组之外：查看用例失败不该挡住清理（与合并前行为一致），
 * 但 submit 创建前就失败/被 skip 时 Cleanup 自然 skip。
 *
 * 注意：真实 Peak Alignment 后端任务在非 chromium 浏览器上经常 180s 都未完成，
 * 且显著拖长 CI，故链路只在 chromium 跑；firefox/webkit 只覆盖不依赖真实任务
 * 的用例（创建分析表单）。
 */

/** 用真实鼠标点击 ECharts 谱图 canvas */
async function clickSpectrum(page: Page, xRatio = 0.6) {
  // 谱图容器自带 testid（AverageSpectrum.vue），不要靠 h3 往上数祖先——
  // 标题区一改层级，locator('..') 链就会静默指到别的元素上
  const chart = page.getByTestId('average-spectrum-chart')

  const box = await chart.boundingBox()
  if (!box) throw new Error('Spectrum chart bounding box not found')

  // grid.left=64，点中心偏右
  await page.mouse.click(box.x + box.width * xRatio, box.y + box.height * 0.4)
}

/**
 * Workspace 表格里的这条任务。负向前瞻防止 Process #12 命中 Process #123；
 * 不能用 \b：相邻单元格的文本之间没有空格（"Process #12Brain_1"）。
 */
function processRow(page: Page, id: number) {
  return page.locator('table tbody tr').filter({ hasText: new RegExp(`Process #${id}(?!\\d)`) }).first()
}

/**
 * 本轮 submit 创建的 Peak Alignment 任务 id（见文件头"状态传递"）。
 * 模块变量只在同一 worker 进程内有效——每个浏览器项目各自重新加载本文件，
 * chromium 之外的项目的值不会被读到（链路用例先被 browserName skip 拦下）。
 */
let createdProcessId: number | null = null

/**
 * Peak Alignment 后端任务的最长等待时间。
 *
 * 这条链路里最耗时的就是后端跑 align，其余步骤都快，所以所有与之相关的预算
 * 都由这一个数推导，避免各处对不上（之前 submit 轮询 120s / 全局 180s、
 * helper 轮询 180s / 全局也是 180s、Cleanup 干脆没设全局用默认 30s ——
 * 等待上限 ≥ 全局超时，条件永远等不到）。
 *
 * 实测：同一数据集两次跑分别 108s、176s，波动大且会超过 2 分钟，
 * 所以留足余量取 5 分钟，避免差几秒就误判失败。
 */
const ALIGN_WAIT_MS = 300_000
/** 轮询预算 + 页面加载/断言余量。 */
const ALIGN_TEST_TIMEOUT_MS = ALIGN_WAIT_MS + 120_000
/** 查看用例不再等后端任务（submit 已确认完成），只等结果页加载。 */
const VIEW_TEST_TIMEOUT_MS = 180_000

/** 轮询刷新，直到该任务不再是 Running；预算用尽仍未结束时由调用方的断言报错。 */
async function waitUntilFinished(page: Page, row: Locator) {
  const deadline = Date.now() + ALIGN_WAIT_MS
  while (Date.now() < deadline) {
    await page.reload()
    // 行本身就是加载完成的信号：骨架和 Loading 占位都匹配不到 Process #id
    await expect(row).toBeVisible({ timeout: 15_000 })
    if ((await row.getByText('Running').count()) === 0) return
    await page.waitForTimeout(10_000)
  }
}

/** 打开 Workspace 并返回 submit 创建且已完成的任务行；本轮没有创建任务时直接 skip。 */
async function completedProcessRow(page: Page) {
  if (!createdProcessId) {
    // test.skip(true, ...) 抛出 skip 异常结束测试；throw 只为让 TS 收窄类型
    test.skip(true, '本轮 submit 未创建 Peak Alignment 任务（skip / 创建前失败）')
    throw new Error('skipped')
  }
  await page.goto('/workspace')
  const row = processRow(page, createdProcessId)
  await expect(row.getByText('Completed')).toBeVisible({ timeout: 15_000 })
  return row
}

// ============================================================
// 创建分析页面（表单，无后端任务依赖）
// ============================================================

test.describe('New Analysis', () => {

  test('page loads with exactly the two pipeline steps', async ({ page }) => {
    await page.goto('/workspace/new')

    await expect(page.locator('h1:has-text("Create New Analysis")')).toBeVisible()
    await expect(page.getByText('Step 1: Data Source')).toBeVisible()
    await expect(page.getByText('Step 2: Preprocessing Pipeline')).toBeVisible()

    // 向导只有两步。原来这里断言 "Step 3: Annotation Settings" 不可见，
    // 但该文案早已从代码里删除，断言恒真、测不到任何回归。
    await expect(page.getByText(/^Step \d+:/)).toHaveCount(2)
  })

  test('summary panel shows disabled state when no dataset selected', async ({ page }) => {
    await page.goto('/workspace/new')

    await expect(page.getByText('Analysis Summary')).toBeVisible()
    await expect(page.getByText('No dataset selected')).toBeVisible()

    const startBtn = page.getByRole('button', { name: 'Start Analysis' })
    await expect(startBtn).toBeDisabled()

    await expect(page.getByText('Select dataset and configure pipeline first')).toBeVisible()
  })

  test('selecting and switching dataset updates summary panel', async ({ page }) => {
    await page.goto('/workspace/new')
    await page.locator('.tab:has-text("My Datasets")').click()
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })

    // 至少需要 2 个数据集：一条用例同时覆盖"选中"与"切换"
    const radios = page.locator('input[name="selectedDataset"]')
    await radios.first().waitFor({ state: 'visible', timeout: 10_000 })
    const count = await radios.count()
    if (count < 2) {
      test.skip(true, `Only ${count} dataset(s), need ≥ 2 to test selection & switching`)
      return
    }

    // 选第一个
    const firstLi = radios.first().locator('..')
    const firstName = await firstLi.locator('.font-medium').innerText()
    await firstLi.click()
    await expect(firstLi.locator('input[type="radio"]')).toBeChecked()

    // Summary 显示第一个名称；空态消失，Dataset metadata 区域出现（自动回填 MS 设置）
    const summarySection = page.locator('.lg\\:col-span-1')
    await expect(summarySection.getByText(firstName!.trim())).toBeVisible()
    await expect(page.getByText('No dataset selected')).toBeHidden()
    await expect(page.getByText('Dataset metadata')).toBeVisible()

    // 换选第二个
    const secondLi = radios.nth(1).locator('..')
    const secondName = await secondLi.locator('.font-medium').innerText()
    await secondLi.click()

    // 第二个 radio 选中，第一个取消
    await expect(secondLi.locator('input[type="radio"]')).toBeChecked()
    await expect(firstLi.locator('input[type="radio"]')).not.toBeChecked()

    // Summary 更新为第二个名称
    await expect(summarySection.getByText(secondName!.trim())).toBeVisible()
    await expect(summarySection.getByText(firstName!.trim())).toBeHidden()
  })

  test('selecting a preprocessing method enables submit', async ({ page }) => {
    await page.goto('/workspace/new')
    await page.locator('.tab:has-text("My Datasets")').click()
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })

    // 先选数据集（通过 radio input 定位）
    const radios = page.locator('input[name="selectedDataset"]')
    await radios.first().waitFor({ state: 'visible', timeout: 10_000 })
    const count = await radios.count()
    const pick = count > 1 ? Math.floor(Math.random() * count) : 0
    await radios.nth(pick).locator('..').click()

    // Start Analysis 仍然 disabled（没选 method）
    await expect(page.getByRole('button', { name: 'Start Analysis' })).toBeDisabled()

    // 点击最后一个预处理方法（Peak Alignment）
    const methodLabels = page.locator('details[open] label')
    const lastMethodLabel = methodLabels.nth(await methodLabels.count() - 1)
    await lastMethodLabel.click()

    // 方法选中后按钮应变为可用
    await expect(page.getByRole('button', { name: 'Start Analysis' })).toBeEnabled()
    await expect(page.getByText('Select dataset and configure pipeline first')).toBeHidden()
  })
})

// ============================================================
// Peak Alignment 链路（serial：submit → 查看两用例）
// ============================================================

test.describe.serial('Peak Alignment journey', () => {
  // 重后端 Peak Alignment 任务只在 chromium 创建（firefox/webkit 后端完成时间不可控，还拖长 CI）。
  test.skip(({ browserName }) => browserName !== 'chromium', 'Peak Alignment 任务只在 chromium 创建一次')

  test('submit — creates Peak Alignment task and waits for completion', async ({ page }) => {
    test.setTimeout(ALIGN_TEST_TIMEOUT_MS)
    await page.goto('/workspace/new')
    await page.locator('.tab:has-text("My Datasets")').click()
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })

    // 用真实数据集跑算法（不再按文件大小随机挑卡——可能选中 1KB 合成测试文件，
    // 后端解析必然 Failed）。从 ALGO_DATASET_NAMES 里随机选一个，用搜索框按名称过滤后选中。
    // 注意 placeholder 与 DataSourceStep 里的 SearchInput 保持一致（"Search datasets"）。
    const search = page.getByPlaceholder('Search datasets')
    const name = ALGO_DATASET_NAMES[Math.floor(Math.random() * ALGO_DATASET_NAMES.length)]!
    await search.fill(name)

    // 按**数据集名**定位那一行再点。两种"等就绪"的写法都不能用：
    //   - 等 .animate-pulse：DataSourceStep 的加载态是 loading-spinner，页面没有骨架屏元素，
    //     toHaveCount(0) 会立刻通过；
    //   - 等"第一个 radio 可见"：列表还没被过滤时，初始那批 radio 就已经可见，会点到列表
    //     第一行（曾因此给 Rat_Liver 建了任务，却去找 Human_Kidney 的行）。
    // 按名字过滤则与过滤是否已生效无关——命中的一定是目标数据集那一行。
    const datasetRow = page.locator('li').filter({ hasText: name }).first()
    const found = await datasetRow
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false)
    if (!found) {
      test.skip(true, `Dataset "${name}" not found on this backend`)
      return
    }
    await datasetRow.click()

    // 明确选中 Peak Alignment，而不是"点最后一个方法"——随机数据集下最后一个方法未必是 align。
    // profile 数据要先选中 Peak Picking 才会暴露 Peak Alignment；centroid+continuous 则根本不支持 align。
    // 定位方式：align 组的唯一方法 label 是 "Python Backend"（见 usePreprocessingMethods.ts align 组）。
    const alignMethod = page.locator('details[open] label').filter({ hasText: 'Python Backend' })
    if ((await alignMethod.count()) === 0) {
      const pickMethod = page.locator('details[open] label').filter({ hasText: 'Standard Peak Detection' })
      if ((await pickMethod.count()) > 0) {
        await pickMethod.click()
        await expect(alignMethod).toBeVisible({ timeout: 5_000 })
      }
    }
    if ((await alignMethod.count()) === 0) {
      test.skip(true, `Dataset "${name}" 不支持 Peak Alignment，无法构建对齐任务`)
      return
    }
    await alignMethod.click()

    const [created] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/processes')),
      page.getByRole('button', { name: 'Start Analysis' }).click(),
    ])
    expect(created.ok(), `POST /processes → HTTP ${created.status()}: ${await created.text()}`).toBe(true)
    createdProcessId = ((await created.json()) as { id: number }).id

    await expect(page).toHaveURL(/\/workspace(?:[?#]|$)/, { timeout: 30_000 })
    await expect(page.locator('h1:has-text("Workspace")')).toBeVisible()

    const row = processRow(page, createdProcessId)
    await waitUntilFinished(page, row)
    // 只等 Running 消失不够：Failed 任务后面的查看用例没法成立，在这里就要报出来
    await expect(row.getByText('Completed'), `Process #${createdProcessId} should complete`).toBeVisible({ timeout: 10_000 })
  })

  test('vizworkbench — loads ion image, spectrum, metadata, and responds to click', async ({ page }) => {
    test.setTimeout(VIEW_TEST_TIMEOUT_MS)
    const completedRow = await completedProcessRow(page)
    await completedRow.getByRole('button', { name: 'View' }).click()
    await expect(page).toHaveURL(/\/vizworkbench/)

    // header
    await expect(page.locator('h1')).not.toBeEmpty()
    await expect(page.getByText('completed')).toBeVisible()

    // ion image + spectrum 加载完成。UI 文案是 "Loading ion image, please wait a moment..."，
    // 用正则前缀匹配，同时兼容旧文案（"Loading ion image..."）。
    await expect(page.getByText(/^Loading ion image/)).not.toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/^Loading average spectrum/)).not.toBeVisible({ timeout: 30_000 })

    // 平均谱图
    await expect(page.getByRole('heading', { name: 'Spectrum View' })).toBeVisible()
    await expect(page.getByText(/peaks/)).toBeVisible()

    // 右侧信息栏元数据（zarr 加载可能较慢）
    await expect(page.getByText('Polarity')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Analyzer')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Ionisation Source')).toBeVisible({ timeout: 10_000 })

    // 用真实鼠标点击谱图两处，确认选中的真实 m/z 确实发生变化。
    // selected-mz 只在 dataMode === 'continuous' 时渲染（zarr 加载完成前不存在），
    // 所以先显式等它出现，再点击谱图。（m/z 框是可填写的搜索输入框，用 inputValue 读取。）
    const selectedMz = page.getByTestId('selected-mz')
    await expect(selectedMz).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(1000)
    await clickSpectrum(page, 0.2)
    const firstSelectedMz = await selectedMz.inputValue()
    await clickSpectrum(page, 0.8)
    await expect(selectedMz).not.toHaveValue(firstSelectedMz, { timeout: 10_000 })
    // 等 ion image 响应完成，并确认没有进入显式错误态。
    await expect(page.getByTestId('ion-image-section')).toHaveAttribute('data-loading', 'false', {
      timeout: 30_000,
    })
    await expect(page.getByText(/Failed to (load|update) ion image/)).toBeHidden()

    // 确认点击后页面没崩：谱图仍在。
    await expect(page.getByRole('heading', { name: 'Spectrum View' })).toBeVisible()
  })

  test('vizworkbench — switches colormap and keeps ion image stable', async ({ page }) => {
    test.setTimeout(VIEW_TEST_TIMEOUT_MS)
    const completedRow = await completedProcessRow(page)
    await completedRow.getByRole('button', { name: 'View' }).click()
    await expect(page).toHaveURL(/\/vizworkbench/)

    await expect(page.getByText(/^Loading ion image/)).not.toBeVisible({ timeout: 30_000 })

    // 切换到 Viridis（colormap-select 在 ion image 渲染后才存在）
    const colormapSelect = page.getByTestId('colormap-select')
    await expect(colormapSelect).toBeVisible({ timeout: 30_000 })
    await colormapSelect.selectOption('viridis')
    await page.waitForTimeout(500)

    // ion image 没崩
    await expect(page.getByText(/^Loading ion image/)).toBeHidden()
  })

  test('vizworkbench — multi-ion overlay grays Gamma and Display Range while active', async ({ page }) => {
    // 覆盖 14abcc8：overlayActive（enabled && 有已加载通道）时 Gamma 滑块与
    // Display Range 输入框不参与叠加渲染，置灰禁用；关闭后恢复。
    test.setTimeout(VIEW_TEST_TIMEOUT_MS)
    const completedRow = await completedProcessRow(page)
    await completedRow.getByRole('button', { name: 'View' }).click()
    await expect(page).toHaveURL(/\/vizworkbench/)
    await expect(page.getByText(/^Loading ion image/)).not.toBeVisible({ timeout: 30_000 })

    // Gamma 滑块（Visualization 区，min/max 组合在页面唯一）；Display Range 的
    // Max/Min 两个输入框：按区头按钮的下一个兄弟节点（CollapsibleSection 的
    // 内容 div）收窄，避免误中其它面板的 input
    const gammaSlider = page.locator('input[type="range"][min="0.5"][max="1.5"]')
    const displayRangeInputs = page
      .getByRole('button', { name: 'Display range' })
      .locator('xpath=following-sibling::div[1]')
      .locator('input')
    await expect(gammaSlider).toBeVisible()
    await expect(displayRangeInputs).toHaveCount(2)

    // 叠加未激活：两者可用
    await expect(gammaSlider).toBeEnabled()
    await expect(displayRangeInputs.first()).toBeEnabled()
    await expect(displayRangeInputs.nth(1)).toBeEnabled()

    // 打开 Overlay mode，把当前选中的 m/z 加为第一个通道
    await page.locator('label:has-text("Overlay mode")').locator('input').check()
    await page.getByRole('button', { name: /^Add m\/z / }).click()

    // 通道矩阵加载完成后 overlayActive 生效 → Gamma / Display Range 置灰
    // （矩阵是按 m/z 拉的离子图数据，给足等待）
    await expect(gammaSlider).toBeDisabled({ timeout: 60_000 })
    await expect(displayRangeInputs.first()).toBeDisabled()
    await expect(displayRangeInputs.nth(1)).toBeDisabled()

    // 关掉叠加：控件恢复可用
    await page.locator('label:has-text("Overlay mode")').locator('input').uncheck()
    await expect(gammaSlider).toBeEnabled({ timeout: 30_000 })
    await expect(displayRangeInputs.first()).toBeEnabled()
  })
})

// ============================================================
// Cleanup（serial 组之外：查看用例失败不挡清理）
// ============================================================
// 删除 submit 创建的任务（按 createdProcessId 定位，不会碰到历史任务）。

test.describe('Cleanup', () => {
  test('delete completed result', async ({ page, browserName }) => {
    // 与 submit 对应：任务只在 chromium 建，这里也只在 chromium 删
    test.skip(browserName !== 'chromium', 'Peak Alignment 任务只在 chromium 创建，清理也只在 chromium')
    test.setTimeout(ALIGN_TEST_TIMEOUT_MS)
    // submit 没有创建任务（skip / 创建前失败）时不删任何行——
    // 宁可留下未清理的任务，也不误删历史数据
    if (!createdProcessId) {
      test.skip(true, '本轮 submit 未创建 Peak Alignment 任务，不删除任何行以免误删历史数据')
      throw new Error('skipped')
    }
    await page.goto('/workspace')

    // 等本次任务跑完（查看用例失败时它可能还在 Running，运行中的任务没有 Delete 按钮）
    const row = processRow(page, createdProcessId)
    await waitUntilFinished(page, row)

    const openModal = page.locator('dialog.modal-open')
    if (await openModal.isVisible().catch(() => false)) {
      await openModal.getByRole('button').first().click()
    }

    await row.getByRole('button', { name: 'Delete' }).click()

    await page.locator('.modal-box').getByRole('button', { name: 'Delete' }).click()
    await expect(page.locator('.toast')).toContainText('Deleted', { timeout: 10_000 })
  })
})

// ============================================================
// Workspace 页面与 vizworkbench 空态的纯 UI 用例已拆到 workspace.spec.ts
// ============================================================

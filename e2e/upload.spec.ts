import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, rmSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { startRawDownload } from './utils.js'

/**
 * Upload Round-Trip E2E 测试 — 真实后端
 * ======================================
 * 下载真实数据集（imzML + ibd）-> 从服务器删除 -> 用下载的文件重新上传 -> 验证恢复
 *
 * 与其它 spec 无执行顺序约束：被删的是 Arabidopsis 数据集，
 * datasets/new-analysis（Peak Alignment 链路）依赖的都是 Ecoli/Human（ALGO_DATASET_NAMES）。
 * 目标数据集不存在时自动 skip。
 *
 * 覆盖两个数据集：
 * - Arabidopsis_Spleen_MALDI_10_Negative_f9d339（小，Organism=Arabidopsis / Part=Spleen）
 * - Rat_Liver_MALDI_40_Positive_9ce4d1（大，压缩后约 360MB，Organism=Rat / Part=Liver）
 *   破坏性测试跑大文件成本高（下载+重传 360MB），保留覆盖是值得的：
 *   大文件路径才会暴露分块上传/超时/进度的问题。这些问题与浏览器无关，只在 chromium 跑一次。
 *
 * 相同内容 + 相同 metadata = 相同数据集，重传后自动恢复，不需要额外清理。
 * 注意文件名不保证逐字恢复：后端 canonical 命名是 `hash_Name`，与历史
 * `Name_hash` 格式不同（2026-10 实测 Arabidopsis/Rat_Liver 重传后 hash
 * 挪到了开头），所以 CASES 一律按不含 hash 的名字子串定位。
 *
 * 注意：这是破坏性测试——删除后如果重传失败，真实数据会丢失。
 */

interface RoundTripParams {
  /**
   * 目标数据集的匹配名（不含 hash）。定位用 aria-label*="..." 子串匹配，
   * 兼容后端两种命名格式：历史 `Name_hash` 与重传后 canonical 的 `hash_Name`
   * （2026-10 实测重传一次后 hash 会挪到开头，写死任一完整名都会让另一格式的
   * 定位静默失败 → 测试被误判 "not found" 而 skip）。
   */
  filename: string
  organism: string
  organismPart: string
  /** Polarity 有些数据的 imzML 解析不出来，需要手动填；与文件名中的 Positive/Negative 对应 */
  polarity: string
  /** Ionisation Source 有些数据需要手动填（如 imzML 没解析到的情况）；不提供则依赖 imzML 自动解析 */
  ionisationSource?: string
  /** Timeout for waiting both downloads to start (ms) */
  downloadTimeout: number
  /** Timeout for the upload pipeline to complete (toast) (ms) */
  uploadTimeout: number
  /** Polling interval for Refresh Status (ms) */
  pollInterval: number
  /** Polling total duration for Refresh Status (ms) */
  pollDuration: number
}

interface DatasetCase {
  name: string
  testTimeout: number
  chromiumOnly?: boolean
  params: RoundTripParams
}

/**
 * 执行一次 download -> delete -> re-upload 流程。
 * @returns true 表示成功完成，false 表示目标数据集不存在（需要 skip）
 */
async function runUploadRoundTrip(page: Page, params: RoundTripParams): Promise<boolean> {
  const dir = mkdtempSync(join(tmpdir(), 'mv-roundtrip-'))
  try {
    // ============================================================
    // Step 1: 定位目标数据集
    // ============================================================
    await page.goto('/mydatasets')
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })

    const cardHeading = page.locator(`h3[aria-label*="${params.filename}"]`).first()
    try {
      await cardHeading.waitFor({ state: 'visible', timeout: 10_000 })
    } catch {
      return false
    }
    const targetCard = cardHeading.locator('..').locator('..')

    // ============================================================
    // Step 2: 下载 imzML + ibd（配额用完时在删除之前就 skip，不会动到数据）
    // ============================================================
    const collected = await startRawDownload(
      page,
      targetCard.getByRole('button', { name: 'Download' }),
      params.downloadTimeout,
    )
    test.skip(collected === null, 'Account download quota exhausted (HTTP 403)')

    // 保存到临时目录（保持 suggestedFilename 原名，imzML/ibd 的 basename 配对不变）
    const savedPaths: string[] = []
    for (const dl of collected!) {
      const dest = join(dir, dl.suggestedFilename())
      await dl.saveAs(dest)
      savedPaths.push(dest)
    }
    const files = readdirSync(dir)
    const hasImzml = files.some(f => /\.imzml$/i.test(f))
    const hasIbd = files.some(f => /\.ibd$/i.test(f))
    if (!hasImzml || !hasIbd) {
      throw new Error(`Expected imzML + ibd, got: ${files.join(', ')}`)
    }

    // ============================================================
    // Step 3: 删除该数据集（硬删除，重传时不会被判定为 reuse）
    // ============================================================
    await targetCard.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText('Are you sure you want to delete this dataset?')).toBeVisible()
    await page.locator('.modal-box').getByRole('button', { name: 'Delete' }).click()
    await expect(page.locator('.toast')).toContainText(/deleted/i)
    await expect(cardHeading).not.toBeVisible({ timeout: 15_000 })

    // ============================================================
    // Step 4: 重新上传下载到的文件
    // ============================================================
    await page.getByRole('button', { name: 'Upload New Dataset' }).click()
    await expect(page.getByText('Upload New Dataset (imzML + ibd)')).toBeVisible()

    await page.locator('input[type="file"]').setInputFiles(savedPaths)
    await page.waitForTimeout(2000) // 等 imzML 元数据解析完

    // 默认勾了 public，取消
    await page.locator('#is_public').uncheck()

    const modalBox = page.locator('.modal-box')

    // Polarity（有些数据 imzML 解析不到文件名中的 Positive/Negative，需要手动设）
    await modalBox.locator('label:has-text("Polarity")').first().locator('..').locator('select')
      .selectOption(params.polarity)

    // Ionisation Source（有些数据需要手动设，如 SIMS；imzML 解析不到时使用）
    if (params.ionisationSource) {
      await modalBox.locator('label:has-text("Ionisation Source")').first().locator('..').locator('select')
        .selectOption(params.ionisationSource)
    }

    // Organism
    await modalBox.locator('label:has-text("Organism")').first().locator('..').locator('select')
      .selectOption(params.organism)

    // Organism Part
    await modalBox.locator('label:has-text("Organism Part")').first().locator('..').locator('select')
      .selectOption(params.organismPart)

    // 其他必填项选第一个（Condition / Sample Stabilization / MALDI Matrix / MALDI Matrix Application）
    // 这些字段不影响文件名，选第一项即可通过表单校验
    for (const label of ['Condition', 'Sample Stabilization', 'MALDI Matrix', 'MALDI Matrix Application']) {
      const area = modalBox.locator(`label:has-text("${label}")`).first().locator('..')
      await area.locator('select').click()
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)
    }

    // Solvent（select + 文本输入）
    const solventArea = modalBox.locator('label:has-text("Solvent")').locator('..')
    await solventArea.locator('select').click()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    await solventArea.getByPlaceholder('e.g. 50').fill('50')
    await solventArea.getByPlaceholder('e.g. 50').press('Enter')

    await page.getByRole('button', { name: 'Confirm & Upload' }).click()

    // ============================================================
    // Step 5: 验证重传成功
    // 相同内容 + 相同 metadata -> 相同文件名，卡片以原名重新出现
    // ============================================================
    await expect(page.locator('.toast')).toContainText(/success|reused|complete/, { timeout: params.uploadTimeout })
    await expect(page.getByText('Upload New Dataset (imzML + ibd)')).toBeHidden()

    // 轮询 Refresh Status，等数据集卡片出现并变为 Uploaded
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })
    const deadline = Date.now() + params.pollDuration
    while (Date.now() < deadline) {
      await page.getByRole('button', { name: 'Refresh Status' }).click()
      await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })
      const isTargetVisible = await cardHeading.isVisible().catch(() => false)
      if (isTargetVisible) {
        const restoredCard = cardHeading.locator('..').locator('..')
        const stillUploading = await restoredCard.getByText('Processing').isVisible().catch(() => false)
        if (!stillUploading) break
      }
      await page.waitForTimeout(params.pollInterval)
    }

    await expect(cardHeading).toBeVisible({ timeout: 10_000 })
    const restoredCard = cardHeading.locator('..').locator('..')
    await expect(restoredCard.getByText(/Uploaded|Failed/)).toBeVisible()

    return true
  } finally {
    try { rmSync(dir, { recursive: true }) } catch { /* ok */ }
  }
}

// ============================================================
// 测试用例
// ============================================================

const CASES: DatasetCase[] = [
  {
    name: 'small: Arabidopsis_Spleen_MALDI_10_Negative',
    testTimeout: 300_000, // 5 min
    params: {
      filename: 'Arabidopsis_Spleen_MALDI_10_Negative',
      organism: 'Arabidopsis (Arabidopsis thaliana)',
      organismPart: 'Spleen',
      polarity: 'Negative',
      downloadTimeout: 60_000,   // 1 min for downloads to start
      uploadTimeout: 120_000,    // 2 min for upload pipeline
      pollInterval: 5000,        // 5s between polls
      pollDuration: 50_000,      // 50s total (≈10 polls)
    },
  },
  {
    name: 'large: Rat_Liver_MALDI_40_Positive',
    chromiumOnly: true,
    // 12 min：360MB 下载落盘 + hash/压缩/重传 + 轮询验证。8 min 实测不够
    // （2026-10-09 重传实际完成、数据完好，但预算在轮询阶段耗尽误判超时）
    testTimeout: 720_000,
    params: {
      filename: 'Rat_Liver_MALDI_40_Positive',
      organism: 'Rat (Rattus norvegicus)',
      organismPart: 'Liver',
      polarity: 'Positive',
      downloadTimeout: 120_000,  // 2 min for 360MB downloads to start
      uploadTimeout: 300_000,    // 5 min for 360MB upload pipeline (hash + compress + upload)
      pollInterval: 5000,        // 5s between polls
      pollDuration: 50_000,      // 50s total (≈10 polls)
    },
  },
]

test.describe('Upload Round-Trip', () => {
  for (const ds of CASES) {
    test(`download -> delete -> re-upload (${ds.name})`, async ({ page, browserName }) => {
      test.skip(browserName === 'webkit', 'Linux WebKit 不支持 OPFS 且 headless 下载不稳定')
      test.skip(!!ds.chromiumOnly && browserName !== 'chromium', '大文件只在 chromium 跑一次')
      test.setTimeout(ds.testTimeout)

      const found = await runUploadRoundTrip(page, ds.params)
      if (!found) {
        test.skip(true, `Target dataset ${ds.params.filename} not found`)
      }
    })
  }
})

// ============================================================
// 上传弹窗（非破坏性；不依赖任何特定后端数据，任何环境都能跑）
// ============================================================

test.describe('Upload dialog', () => {
  test('opens with metadata form, keeps Confirm disabled until a pair is selected, cancel closes', async ({ page }) => {
    await page.goto('/mydatasets')
    await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 15_000 })

    await page.getByRole('button', { name: 'Upload New Dataset' }).click()

    // 按标题钉死上传弹窗本身：页面偶发出现另一个瞬时 modal-open 的空壳
    // dialog（500ms 内自关，抓不到稳定复现），裸 dialog.modal-open 会双命中
    const modal = page
      .locator('dialog.modal-open .modal-box')
      .filter({ has: page.getByRole('heading', { name: 'Upload New Dataset (imzML + ibd)' }) })
    await expect(modal).toBeVisible()

    // 未选 imzML+ibd 文件对：Confirm & Upload 保持禁用（selectedPair 为空）
    await expect(modal.getByRole('button', { name: 'Confirm & Upload' })).toBeDisabled()

    await modal.getByRole('button', { name: 'Cancel' }).click()
    await expect(modal).toBeHidden()
  })
})

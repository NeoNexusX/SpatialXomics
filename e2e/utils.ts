import { expect, type Download, type Locator, type Page } from '@playwright/test'

/**
 * E2E 测试共享工具函数
 */

/**
 * 解析含 "X.X KB/MB/GB/TB" 的文本为 MB。
 * 无法解析时返回 Infinity，便于在过滤逻辑中直接跳过（sizeToMB(text) < max 恒为 false）。
 */
export function sizeToMB(text: string | null): number {
  if (!text) return Infinity
  const m = text.match(/([\d.]+)\s*(KB|MB|GB|TB)/i)
  if (!m) return Infinity
  const v = parseFloat(m[1])
  switch (m[2].toUpperCase()) {
    case 'KB': return v / 1024
    case 'MB': return v
    case 'GB': return v * 1024
    case 'TB': return v * 1024 * 1024
    default: return Infinity
  }
}

/**
 * 跑算法 / 可视化任务（explore raw-convert、new-analysis submit）用的真实数据集，
 * 按名称优先匹配（先后端搜 Ecoli，没有再搜 Human）。
 *
 * 不能用 1KB 合成 imzML（spectrumList count=0 + 随机 ibd）：后端解析必然失败，
 * 任务 Failed，等待 Completed 的断言会超时。必须换成后端上真实存在的 MSI 数据集。
 */
export const ALGO_DATASET_NAMES = [
  'Ecoli_Brain_MALDI_49_Negative_a6e46f',
  'Human_Kidney_MALDI_50_Negative_69bdd1',
] as const

/** 下载前的资料校验只等 GET /user，签发接口也是毫秒级，20s 没结果就不用再等了 */
const SIGN_TIMEOUT_MS = 20_000

/**
 * 点击真实下载按钮，等浏览器开始下载 imzML + ibd。
 *
 * 链路分三段：资料校验（拦截时只有 warning toast）→ GET download_raw 签发 → 隐藏 iframe 打开
 * OSS 链接。只等 download 事件的话，任何一段断掉都只能得到一句超时，所以这里逐段检查，
 * 失败信息写明卡在哪一段；OSS 那段会带上每个文件的响应状态（不含签名）。
 *
 * @returns 已开始的下载；账号下载配额用完（403）时返回 null，属于环境因素，由调用方 skip
 */
export async function startRawDownload(page: Page, trigger: Locator, timeout = 90_000): Promise<Download[] | null> {
  const downloads: Download[] = []
  const network = new Map<string, string>()
  const pathOf = (url: string) => new URL(url).pathname
  page.on('download', (download) => downloads.push(download))
  page.on('response', (response) => network.set(pathOf(response.url()), `HTTP ${response.status()}`))
  page.on('requestfailed', (request) => {
    const path = pathOf(request.url())
    if (!network.has(path)) network.set(path, request.failure()?.errorText ?? 'failed')
  })

  const signed = page
    .waitForResponse((r) => /\/files\/\w+\/download_raw$/.test(pathOf(r.url())), { timeout: SIGN_TIMEOUT_MS })
    .catch(() => null)
  const warning = page.locator('.toast .alert-warning').first()
  const refused = warning.waitFor({ timeout: SIGN_TIMEOUT_MS }).then(() => 'refused' as const, () => null)
  await trigger.click()

  const outcome = await Promise.race([signed, refused])
  if (outcome === 'refused') throw new Error(`Download refused before signing: ${await warning.innerText()}`)
  if (!outcome) throw new Error(`GET download_raw did not answer within ${SIGN_TIMEOUT_MS / 1000}s`)
  if (outcome.status() === 403) return null
  if (!outcome.ok()) throw new Error(`GET download_raw → HTTP ${outcome.status()}: ${await outcome.text()}`)

  const { files } = (await outcome.json()) as { files: { filename: string; url: string }[] }
  expect(files.length, 'download_raw should sign imzML + ibd').toBeGreaterThanOrEqual(2)
  // toast 3s 后自动消失，OSS 响应可能更慢，要在等下载事件之前断言
  await expect(page.getByText('Download started')).toBeVisible()
  try {
    await expect.poll(() => downloads.length, { timeout, intervals: [500, 1000, 2000] }).toBeGreaterThanOrEqual(files.length)
  } catch {
    const status = files.map((f) => `${f.filename}: ${network.get(pathOf(f.url)) ?? 'no response'}`).join('; ')
    throw new Error(`${downloads.length}/${files.length} downloads started within ${timeout / 1000}s (${status})`)
  }
  return downloads
}

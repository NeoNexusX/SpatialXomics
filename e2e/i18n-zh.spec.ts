import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'

/**
 * 中文界面冒烟 E2E（chromium-zh project，浏览器语言 zh-CN）
 * ======================================================
 * 逐个访问主要路由，确认三件事：
 *   1. <html lang> 是 zh-CN——首访按浏览器语言探测生效；
 *   2. 页面主标题渲染成中文——该路由的 feature 语言包确实懒加载到了；
 *   3. 页面文本里没有 `datasets.field.xxx` 形态的裸 key——引用了没加载的命名空间、
 *      或者语言包缺 key 时，vue-i18n 会把 key 原样显示出来。
 *
 * 期望文案直接读 src/i18n/locales/zh-CN/*.json，不在用例里硬编码中文：
 * 译文调整不会让用例失效，而 key 被删改时这里会立刻报错。
 */

const LOCALE_DIR = fileURLToPath(new URL('../src/i18n/locales/zh-CN/', import.meta.url))

/** 合并全部 zh-CN 命名空间（每份 json 的顶层键就是命名空间名） */
const ZH: Record<string, unknown> = Object.assign(
  {},
  ...readdirSync(LOCALE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(LOCALE_DIR + f, 'utf-8'))),
)

function zh(key: string): string {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], ZH)
  if (typeof value !== 'string') throw new Error(`zh-CN locale has no string at "${key}"`)
  return value
}

const NAMESPACES = Object.keys(ZH).join('|')
/** 裸 key：命名空间开头、至少三段的点分标识符，如 common.action.save */
const KEY_LEAK = new RegExp(`\\b(?:${NAMESPACES})\\.[a-zA-Z]+(?:\\.[a-zA-Z]+)+\\b`, 'g')

/** 从公开列表取一个真实 public_id（动态路由用）；取不到返回 null（调用方 test.skip） */
async function firstPublicId(request: APIRequestContext): Promise<string | null> {
  const res = await request.post('/api/files/list_files?page=1&size=1', { data: {} })
  if (!res.ok()) return null
  const body = await res.json()
  return body?.data?.[0]?.public_id ?? null
}

async function expectLocalizedPage(page: Page, path: string, expectText: string) {
  const intlifyWarnings: string[] = []
  page.on('console', (msg) => {
    // dev 服务器下 vue-i18n 会对查不到的 key 打 [intlify] 警告；CI 的 preview 构建关掉了，
    // 所以这条只在本地生效，裸 key 检查（下面的正则）才是两边都有效的那道关。
    if (msg.text().includes('[intlify]')) intlifyWarnings.push(msg.text())
  })

  await page.goto(path)
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  // 同一文案可能还出现在收起的导航菜单里（隐藏），只取可见的那个
  await expect(page.getByText(expectText, { exact: true }).filter({ visible: true }).first()).toBeVisible({
    timeout: 15_000,
  })
  // 等列表、统计之类的异步内容落定（daisyUI 的 .loading 转圈全部消失）再扫裸 key
  await expect(page.locator('.loading')).toHaveCount(0, { timeout: 15_000 })

  const leaks = (await page.locator('body').innerText()).match(KEY_LEAK) ?? []
  expect(leaks, `bare i18n keys on ${path}`).toEqual([])
  expect(intlifyWarnings, `[intlify] warnings on ${path}`).toEqual([])
}

test.describe('zh-CN · guest routes', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  const routes: [path: string, key: string][] = [
    ['/', 'home.actions.datasets'],
    ['/datasets', 'common.page.publicDatasets'],
    ['/login', 'auth.login.title'],
    ['/register', 'auth.register.title'],
    ['/forgotpassword', 'auth.forgot.title'],
  ]
  for (const [path, key] of routes) {
    test(`${path} renders in Chinese without bare keys`, async ({ page }) => {
      await expectLocalizedPage(page, path, zh(key))
    })
  }

  // /s/:shareToken 匿名访问：渲染登录引导（分享内容需登录，见 useDatasetDetail）
  test('/s/:shareToken shows the sign-in gate in Chinese without bare keys', async ({ page, request }) => {
    const publicId = await firstPublicId(request)
    test.skip(!publicId, 'No public dataset available on this backend')
    await expectLocalizedPage(page, `/s/${publicId}`, zh('datasets.overview.loginRequired'))
  })

  // 公开页即可验证，放在未登录组：不依赖测试账号
  test('switching language at runtime re-renders the current page', async ({ page }) => {
    await expectLocalizedPage(page, '/datasets', zh('common.page.publicDatasets'))

    // 切换按钮在导航栏右侧（≥sm 显示）；切到英文后当前页标题应立即变成英文，且偏好被记住
    await page.getByRole('button', { name: zh('common.language.switch') }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('heading', { name: 'Public Datasets' })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Public Datasets' })).toBeVisible()
  })
})

test.describe('zh-CN · signed-in routes', () => {
  const routes: [path: string, key: string][] = [
    ['/mydatasets', 'common.page.myDatasets'],
    // /collections 只加载 collections 包；页头的「公开数据集 / 我的数据集」按钮曾引用 datasets 包的 key
    ['/collections', 'common.page.collections'],
    ['/workspace', 'workspace.dashboard.title'],
    ['/workspace/new', 'workspace.analysis.title'],
    // 创建页第一步的选择器文案在 collections.picker（Step 1 与 Step 2 分属两个子包段）
    ['/collections/new', 'collections.picker.step1'],
    ['/profile', 'users.profile.title'],
    // 无 history.state 直接进入：显示「未选择结果」空态，不依赖任何分析结果
    ['/vizworkbench', 'vizworkbench.ionImage.noResult'],
    // SI_DB 浏览页：tab 与列文案在 databases 包，此前从未进过本扫描（历史上
    // 漏加载命名空间会把裸 key 显示给用户，这条扫描正是防它的）
    ['/database', 'databases.title'],
  ]
  for (const [path, key] of routes) {
    test(`${path} renders in Chinese without bare keys`, async ({ page }) => {
      await expectLocalizedPage(page, path, zh(key))
    })
  }

  // /overview/:publicId（公开数据集）：public_id 从公开列表 API 取
  test('/overview/:publicId renders in Chinese without bare keys', async ({ page, request }) => {
    const publicId = await firstPublicId(request)
    test.skip(!publicId, 'No public dataset available on this backend')
    await expectLocalizedPage(page, `/overview/${publicId}`, zh('datasets.overview.title'))
  })

  // /collections/overview/:publicId 需要"存在一个集合"。后端不保证有存量，
  // 这里用 API 建临时集合（2 个公开成员，最小 payload 即可）→ 巡检 → 删除，
  // 用例自足不依赖环境。注意 request fixture 不带登录态（与页面 storageState
  // 无关，实测 POST /api/collections 会 401）：显式登录拿 token 再带 Authorization。
  test('/collections/overview/:publicId renders in Chinese without bare keys', async ({ page, request }) => {
    const files = await request.post('/api/files/list_files?page=1&size=2', { data: {} })
    const ids = ((await files.json())?.data ?? []).map(
      (d: { public_id?: string }) => d.public_id,
    )
    test.skip(!ids[0] || !ids[1], '需要 ≥2 个公开数据集来建临时集合')

    const username = process.env.E2E_USERNAME
    const password = process.env.E2E_PASSWORD
    if (!username || !password) {
      // test.skip 抛异常结束用例；throw 只是让 TS 收窄类型（与 auth.spec 同款写法）
      test.skip(true, '缺少 E2E_USERNAME / E2E_PASSWORD 环境变量')
      throw new Error('skipped')
    }
    const login = await request.post('/api/login', { form: { username, password } })
    test.skip(!login.ok(), '登录失败，无法建临时集合')
    const auth = { Authorization: `Bearer ${(await login.json()).access_token}` }

    const created = await request.post('/api/collections', {
      headers: auth,
      data: { name: `zh-smoke-${Date.now()}`, file_public_ids: ids },
    })
    const publicId = (await created.json())?.public_id
    test.skip(!publicId, '临时集合创建失败')
    try {
      // 锚点用元数据面板标题：Members 标题 h2 内嵌数量徽章（"成员 2/50 数据集"），
      // getByText exact 匹配不上复合文本
      await expectLocalizedPage(page, `/collections/overview/${publicId}`, zh('collections.panel.title'))
    } finally {
      await request.delete(`/api/collections/${publicId}`, { headers: auth })
    }
  })
})

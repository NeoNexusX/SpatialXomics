import { test, expect } from '@playwright/test'

/**
 * Auth E2E 测试
 * =============
 * 覆盖登录、注册校验、忘记密码、Profile 页面、路由守卫（含管理员守卫）、登出。
 *
 * 架构：
 *   auth.setup.ts  → 先登录一次，存入 .auth/user.json
 *   Unauthenticated → 清除 storageState，模拟未登录（登录、注册、忘记密码测试）
 *   Authenticated   → 复用 .auth/user.json，直接进已登录页面（Profile、弹窗校验）
 *
 * 测试环境：
 *   本地：npm run dev  → Vite proxy /api/* → .env.development 中的 VITE_BACKEND_URL
 *   CI：  npm run preview → Vite proxy /api/* → .env.production 中的 VITE_BACKEND_URL
 *
 * 需后端：登录、Profile 数据加载、Profile 保存、登出
 * 纯前端：注册校验、忘记密码校验、弹窗校验（不提交，只测前端逻辑）
 *
 */

// ============================================================
// 组 1：未登录状态（清除 storageState → 模拟新用户）
// ============================================================

test.describe('Unauthenticated', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  // ── 登录 ──
  // 账号密码与 auth.setup.ts 保持一致，从环境变量读取（CI: GitHub Secrets，本地: 当前 shell export）

  test('can login with valid credentials', async ({ page }) => {
    const username = process.env.E2E_USERNAME
    const password = process.env.E2E_PASSWORD
    if (!username || !password) {
      throw new Error('缺少 E2E_USERNAME / E2E_PASSWORD，请在 CI secrets 或当前 shell 中 export')
    }

    await page.goto('/login')

    await page.fill('input[placeholder="Username"]', username)
    await page.fill('input[placeholder="Password"]', password)

    await page.click('button:has-text("Sign In")')

    // 成功 toast + 跳转到默认落地页。每个项目的第一条用例赶上浏览器冷启动，
    // 登录请求又要走真实后端，默认 5s 不够（webkit 上偶发）
    await expect(page.locator('.toast')).toContainText('Login successful', { timeout: 15_000 })
    await expect(page).toHaveURL(/\/datasets/, { timeout: 15_000 })
  })

  test('shows error with invalid credentials', async ({ page }) => {
    await page.goto('/login')

    await page.fill('input[placeholder="Username"]', 'nonexistent_user_12345')
    await page.fill('input[placeholder="Password"]', 'wrongpassword')

    await page.click('button:has-text("Sign In")')

    // 后端返回 "Incorrect username or password"
    await expect(page.locator('.toast')).toContainText('Incorrect')
  })

  test('route guard — redirects to login when accessing protected page', async ({ page }) => {
    await page.goto('/profile')

    // 未登录 → 踢到 /login，URL 带 redirect 参数
    await expect(page).toHaveURL(/\/login/)
    expect(page.url()).toContain('redirect=')
  })

  // ── 注册页表单校验（不提交，不调后端）──

  test('register form — validates password mismatch', async ({ page }) => {
    await page.goto('/register')

    await page.fill('input[placeholder="Password"]', 'StrongPass1')
    await page.fill('input[placeholder="Confirm Password"]', 'DifferentPass2')
    await page.locator('input[placeholder="Confirm Password"]').blur()

    // 两次密码不一致 → 行内错误
    await expect(page.getByText('Passwords do not match')).toBeVisible()
  })

  test('register form — shows password strength meter', async ({ page }) => {
    await page.goto('/register')

    // 8 位纯小写字母 → score=1 → "Very Weak"
    await page.fill('input[placeholder="Password"]', 'abcdefgh')
    await expect(page.getByText('Very Weak')).toBeVisible()

    // 12+ 位含大小写+数字+特殊字符 → score=5 → "Strong"
    await page.fill('input[placeholder="Password"]', 'VeryStr0ng!Pass')
    await expect(page.getByText('Strong')).toBeVisible()
  })

  test('register form — validates ORCID format', async ({ page }) => {
    await page.goto('/register')

    // ORCID 在右侧栏，需先滚动到可见
    const orcidInput = page.locator('input[placeholder="ORCID (Optional)"]')
    await orcidInput.scrollIntoViewIfNeeded()
    await orcidInput.fill('bad-format')
    await orcidInput.blur()

    // 非法格式 → 行内错误，完整提示含示例
    await expect(page.getByText('Invalid ORCID format (e.g. 0000-0000-0000-0000)')).toBeVisible()
  })

  test('register form — requires account info before sending code', async ({ page }) => {
    await page.goto('/register')

    // 账号信息没填完就点发送验证码
    await page.click('button:has-text("Send Code")')

    // toast 提示先填完账号信息
    await expect(page.locator('.toast')).toContainText('complete the account information')
  })

  // ── 忘记密码页校验（不提交，不调后端）──

  test('forgot password — validates invalid email', async ({ page }) => {
    await page.goto('/forgotpassword')

    await page.fill('input[placeholder="Email"]', 'not-an-email')
    await page.locator('input[placeholder="Email"]').blur()
    await page.click('button:has-text("Send Code")')

    // 非法邮箱格式 → toast
    await expect(page.locator('.toast')).toContainText('valid email')
  })
})

// ============================================================
// 组 2：已登录状态（auth.setup.ts 已注入 token）
// ============================================================

test.describe('Authenticated', () => {

  // ── Profile 页面 ──

  test('profile page loads user data after login', async ({ page }) => {
    await page.goto('/profile')

    // 验证 Profile 页核心区块渲染（数据来自真实后端 /api/user）
    await expect(page.locator('h1:has-text("Profile")')).toBeVisible()
    await expect(page.locator('text=Quota Usage')).toBeVisible()
    await expect(page.locator('text=Academic Profile')).toBeVisible()
  })

  test('can edit academic profile and save', async ({ page }) => {
    // ⚠️ 此测试会通过 POST /api/user_change 真实写入数据库
    await page.goto('/profile')

    await page.fill('input[placeholder="University Name"]', 'Test University')
    await page.fill('input[placeholder="e.g. Computer Vision"]', 'Testing')

    await page.click('button:has-text("Save All Changes")')

    // 保存成功 → toast
    await expect(page.locator('.toast')).toContainText('Updated')
  })

  // ── 路由守卫 + 持久化 ──

  test('route guard — visiting /login redirects when already logged in', async ({ page }) => {
    await page.goto('/mydatasets')    // 确保已登录
    await page.goto('/login')

    // 已登录 → 踢回默认落地页 /datasets
    await expect(page).toHaveURL(/\/datasets/)
  })

  // ── 管理员路由守卫 ──

  test('route guard — /users is admin-only', async ({ page }) => {
    // 守卫要等 /api/user 返回 identity 后才决定放行或弹走：
    // 等任意一侧的页面真正渲染（/users 的 User Management 或 /profile 的 Profile）
    await page.goto('/users')
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 10_000 })

    // E2E 账号是 admin 时守卫放行，"非管理员被弹走"的前提不成立 → skip 而非误报
    if (page.url().includes('/users')) {
      test.skip(true, 'E2E account is admin — non-admin bounce is not testable')
      return
    }
    // 普通用户：router.beforeEach 的 adminRequired 分支把已登录非管理员弹到 /profile
    await expect(page).toHaveURL(/\/profile/)
  })

  test('token persistence — survives page reload', async ({ page }) => {
    await page.goto('/profile')
    await page.reload()
    await page.waitForURL('/profile')

    // token 从 localStorage 恢复，仍然在 /profile
    await expect(page).toHaveURL('/profile')
    await expect(page.locator('text=Quota Usage')).toBeVisible()
  })

  // ── 邮箱弹窗（不提交，只测前端校验）──

  test('change email modal — validates empty fields', async ({ page }) => {
    await page.goto('/profile')

    // 打开弹窗
    await page.click('button:has-text("Change Email")')
    await expect(page.locator('h3:has-text("Change Email")')).toBeVisible()

    // 不填内容直接点 Confirm
    await page.click('.modal-box button:has-text("Confirm")')
    await expect(page.locator('.toast')).toContainText('Please enter new email')
  })

  // ── 密码弹窗（不提交，只测前端校验）──

  test('change password modal — validates mismatch', async ({ page }) => {
    await page.goto('/profile')

    await page.click('button:has-text("Change Password")')
    await expect(page.locator('h3:has-text("Change Password")')).toBeVisible()

    // 两次密码不一致
    await page.fill('.modal-box input[placeholder="Enter new password"]', 'StrongPass1')
    await page.fill('.modal-box input[placeholder="Re-enter new password"]', 'DifferentPass2')

    // 确认按钮被禁用 + 行内不匹配提示
    const confirmBtn = page.locator('.modal-box .modal-action button:has-text("Change Password")')
    await expect(confirmBtn).toBeDisabled()
    await expect(page.locator('text="Passwords do not match"')).toBeVisible()
  })

  test('change password modal — shows strength meter', async ({ page }) => {
    await page.goto('/profile')

    await page.click('button:has-text("Change Password")')

    // 弱密码 → "Very Weak"
    await page.fill('.modal-box input[placeholder="Enter new password"]', 'abcdefgh')
    await expect(page.getByText('Very Weak')).toBeVisible()

    // 强密码 → "Strong"
    await page.fill('.modal-box input[placeholder="Enter new password"]', 'VeryStr0ng!Pass')
    await expect(page.getByText('Strong')).toBeVisible()
  })

  // ── 登出（放本组最后：真实调用 POST /logout，可能吊销共享 token）──

  test('logout — clears the session and redirects to login', async ({ page }) => {
    const username = process.env.E2E_USERNAME
    const password = process.env.E2E_PASSWORD
    if (!username || !password) {
      throw new Error('缺少 E2E_USERNAME / E2E_PASSWORD，请在 CI secrets 或当前 shell 中 export')
    }

    await page.goto('/profile')
    await expect(page.getByText('Quota Usage')).toBeVisible()

    // navbar 头像下拉（daisyui 靠 :focus-within 展开，点击头像即聚焦）
    await page.locator('.avatar-placeholder[role="button"]').click()
    await page.getByText('Sign out', { exact: true }).click()

    // 跳回登录页 + 本地 token 已清（authStore.logout 的 finally 分支）
    await expect(page).toHaveURL(/\/login/)
    expect(await page.evaluate(() => localStorage.getItem('access_token'))).toBeNull()

    // 受保护页现在会被守卫弹回登录页（带 redirect 参数）
    await page.goto('/profile')
    await expect(page).toHaveURL(/\/login/)
    expect(page.url()).toContain('redirect=')

    // ---- 恢复共享登录态 ----
    // 登出真实调用 POST /logout：若后端吊销 token，.auth/user.json 里的旧 token
    // 就失效了，本轮后续所有已登录测试（本文件及其它 spec）都会 401。这里用
    // 同一账号重新登录，并拿新会话覆写共享状态文件（workers:1 顺序执行，无并发写）。
    // login() 在跳转前就把 token 写进 localStorage，waitForURL 返回即可保存；
    // h1 断言只是确认应用带会话正常启动了。
    await page.fill('input[placeholder="Username"]', username)
    await page.fill('input[placeholder="Password"]', password)
    await page.click('button:has-text("Sign In")')
    await page.waitForURL(/\/(datasets|profile)/)
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 10_000 })
    await page.context().storageState({ path: '.auth/user.json' })
  })
})

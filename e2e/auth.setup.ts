import { test as setup } from '@playwright/test'

/**
 * Auth Setup — 全局登录初始化
 * ============================
 * 在所有测试之前运行（playwright.config.ts 中 setup project），
 * 只跑一次，用真实账号登录后把 token/localStorage/cookie 保存到 .auth/user.json。
 *
 * 使用场景：
 *   - Authenticated 组的测试通过 storageState: '.auth/user.json' 复用此登录态
 *   - Unauthenticated 组的测试通过 storageState: { cookies: [], origins: [] } 清除
 *
 * .auth/ 目录已加入 .gitignore，不会提交。
 *
 * 账号密码不硬编码，从环境变量读取：
 *   - CI：由 GitHub Secrets（E2E_USERNAME / E2E_PASSWORD）注入
 *   - 本地：运行 Playwright 前 export（Vite 的 env/ 文件不会注入测试进程）
 */
setup('authenticate', async ({ page }) => {
  const username = process.env.E2E_USERNAME
  const password = process.env.E2E_PASSWORD
  if (!username || !password) {
    throw new Error('缺少 E2E_USERNAME / E2E_PASSWORD，请在 CI secrets 或当前 shell 中 export；离线回归可运行 npm run test:e2e:offline')
  }
  await page.goto('/login')

  await page.fill('input[placeholder="Username"]', username)
  await page.fill('input[placeholder="Password"]', password)

  await page.click('button:has-text("Sign In")')

  // 等待登录完成，跳转到默认落地页 /datasets（或 /profile）
  await page.waitForURL(/\/(datasets|profile)/)
  await page.waitForLoadState('networkidle')

  // 保存浏览器状态（token、localStorage、cookie）供后续测试复用
  await page.context().storageState({ path: '.auth/user.json' })
})

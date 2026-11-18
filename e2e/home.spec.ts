import { test, expect } from '@playwright/test'

/**
 * 首页 E2E 测试
 * ============
 * 首页为公开页（无需登录），是浅灰底上的一串圆角面板：
 *   Hero → Stats（概览、开发动态与内部滚动叠卡）→ Team（含页脚）
 * window 滚动 + Lenis 平滑；宽屏下面板在同一上沿停住、由下一张盖上来（sticky 叠层）。
 * 入场动画在元素进入视口时才播，之前是隐藏的（visibility: hidden），断言前要先把区块滚进视口。
 *
 * 首页内容来自 public/content.json + 后端 /stats/* 接口。
 * 后端不可用时，Stats 卡片标题仍然渲染，数字显示 loading 或 error。
 *
 * goto 统一用 domcontentloaded：页面引用境外 OSS 图片，慢网络下 load 事件
 * （等全部图片）易超 30s 用例上限；断言自带轮询，无需等全量资源加载。
 */

// ── Hero（首屏，无后端依赖）──

test('hero scene renders with title and join button', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  // Hero 场景可见
  await expect(page.locator('#hero')).toBeVisible()

  // "Join to start" 按钮（已登录时不跳 /register，路由守卫会踢到 /profile）
  await expect(page.locator('a:has-text("Join to start")')).toBeVisible()

  // Hero keeps one primary action. Dataset access lives inside its KPI card.
  const hero = page.locator('#hero')
  for (const name of ['View Datasets', 'Upload data', 'Quick start']) {
    await expect(hero.getByRole('link', { name })).toHaveCount(0)
  }
  await expect(hero.locator('.hero-media img')).toHaveCount(2)
  await expect(hero.locator('.hero-media button')).toHaveCount(0)
})

// ── Stats（第 2 张面板，有后端数据 /stats/*）──

test('stats scene shows section heading and stat card labels', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  // 滚动到 Stats 面板。平滑滚动在停靠边界可能来回抖动、远程图片加载也会持续改变布局，
  // scrollIntoViewIfNeeded 可能一直等不到「稳定」；设上限，超时则瞬时滚动兜底。
  await page
    .locator('#stats')
    .scrollIntoViewIfNeeded({ timeout: 5_000 })
    .catch(() =>
      page.evaluate(() =>
        document.querySelector('#stats')?.scrollIntoView({ behavior: 'instant', block: 'start' }),
      ),
    )

  // 标题
  await expect(page.getByRole('heading', { name: 'Stats' })).toBeVisible()

  // 卡片仅随页面滚动，无分页和数量标记；开发动态属于同一统计区。
  const stats = page.locator('#stats')
  const distribution = page.locator('#distribution')
  await expect(distribution.getByRole('navigation')).toHaveCount(0)
  // The left modules enter first; the first right card becomes interactive only
  // after landing. Sample native scroll rather than duplicating GSAP distances.
  await expect
    .poll(
      async () => {
        await page.evaluate(async () => {
          window.scrollBy({ top: 64, behavior: 'instant' })
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        })
        return distribution.locator('[data-stack-card]').first().getAttribute('inert')
      },
      { timeout: 10_000, intervals: [32] },
    )
    .toBeNull()
  await expect(distribution.getByRole('heading', { name: 'Organism', exact: true })).toBeVisible()
  await expect(stats.locator('#activity').getByRole('link', { name: 'Development' })).toBeVisible()
  await expect(
    stats.locator('.kpi-card').getByRole('link', { name: 'View Datasets' }),
  ).toHaveAttribute('href', '/datasets')

  // 四张数字卡标题（固定文本）
  for (const title of ['Total Users', 'Total Datasets', 'Total Downloads', 'Total Visits']) {
    await expect(page.getByText(title)).toBeVisible()
  }

  // 数据加载完成 → 数字卡有值（加载中的数字带 aria-busy）
  // /stats/* 走远程后端，慢网络下 5s 默认超时不够，放宽到 15s
  await expect(page.locator('.kpi-value[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 })

  // 每张数字卡都有数字
  const values = page.locator('.kpi-value')
  for (let i = 0; i < 4; i++) {
    await expect(values.nth(i)).toContainText(/\d/)
  }
})

test('the last stacked card closes the bottom before the team section enters', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const stack = page.locator('#distribution')
  await expect(stack).toHaveAttribute('data-stacked', '')
  const cards = stack.locator('[data-stack-card]')
  const last = cards.last()

  // Small native scroll increments sample the final reading interval, without
  // importing the animation's distance formula into the test.
  await expect
    .poll(
      async () => {
        await page.evaluate(async () => {
          window.scrollBy({ top: 96, behavior: 'instant' })
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        })
        return last.getAttribute('inert')
      },
      { timeout: 10_000, intervals: [32] },
    )
    .toBeNull()
  await expect(last).not.toHaveAttribute('inert')
  const bounds = await cards.evaluateAll((elements) =>
    elements.map((element) => {
      const { top, bottom } = element.getBoundingClientRect()
      return { top, bottom }
    }),
  )
  for (let index = 1; index < bounds.length; index++) {
    expect(bounds[index]!.top).toBeGreaterThanOrEqual(bounds[index - 1]!.top)
    expect(bounds[index]!.bottom).toBeGreaterThan(bounds[index - 1]!.bottom)
    expect(
      Math.abs(bounds[index]!.bottom - bounds[index]!.top - (bounds[0]!.bottom - bounds[0]!.top)),
    ).toBeLessThan(2)
  }
  const statsTop = await page.locator('#stats').evaluate((element) => ({
    actual: element.getBoundingClientRect().top,
    expected: parseFloat(getComputedStyle(element).top),
  }))
  expect(Math.abs(statsTop.actual - statsTop.expected)).toBeLessThan(2)
  expect(
    await page.locator('#team').evaluate((element) => element.getBoundingClientRect().top),
  ).toBeGreaterThanOrEqual(800)
})

// ── Team + 页脚（末尾，无后端依赖）──

test('footer shows team info, powered by, and copyright', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  // 滚动到底部：Lenis 不接管键盘，End 键走原生滚动。
  // 先等首页渲染出来（路由要等 content.json 和首页 chunk），否则 End 时页面还没有高度、什么都没滚
  await page.locator('#team').waitFor()
  await page.keyboard.press('End')

  // 团队标题
  await expect(page.getByText('The Team')).toBeVisible()
  await expect(page.getByText('Built by people who love science and engineering.')).toHaveCount(0)

  // Powered by
  await expect(page.locator('#team footer').getByText('Powered by')).toBeVisible()

  // 版权（年份动态，只断言固定部分）
  await expect(page.getByText('All rights reserved by Bionet')).toBeVisible()
})

for (const scenario of [
  { name: 'mobile', width: 390, reducedMotion: 'no-preference' as const },
  { name: 'reduced motion', width: 1280, reducedMotion: 'reduce' as const },
]) {
  test(`${scenario.name} keeps all distribution cards in normal document flow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: scenario.width, height: 800 })
    await page.emulateMedia({ reducedMotion: scenario.reducedMotion })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const distribution = page.locator('#distribution')
    await expect(distribution.getByRole('heading')).toHaveCount(4)
    await expect(distribution.getByRole('navigation')).toHaveCount(0)
    const cards = distribution.locator('article')
    const bounds = await cards.evaluateAll((items) =>
      items.map((item) => {
        const { top, bottom } = item.getBoundingClientRect()
        return { top, bottom }
      }),
    )
    for (let index = 1; index < bounds.length; index++) {
      expect(bounds[index]!.top).toBeGreaterThanOrEqual(bounds[index - 1]!.bottom)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      scenario.width,
    )
  })
}

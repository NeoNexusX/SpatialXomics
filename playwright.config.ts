import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
/** 中文冒烟用例只在 chromium-zh 里跑；其余项目锁定 en-US，跑到它会误报 */
const ZH_SMOKE = /i18n-zh\.spec\.ts/
const OFFLINE = /\.offline\.spec\.ts/
const LIVE_IGNORE = [ZH_SMOKE, OFFLINE]
/** WebKit 默认不跑；设 E2E_WEBKIT=1 才加入 webkit 和 offline-webkit 两个项目 */
const WEBKIT_ENABLED = process.env.E2E_WEBKIT === '1'
const serverPort = Number(process.env.E2E_PORT || (process.env.CI ? 4173 : 5173))

export default defineConfig({
  testDir: './e2e',
  /* Maximum time one test can run for. */
  timeout: 30 * 1000,
  /* CI 上整轮的上限：到点后写出报告再退出，而不是被 job 超时直接杀掉。 */
  globalTimeout: process.env.CI ? 75 * 60 * 1000 : undefined,
  expect: {
    /**
     * Maximum time expect() should wait for the condition to be met.
     * For example in `await expect(locator).toHaveText();`
     */
    timeout: 5000,
  },
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  // github 把失败写成 Actions 注解，不用翻日志就能看到是哪条用例、什么错误
  reporter: process.env.CI ? [['dot'], ['github'], ['html', { open: 'never' }]] : 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* 单个动作的上限。长预算用例（分析、上传）卡在某次点击时，不必等到整条用例超时。 */
    actionTimeout: 30 * 1000,
    // 带 OSS 预览图的页面 load 事件在 CI 上可能很慢，比动作多留一些
    navigationTimeout: 60 * 1000,
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: `http://localhost:${serverPort}`,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',

    /* Only on CI systems run the tests headless */
    headless: !!process.env.CI,

    /**
     * 固定浏览器语言，保证 e2e 的确定性。
     *
     * 应用首访没有保存过的偏好时会按 navigator.language 探测语言（见 useLocale.ts），
     * 不锁的话，跑在中文系统的开发机 / CI 上会整站渲染成中文，而现有断言全是英文文案
     * （getByText('Sign out') 之类），会集体误报。
     *
     * 这里锁的是 navigator.language 而不是往 localStorage 里塞值：后者对未登录组
     * （storageState 被清空）和 setup project 都不生效。
     *
     * 中文冒烟用例在单独的 chromium-zh project 里覆盖 locale: 'zh-CN'，不要动这里。
     */
    locale: 'en-US',
  },

  /* Configure projects for major browsers */
  projects: [
    // 浏览器真实运行应用，仅在网络边界替换后端和 LLM；无需账号或模型密钥。
    ...(['chromium', 'firefox', ...(WEBKIT_ENABLED ? (['webkit'] as const) : [])] as const).map((browserName) => ({
      name: `offline-${browserName}`,
      testMatch: OFFLINE,
      // 响应是固定的，失败基本都是真问题；留一次重试只为挡住 runner 偶发的卡顿
      retries: process.env.CI ? 1 : 0,
      use: {
        browserName,
        headless: true,
        storageState: { cookies: [], origins: [] },
        trace: 'retain-on-failure' as const,
      },
    })),
    // Setup — 先登录一次，保存状态给后续测试复用
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      testIgnore: LIVE_IGNORE,
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/user.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'firefox',
      testIgnore: LIVE_IGNORE,
      use: {
        ...devices['Desktop Firefox'],
        storageState: '.auth/user.json',
      },
      dependencies: ['setup'],
    },
    ...(WEBKIT_ENABLED
      ? [
          {
            name: 'webkit',
            testIgnore: LIVE_IGNORE,
            use: {
              ...devices['Desktop Safari'],
              storageState: '.auth/user.json',
            },
            dependencies: ['setup'],
          },
        ]
      : []),
    // 中文冒烟：浏览器语言设为 zh-CN，巡检各路由没有裸 key、确实渲染成中文。
    // 只跑 chromium——它验的是语言包与懒加载，不是浏览器兼容性。
    {
      name: 'chromium-zh',
      testMatch: ZH_SMOKE,
      use: {
        ...devices['Desktop Chrome'],
        locale: 'zh-CN',
        storageState: '.auth/user.json',
      },
      dependencies: ['setup'],
    },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: {
    //     ...devices['Pixel 5'],
    //   },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: {
    //     ...devices['iPhone 12'],
    //   },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: {
    //     channel: 'msedge',
    //   },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: {
    //     channel: 'chrome',
    //   },
    // },
  ],

  /* Folder for test artifacts such as screenshots, videos, traces, etc. */
  // outputDir: 'test-results/',

  /* Run your local dev server before starting the tests */
  webServer: {
    /**
     * Use the dev server by default for faster feedback loop.
     * Use the preview server on CI for more realistic testing.
     * Playwright will re-use the local server if there is already a dev-server running.
     */
    command: process.env.CI
      ? `npm run preview -- --port ${serverPort}`
      : `npm run dev:app -- --port ${serverPort}`,
    port: serverPort,
    reuseExistingServer: !process.env.CI,
  },
})

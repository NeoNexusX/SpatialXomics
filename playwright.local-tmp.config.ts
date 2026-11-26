import { defineConfig } from '@playwright/test'
import base from './playwright.config'

const executablePath = `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-mac-arm64/chrome-headless-shell`

export default defineConfig({
  ...base,
  reporter: 'line',
  projects: [
    {
      name: 'offline-chromium',
      testMatch: /\.offline\.spec\.ts/,
      testIgnore: process.env.CAPTURE_OUT ? [] : /tools\.offline\.spec\.ts/,
      use: {
        browserName: 'chromium',
        headless: true,
        storageState: { cookies: [], origins: [] },
        launchOptions: { executablePath },
      },
    },
  ],
})

import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config'

// vite.config 导出的是「函数式配置」(env => config)，需先用当前 env 求值成对象再合并，
// 否则 mergeConfig 无法合并一个函数（TS2345）。
export default defineConfig((configEnv) =>
  mergeConfig(
    viteConfig(configEnv),
    defineConfig({
      test: {
        environment: 'jsdom',
        exclude: [...configDefaults.exclude, 'e2e/**', '.claude/worktrees/**'],
        root: fileURLToPath(new URL('./', import.meta.url)),
        coverage: {
          provider: 'v8',
          reporter: ['text', 'html'],
          // 只统计业务源码。当前覆盖率很低，先不设全局阈值——
          // 阈值现在只会逼人删阈值；待 zarr 等核心模块覆盖起来后再加
          include: ['src/**/*.{ts,vue}'],
          exclude: ['src/**/__tests__/**'],
        },
      },
    }),
  ),
)

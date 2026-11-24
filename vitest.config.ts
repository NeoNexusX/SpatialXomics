import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config'

// vite.config 导出的是「函数式配置」(env => config)，需先用当前 env 求值成对象再合并，
// 否则 mergeConfig 无法合并一个函数（TS2345）。vite.config 的工厂是 async 的（启动时
// 探测本地代理），所以这里也要 await，否则合并的是一个 Promise：别名和 Vue 插件全部丢失，
// 每个测试文件都会在 import 解析阶段报 "Failed to resolve import" / "Install @vitejs/plugin-vue"。
export default defineConfig(async (configEnv) =>
  mergeConfig(
    await viteConfig(configEnv),
    defineConfig({
      test: {
        environment: 'jsdom',
        exclude: [...configDefaults.exclude, 'e2e/**', '.claude/worktrees/**'],
        root: fileURLToPath(new URL('./', import.meta.url)),
        coverage: {
          provider: 'v8',
          // 逐文件的表格有上千行，CI 日志里只留汇总
          reporter: process.env.CI ? ['text-summary'] : ['text', 'html'],
          // 只统计业务源码。当前覆盖率很低，先不设全局阈值——
          // 阈值现在只会逼人删阈值；待 zarr 等核心模块覆盖起来后再加
          include: ['src/**/*.{ts,vue}'],
          exclude: ['src/**/__tests__/**'],
        },
      },
    }),
  ),
)

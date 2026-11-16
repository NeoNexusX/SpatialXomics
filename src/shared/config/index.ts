/**
 * 配置统一出口。
 *
 * 分三层：
 * - runtimeConfig.ts  运行时人编辑的 config.json（应用名称、导航、分页、验证码等全站开关）
 * - env.ts            构建/部署环境变量（API 地址，随部署变化）
 * - 其余              代码内部常量（存储键名、OSS 调优参数等，非人来配置）
 *
 * 首页展示内容不在这里：见 features/home/config/contentConfig.ts（public/content.json）。
 *
 * 用法：
 *   import { ENV, STORAGE_KEYS } from '@/shared/config'
 *   import { getAppName } from '@/shared/config/appName'     // 直接导入，避免触发模块级 getConfig()
 *   import { getConfig } from '@/shared/config/runtimeConfig'   // 读分页/验证码/选项等运行时配置
 */
export { ENV } from './env'
export { STORAGE_KEYS, SESSION_KEYS } from './storageKeys'
export { OSS_UPLOAD, pickPartPlan, planForPartSize } from './defaults'
export { getConfig } from './runtimeConfig'

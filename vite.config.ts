import { fileURLToPath, URL } from 'node:url'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

import { defineConfig, loadEnv, type Plugin } from 'vite'
import type { Connect } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite';
import vueI18n from '@intlify/unplugin-vue-i18n/vite'

/**
 * 构建期预压缩：为产物额外写出 .gz / .br，配合 nginx 的 gzip_static / brotli_static。
 *
 * 预压缩比 nginx 运行时压缩好在两点：能用上最高压缩等级（运行时用 level 11 太费 CPU），
 * 且每个请求省掉一次压缩计算。实测本项目最大的 index CSS：
 * nginx 默认 gzip level 1 = 40.3KB，level 6 = 32.0KB，预压缩 gzip -9 = 31.7KB，brotli q11 = 25.7KB。
 *
 * 只处理 bundle 产物（带 hash 的 assets + index.html），**不碰 public/ 拷贝过来的文件**。
 * 这是有意为之：config.json / content.json 允许运维在服务器上直接改，若存在一份陈旧的
 * .gz，开了 gzip_static 的 nginx 会优先返回那份压缩件，改动就再也不生效了。
 */
function precompressAssets(): Plugin {
  const COMPRESSIBLE = /\.(js|mjs|css|html|svg|json|txt|map)$/
  // 小文件压缩后常常更大，且 nginx 也有 gzip_min_length 下限，一并跳过
  const MIN_BYTES = 1024

  return {
    name: 'precompress-assets',
    apply: 'build',
    writeBundle(options, bundle) {
      const outDir = options.dir
      if (!outDir) return
      for (const fileName of Object.keys(bundle)) {
        if (!COMPRESSIBLE.test(fileName)) continue
        const full = path.join(outDir, fileName)
        let buf: Buffer
        try {
          buf = readFileSync(full)
        } catch {
          continue
        }
        if (buf.length < MIN_BYTES) continue
        writeFileSync(`${full}.gz`, zlib.gzipSync(buf, { level: 9 }))
        writeFileSync(
          `${full}.br`,
          zlib.brotliCompressSync(buf, {
            params: {
              [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
              [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
            },
          }),
        )
      }
    },
  }
}

/**
 * LLM BYOK 动态转发（仅 dev）：POST /llm-relay/<path>，目标 origin 放
 * x-llm-target header。用 node 原生 fetch 转发（SSE 流式直通，不缓冲）。
 *
 * 为什么不走 server.proxy：vite 7 调 http-proxy 的 proxy.web 时第三参恒为空
 * 对象，动态 router 回调永远不会被读取（源码 proxyMiddleware 里只透传构造期
 * opts），按 header 定向只能自己写中间件。
 *
 * 安全边界：仅 dev server；目标校验 ^https?://origin$，不带路径（路径由请求
 * URL 承载，防 x-llm-target 注入任意完整 URL）。
 */
function llmRelayPlugin(): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    // 挂载时 use('/llm-relay') 会剥掉前缀，这里 req.url 已是 /<path> 形式
    if (!req.url || req.url === '/') return next()
    const target = req.headers['x-llm-target']
    if (typeof target !== 'string' || !/^https?:\/\/[^/]+$/.test(target)) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'missing/invalid x-llm-target header (expect origin, no path)' } }))
      return
    }

    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const outgoing = new URL(req.url!, target)
      // 透传除 host/连接管理外的头（保留 Authorization / Content-Type）
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(req.headers)) {
        if (v == null) continue
        if (['host', 'connection', 'x-llm-target', 'content-length', 'transfer-encoding'].includes(k)) continue
        headers[k] = Array.isArray(v) ? v.join(', ') : v
      }

      fetch(outgoing, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
        // @ts-expect-error node fetch 的双工流选项（透传客户端断连）
        duplex: 'half',
      })
        .then(async (upstream) => {
          const h: Record<string, string> = {}
          upstream.headers.forEach((v, k) => {
            // 跳过逐跳头与 content-length（流式转发后长度会变）
            if (['transfer-encoding', 'connection', 'content-length', 'content-encoding'].includes(k)) return
            h[k] = v
          })
          h['cache-control'] = 'no-cache'
          res.writeHead(upstream.status, h)
          if (!upstream.body) {
            res.end()
            return
          }
          const reader = upstream.body.getReader()
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              const canContinue = res.write(Buffer.from(value))
              if (!canContinue) await new Promise<void>((r) => res.once('drain', () => r()))
            }
          } catch {
            // 客户端断开等
          } finally {
            res.end()
          }
        })
        .catch((err: unknown) => {
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' })
          }
          res.end(
            JSON.stringify({
              error: { message: `relay failed: ${(err as Error)?.message ?? 'unknown'}`, type: 'relay_error' },
            }),
          )
        })
    })
  }

  return {
    name: 'llm-relay',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/llm-relay', middleware)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // envDir 指向 env/ 目录，集中管理多环境 .env 文件
  const envDir = fileURLToPath(new URL('./env', import.meta.url))
  const env = loadEnv(mode, envDir, 'VITE_')
  const backendUrl = env.VITE_BACKEND_URL || 'http://localhost:8000'

  return {
    envDir: envDir,
    envPrefix: 'VITE_',
    plugins: [
      vue(),
      vueDevTools(),
      tailwindcss(),
      vueI18n({
        include: [fileURLToPath(new URL('./src/i18n/locales/**', import.meta.url))],
        /**
         * 构建期把 json 消息预编译成函数，运行时就不必再带 message compiler（产物小一截）。
         *
         * 但 test 模式下必须关掉：单测里若直接用内联字符串消息造 i18n 实例，没有编译器会在
         * 运行时抛错。测试产物体积无所谓，这里换稳定性。
         */
        runtimeOnly: mode !== 'test',
        compositionOnly: true,   // 本项目只用 Composition API，不生成 legacy 兼容层
        fullInstall: false,      // 不注册用不到的 <i18n-d> / <i18n-n> 组件
      }),
      precompressAssets(),
      llmRelayPlugin(),
    ],
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      proxy: {
        // Live KEGG tools use the official REST API via same-origin requests.
        '/kegg-rest': {
          target: 'https://rest.kegg.jp',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/kegg-rest/, ''),
        },
        '/api': {
          target: backendUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, '')
        },
        // SXO-Harness LLM 中转（仅 dev）：浏览器直连外部 LLM 端点会受本机代理/CORS 影响
        // （系统代理转发 502、长 SSE 流被掐断），经 vite dev server 服务端转发规避。
        // 生产环境不走这里（同源 nginx 转发或浏览器直连 BYOK 端点）。
        // - /llm-proxy：env 默认端点（VITE_LLM_PROXY_URL）
        // - /llm-relay：BYOK 任意端点（目标 origin 在 x-llm-target header），由下方
        //   llmRelayPlugin 中间件处理——http-proxy 的动态 router 在 vite 的调用方式
        //   （proxy.web 第三参恒为空对象）下不生效，挂在 proxy 配置里没用
        ...(env.VITE_LLM_PROXY_URL
          ? {
              '/llm-proxy': {
                // target 只取 origin（env URL 可能带 /v1 等路径前缀，路径由请求
                // 路径承载，否则会拼出 /v1/v1/...）
                target: new URL(env.VITE_LLM_PROXY_URL).origin,
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/llm-proxy/, ''),
                // SSE 流式必需：不缓冲，chunk 到达即转发
                configure: (proxy) => {
                  proxy.on('proxyRes', (proxyRes) => {
                    proxyRes.headers['cache-control'] = 'no-cache'
                  })
                },
              },
            }
          : {}),
      }
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      },
    },
    // ESM workers: csvAnnotation.worker uses `new Worker(url, { type: 'module' })`.
    // Without this Vite defaults to iife workers, which fail to load an ESM
    // entry and silently fall back to the main-thread sync path.
    worker: {
      format: 'es',
    },
    build: {
      // 单 chunk 警告阈值提到 1500KB（echarts/ali-oss 这类大库会超）
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          // 手动分组 chunk，避免 Rollup 把跨路由共享模块拆成几十个微型 chunk。
          // src/shared/** 合并为一个 chunk，但排除 config/：其含运行时状态 _config，
          // 须与入口同 chunk 保证 loadConfig 求值时序（提前求值会抛错白屏）。
          // 重型库（echarts/ali-oss/zip）独立懒加载；其余业务代码按路由默认分包。
          manualChunks(id) {
            // 语言包保持随动态 import 独立成 chunk：只下载当前语言、当前路由需要的那一份。
            // 必须排在下面 shared 规则之前 —— 语言包一旦被并进那个 eager chunk，
            // 两种语言、所有 feature 的文案都会压进首屏，懒加载就白做了。
            if (id.includes('/src/i18n/locales/')) return
            // 国家名的非英文语言包同理（见 shared/utils/regionOptions.ts）：必须早于下面的
            // node_modules → vendor 规则返回，否则会被并进 eager 的 vendor chunk
            if (/\/i18n-iso-countries\/langs\/(?!en\.json)/.test(id)) return

            // src/shared 目录合并为一个 chunk（排除 config）
            if (
              id.includes('/src/shared/') &&
              !id.includes('/src/shared/config/')
            ) {
              return 'shared'
            }

            if (id.includes('node_modules')) {
              // Vue 运行时 + 路由 + Pinia：每页都用，尽早加载
              if (
                id.includes('node_modules/vue/') ||
                id.includes('node_modules/@vue/') ||
                id.includes('node_modules/vue-router/') ||
                id.includes('node_modules/pinia/') ||
                id.includes('plugin-vue/export-helper')
              ) {
                return 'vendor-vue'
              }
              // 重型库：仅特定路由用到，保持独立懒加载 chunk
              if (id.includes('node_modules/echarts/') || id.includes('node_modules/zrender/')) return 'vendor-echarts'
              if (id.includes('node_modules/ali-oss/')) return 'vendor-oss'
              // SXO-Harness的依赖（AI SDK、reka-ui、Comark、shiki）不设特殊规则：它们只被助手的
              // 异步组件引用，Rollup 默认分包会把它们归入懒加载 chunk，不会进首屏。
              // 其余 node_modules：不强制聚合进单一 vendor，交 Rollup 默认分包。
              // 项目通用库会被 Rollup 归入首屏共享 chunk（效果同旧 vendor 但自主分配），
              // 仅 SXO-Harness用的库则自然落到各自懒加载 chunk。
              return
            }
          },
        },
      },
    },
  }
})

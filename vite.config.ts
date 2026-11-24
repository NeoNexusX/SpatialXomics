import { fileURLToPath, URL } from 'node:url'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'

import { loadEnv, type Plugin } from 'vite'
import type { ConfigEnv, Connect, UserConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite';
import vueI18n from '@intlify/unplugin-vue-i18n/vite'
import { parseFrontmatter, parseMarkdown } from 'comark/parse'
import { rewriteHmdbArchiveLocation, rewriteHmdbArchivePath } from './src/features/agent/plugins/tool-knowledge/hmdbRelay'
import breaks from 'comark/plugins/breaks'
import frontmatter from 'comark/plugins/frontmatter'
import html from 'comark/plugins/html'
import taskList from 'comark/plugins/task-list'
import cjkFriendly from 'markdown-it-cjk-friendly'

/**
 * 启动时探测本地代理是否真的在转发：端口在监听不代表能用——Clash 关掉系统代理后
 * 进程还在、端口还开着，但 CONNECT 任何目标都握不上手（2026-11-23 实测）。
 * 探测通过才用代理，否则直连，开关代理都不必改 env、不必重启 vite。
 */
function probeHmdbProxy(proxyUrl: string, targetHost: string): Promise<boolean> {
  const proxy = new URL(proxyUrl)
  if (proxy.protocol !== 'http:') throw new Error('VITE_HMDB_PROXY_URL must use an HTTP proxy URL')
  const port = Number(proxy.port || 80)
  const connectTimeoutMs = 5_000
  return new Promise((resolve) => {
    const socket = net.connect({ host: proxy.hostname, port })
    let headers = Buffer.alloc(0)
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(ok)
    }
    const timer = setTimeout(() => done(false), connectTimeoutMs)
    socket.once('error', () => done(false))
    socket.once('close', () => done(false))
    const onData = (chunk: Buffer) => {
      headers = Buffer.concat([headers, chunk])
      const end = headers.indexOf('\r\n\r\n')
      if (end < 0) return
      socket.off('data', onData)
      const status = /^HTTP\/\d\.\d\s+(\d{3})/.exec(headers.subarray(0, end).toString('latin1'))
      if (!status || Number(status[1]) !== 200) return done(false)
      // CONNECT 200 只说明代理接了隧道；再握手 TLS 才证明它真把流量转出去了
      const secureSocket = tls.connect({ socket, servername: targetHost })
      secureSocket.once('secureConnect', () => {
        secureSocket.destroy()
        done(true)
      })
      secureSocket.once('error', () => done(false))
    }
    socket.on('data', onData)
    socket.once('connect', () => {
      const auth = proxy.username
        ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}\r\n`
        : ''
      socket.write(`CONNECT ${targetHost}:443 HTTP/1.1\r\nHost: ${targetHost}:443\r\n${auth}\r\n`)
    })
  })
}

const HMDB_ARCHIVE_HOST = 'web.archive.org'

function localHmdbProxyAgent(proxyUrl: string): https.Agent {
  const proxy = new URL(proxyUrl)
  if (proxy.protocol !== 'http:') throw new Error('VITE_HMDB_PROXY_URL must use an HTTP proxy URL')
  const port = Number(proxy.port || 80)
  const connectTimeoutMs = 5_000
  return new (class extends https.Agent {
    override createConnection(
      options: https.RequestOptions,
      callback?: (error: Error | null, stream: tls.TLSSocket) => void,
    ): tls.TLSSocket | null | undefined {
      const socket = net.connect({ host: proxy.hostname, port })
      let settled = false
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.destroy()
        callback?.(error, null as unknown as tls.TLSSocket)
      }
      const timer = setTimeout(() => fail(new Error('Local HMDB proxy CONNECT timed out')), connectTimeoutMs)
      socket.once('error', fail)
      socket.once('connect', () => {
        const auth = proxy.username
          ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}\r\n`
          : ''
        socket.write(
          `CONNECT ${options.host}:${options.port} HTTP/1.1\r\nHost: ${options.host}:${options.port}\r\n${auth}Connection: keep-alive\r\n\r\n`,
        )
      })
      let headers = Buffer.alloc(0)
      const onData = (chunk: Buffer) => {
        headers = Buffer.concat([headers, chunk])
        const end = headers.indexOf('\r\n\r\n')
        if (end < 0) return
        socket.off('data', onData)
        const status = /^HTTP\/\d\.\d\s+(\d{3})/.exec(headers.subarray(0, end).toString('latin1'))
        if (!status || Number(status[1]) !== 200) {
          fail(new Error(`Local HMDB proxy rejected CONNECT (${status?.[1] ?? 'invalid response'})`))
          return
        }
        const remainder = headers.subarray(end + 4)
        if (remainder.length) socket.unshift(remainder)
        const secureSocket = tls.connect({
          socket: socket as tls.TLSSocket,
          servername: options.servername ?? options.host ?? undefined,
        })
        secureSocket.once('secureConnect', () => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          callback?.(null, secureSocket)
        })
        secureSocket.once('error', fail)
      }
      socket.on('data', onData)
      return undefined
    }
  })({ keepAlive: true })
}

/**
 * 动态（/news）的 Markdown 在构建时解析，浏览器只拿结果，不用下载解析器。
 * 文件是 src/features/news/content/<语言>/<YYYY-MM-DD-标识>.md：
 * - 带 ?meta 导入只得到 frontmatter 里的 title、summary，给列表页
 * - 直接导入得到整篇的 Comark 文档树，详情页用 MarkdownDocument 渲染
 * 插件和助手一样没开 components、attributes，原因见 markdownSyntax.ts。
 * 文件名或 frontmatter 不对时构建直接失败，并指出是哪个文件。
 */
const NEWS_PARSER = {
  registerDefaultPlugins: false,
  plugins: [frontmatter(), html(), taskList(), breaks(), { name: 'cjk-friendly', markdownItPlugins: [cjkFriendly] }],
}

function newsMarkdown(): Plugin {
  return {
    name: 'news-markdown',
    async transform(code, id) {
      const match = /\/features\/news\/content\/[^/]+\/([^/]+)\.md(\?meta)?$/.exec(id)
      if (!match) return
      const { title, summary } = parseFrontmatter(code).data
      if (!/^\d{4}-\d{2}-\d{2}-/.test(match[1]!) || !title || !summary) {
        this.error('动态的文件名要以 YYYY-MM-DD- 开头，frontmatter 要有 title 和 summary')
      }
      const value = match[2] ? { title, summary } : await parseMarkdown(code, NEWS_PARSER)
      return `export default ${JSON.stringify(value)}`
    },
  }
}

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
// 不套 defineConfig：它的同步重载不接受 Promise，async 工厂靠返回类型推断。
// 探测本地代理要等网络，所以工厂必须是 async 的。
export default async ({ mode }: ConfigEnv): Promise<UserConfig> => {
  // envDir 指向 env/ 目录，集中管理多环境 .env 文件
  const envDir = fileURLToPath(new URL('./env', import.meta.url))
  const env = loadEnv(mode, envDir, 'VITE_')
  const backendUrl = env.VITE_BACKEND_URL || 'http://localhost:8000'
  // 默认直连。本地代理是显式 opt-in（见 env/.env.development）：默认指向某个人的
  // Clash 端口会让所有人和 CI 每次启动都去 CONNECT 一个不存在的服务。
  const hmdbProxyUrl = env.VITE_HMDB_PROXY_URL || ''
  let hmdbProxyAgent: https.Agent | undefined
  if (hmdbProxyUrl) {
    const proxyAlive = await probeHmdbProxy(hmdbProxyUrl, HMDB_ARCHIVE_HOST)
    if (proxyAlive) {
      hmdbProxyAgent = localHmdbProxyAgent(hmdbProxyUrl)
      console.info(`[hmdb-archive] Wayback relay via proxy ${hmdbProxyUrl}`)
    } else {
      console.warn(
        `[hmdb-archive] proxy ${hmdbProxyUrl} is not forwarding; Wayback relay goes direct. ` +
          'HMDB lookups fail if web.archive.org is unreachable from this network.',
      )
    }
  }

  return {
    envDir: envDir,
    envPrefix: 'VITE_',
    plugins: [
      vue(),
      vueDevTools(),
      newsMarkdown(),
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
        // Keep Wayback XML server-side: archive responses have no CORS headers, and 2id_
        // redirects to an external host. Rewrite that redirect back through this same origin.
        '/hmdb-archive': {
          target: 'https://web.archive.org',
          agent: hmdbProxyAgent,
          changeOrigin: true,
          rewrite: rewriteHmdbArchivePath,
          // Reject invalid requests locally (mirrors llmRelayPlugin's 400) and
          // rewrite the 2id_ redirect back to this origin with ?snapshot=.
          // The Location check stays case-sensitive on purpose: nginx's
          // proxy_redirect regex below is the production counterpart and is
          // also case-sensitive — keep the two relays diagnosing identically.
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq, req, res) => {
              if (req.url?.includes('__invalid_hmdb_archive_request__')) {
                // Answer invalid requests locally (same posture as
                // llmRelayPlugin's 400) — never spend an upstream round trip
                // on a garbage path.
                proxyReq.destroy()
                if (!res.headersSent) {
                  res.writeHead(400, { 'Content-Type': 'application/json' })
                  res.end(
                    JSON.stringify({
                      error: { message: 'invalid /hmdb-archive request: expected /hmdb-archive/HMDB######.xml' },
                    }),
                  )
                }
              }
            })
            proxy.on('proxyRes', (proxyRes) => {
              const location = proxyRes.headers.location
              if (proxyRes.statusCode !== 301 && proxyRes.statusCode !== 302) return
              // Wayback answers 2id_ redirects with BOTH http and https, and
              // canonicalises the host to www.hmdb.ca (seen 2026-11-11):
              // https://web.archive.org/web/<ts>id_/https://www.hmdb.ca/metabolites/HMDB0007861.xml
              // An exact-scheme/host regex turned every such capture into a 502.
              const rewritten = rewriteHmdbArchiveLocation(location)
              if (rewritten) {
                proxyRes.headers.location = rewritten
              } else {
                proxyRes.statusCode = 502
                delete proxyRes.headers.location
                console.warn('[hmdb-archive] rejected unexpected Wayback redirect', location)
              }
            })
          },
        },
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
}

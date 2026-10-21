/**
 * 谱库搜索工具（离线 MassBank 子集，只读）。
 *
 * 数据源：MassBank（https://massbank.eu，Horai et al. J Mass Spectrom 2010）
 * 的实测 MS/MS 参考谱。新版 REST 无公开文档、GNPS 库接口无 CORS 头——
 * 浏览器无法直连，故照 LIPID MAPS 先例离线化：scripts/build-massbank-index.mjs
 * 从 MassBank-data GitHub 仓库生成 public/data/massbank-index.json
 * （ESI ±/MALDI，前驱体 50–2000，每谱保留 top-30 峰）。
 *
 * 用途：阶段③的碎片证据——注释行给出 precursor m/z（+可选实测峰列表），
 * 与库内参考谱按前驱体质量 + 共有峰匹配，比自造规则表更有依据。
 *
 * 索引约 33MB（87k 条，gzip ~8.4MB）：下载与解析在 spectralIndex.worker.ts
 * 里做（主线程不冻结、解析对象常驻 worker 堆）；无 Worker API / worker 崩溃
 * 时闩锁降级为主线程懒加载（同 spectralIndexCore 的同一份检索逻辑）。
 */

import type { Context, Plugin } from 'cordis'
import { defineTool } from './defineTool'
import { createLazyJsonLoader } from './httpJson'
import {
  parsePeakList,
  searchSpectralIndex,
  spectralIndexNotFound,
  type SpectralLibEntry,
} from './spectralIndexCore'

// 纯函数与类型从核心模块再导出（既有导入方/测试不改动）
export { parsePeakList, matchedPeakCount } from './spectralIndexCore'
export type { SpectralLibEntry } from './spectralIndexCore'

// ---- worker RPC（生产路径） ----

interface SpectralWorkerResponse {
  type: 'result' | 'error'
  reqId: number
  text?: string
  message?: string
}

let searchWorker: Worker | null = null
/** worker 起不来（构造抛 / 脚本加载失败 / 运行时崩）后闩锁置位，后续调用
 *  全部走主线程兜底——不重试必死的构造（同注释模块的 engineClient） */
let workerBroken = false
let nextReqId = 0
const inflight = new Map<
  number,
  { resolve: (s: string) => void; reject: (e: Error) => void }
>()

function ensureWorker(): Worker | null {
  if (workerBroken) return null
  if (searchWorker) return searchWorker
  try {
    searchWorker = new Worker(new URL('./spectralIndex.worker.ts', import.meta.url), {
      type: 'module',
    })
  } catch {
    workerBroken = true
    return null
  }
  searchWorker.onmessage = (e: MessageEvent<SpectralWorkerResponse>) => {
    const msg = e.data
    const p = inflight.get(msg.reqId)
    if (!p) return
    inflight.delete(msg.reqId)
    if (msg.type === 'error') p.reject(new Error(msg.message || 'spectral index failed'))
    else p.resolve(msg.text ?? '')
  }
  searchWorker.onerror = () => {
    for (const [, p] of inflight) p.reject(new Error('spectral index worker crashed'))
    inflight.clear()
    searchWorker?.terminate()
    searchWorker = null
    workerBroken = true
  }
  return searchWorker
}

function workerSearch(
  precursorMz: number,
  tolerancePpm: number,
  polarity: 'positive' | 'negative' | null,
  peaks: { mz: number; intensity: number }[],
  max: number,
  signal?: AbortSignal,
): Promise<string> {
  const w = ensureWorker()
  if (!w) return Promise.reject(new Error('spectral index worker unavailable'))
  const reqId = ++nextReqId
  return new Promise<string>((resolve, reject) => {
    inflight.set(reqId, { resolve, reject })
    w.postMessage({ type: 'search', reqId, precursorMz, ppm: tolerancePpm, polarity, peaks, max })
    // 中止只放弃等待：worker 里的索引继续加载/缓存（terminate 会丢掉 33MB
    // 的解析成果），结果到达时无人监听即丢弃
    signal?.addEventListener(
      'abort',
      () => {
        if (inflight.delete(reqId)) reject(new Error('spectral_library_search aborted'))
      },
      { once: true },
    )
  })
}

// ---- 主线程兜底（无 Worker API / worker 崩溃闩锁后） ----

const loadSpectralIndex = createLazyJsonLoader<SpectralLibEntry[]>(
  'massbank-index.json',
  spectralIndexNotFound,
)

/**
 * 前驱体 ± ppm 检索谱库（工具入口）：worker 优先，降级主线程。
 */
export async function spectralLibrarySearch(
  precursorMz: number,
  tolerancePpm: number,
  polarity: 'positive' | 'negative' | null,
  peaks: { mz: number; intensity: number }[],
  max: number,
  signal?: AbortSignal,
): Promise<string> {
  if (ensureWorker()) {
    try {
      return await workerSearch(precursorMz, tolerancePpm, polarity, peaks, max, signal)
    } catch (err) {
      // worker 崩溃（onerror 闩锁已置位）→ 降级主线程重试一次；业务错误
      //（索引缺失 / 中止 / 网络失败）原样上抛，别在主线程再花一遍流量
      if (!workerBroken) throw err
    }
  }
  const index = await loadSpectralIndex(signal)
  return searchSpectralIndex(index, precursorMz, tolerancePpm, polarity, peaks, max)
}

// ---- 插件 ----

/** 谱库搜索插件。在 bootstrap 中：ctx.plugin(spectralTools) */
export const spectralTools: Plugin.Function<void> = (ctx: Context) => {
  ctx.tools.register(
    defineTool({
      name: 'spectral_library_search',
      category: 'spectral',
      // 首次调用 worker 要下载 ~33MB 索引（dev 裸传，生产 gzip ~8.4MB），15s
      // 默认超时在慢网络下必炸；下载完成后走 worker 内缓存，远低于该值。
      timeoutMs: 60_000,
      description:
        'Search reference MS/MS spectra (offline MassBank subset) by precursor m/z ± ppm. ' +
        'Optionally pass the measured peak list ("mz:intensity, ...") to rank candidates by shared ' +
        'fragment peaks — direct spectral evidence for an annotation. Returns compound, formula, ' +
        'ion mode, Δppm, matched-peak counts and record links.',
      parameters: {
        precursorMz: { type: 'number', required: true, description: 'Precursor (or annotated) m/z' },
        ppm: { type: 'integer', description: 'Precursor tolerance in ppm (default 20, max 200)' },
        polarity: { type: 'string', description: 'Filter by ion mode: "positive"/"negative"; omit for both' },
        peaks: {
          type: 'string',
          description: 'Measured MS/MS peaks as "mz:intensity" pairs separated by commas (optional)',
        },
      },
      async execute(args, exec) {
        const polarity =
          args.polarity === 'positive' || args.polarity === 'negative' ? args.polarity : null
        const peaks = args.peaks ? parsePeakList(args.peaks) : []
        return spectralLibrarySearch(
          args.precursorMz!,
          Math.min(Math.max(args.ppm ?? 20, 1), 200),
          polarity,
          peaks,
          10,
          exec.signal,
        )
      },
    }),
  )
}

// cordis 4：fiber 内访问兄弟服务（ctx.tools）必须声明 inject。
spectralTools.inject = ['tools']

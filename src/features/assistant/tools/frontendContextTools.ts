/**
 * 前端上下文工具集：从当前页面运行时数据读取统计摘要（全部只读）。
 *
 * 数据来源：
 * - services/zarr/zarrSharedState 的模块级共享状态（getSharedZarrContext / metadataAttrsRef）
 * - providers/analysisContext 的实例级 provider 注册表（selectedIon / kmeans / annotations）
 */

import type { Context, Plugin } from 'cordis'
import { defineTool, renderBatch } from './defineTool'
import {
  buildDatasetOverview,
  buildIonImageStats,
  buildMeanSpectrumTopPeaks,
  buildKmeansSummary,
  buildUmapSummary,
  buildPixelSpectrumPeaks,
  buildAnnotationTop,
  buildPageState,
  getAnnotationRows,
  getAnnotationWeights,
} from '../providers/analysisContext'
import { DEFAULT_TOP_N, MAX_TOP_N, MAX_BATCH_QUERIES } from '../agentconfig/defaults'
import type {
  DatasetOverview,
  IonImageStats,
  UmapSummary,
  KmeansSummary,
  SpectrumPeak,
  AnnotationOrigin,
  AnnotationRow,
  AnnotationScoreWeights,
  PageState,
} from '../agenttypes/assistant'

/** 数值格式化：科学计数法（紧凑）；null/undefined → N/A */
function fmt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'N/A'
  if (v === 0) return '0'
  if (Math.abs(v) >= 1000 || Math.abs(v) < 0.01) return v.toExponential(3)
  return v.toFixed(4).replace(/\.?0+$/, '')
}

// ---- 各工具的 render 函数 ----

/** 渲染数据集概览（get_dataset_overview 工具与 system prompt 静态段共用） */
export function renderDataset(d: DatasetOverview): string {
  const lines = [`dataMode: ${d.dataMode}`, `dimensions: ${d.width} x ${d.height}`]
  if (d.rowAxis) lines.push(`rowAxis: ${d.rowAxis}`)
  if (d.name) lines.push(`sampleName: ${d.name}`)
  if (d.filename) lines.push(`filename: ${d.filename}`)
  if (d.pixelCount != null) lines.push(`pixelCount: ${d.pixelCount}`)
  if (d.pixelSizeHorizontal != null)
    lines.push(`pixelSize: ${d.pixelSizeHorizontal} x ${d.pixelSizeVertical ?? '?'} um`)
  if (d.mzMin != null)
    lines.push(`mzRange: ${fmt(d.mzMin)} - ${fmt(d.mzMax)} (${d.mzCount} points)`)
  if (d.analyzer) lines.push(`analyzer: ${d.analyzer}`)
  if (d.ionisationSource) lines.push(`ionSource: ${d.ionisationSource}`)
  if (d.polarity) lines.push(`polarity: ${d.polarity}`)
  return lines.join('\n')
}

function renderIonImage(i: IonImageStats): string {
  const hot = i.hotspots.map((h) => `  (${h.x},${h.y})=${fmt(h.intensity)}`).join('\n')
  return [
    `mz: ${fmt(i.mz)} +/- ${i.tolerance}`,
    `max: ${fmt(i.max)}, mean: ${fmt(i.mean)}, min: ${fmt(i.min)}`,
    `nonzeroRatio: ${(i.nonzeroRatio * 100).toFixed(1)}%`,
    `p50: ${fmt(i.p50)}, p90: ${fmt(i.p90)}, p99: ${fmt(i.p99)}`,
    hot ? `hotspots:\n${hot}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function renderPeaks(peaks: SpectrumPeak[]): string {
  if (peaks.length === 0)
    return 'No spectrum data available (not in continuous mode, or not loaded).'
  return peaks.map((p, i) => `${i + 1}. mz=${fmt(p.mz)} intensity=${fmt(p.intensity)}`).join('\n')
}

function renderKmeans(k: KmeansSummary): string {
  const sizes = k.clusterSizes.map((n, i) => `  cluster ${i}: ${n} px`).join('\n')
  const sel =
    k.selectedIds.length > 0 ? `selected: [${k.selectedIds.join(', ')}]` : 'selected: none'
  return `k=${k.k}\n${sizes}\n${sel}`
}

/** 百分数（q 值） */
function pct(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? 'N/A' : `${(v * 100).toFixed(1)}%`
}

function ppm(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}ppm`
}

/** 注释面板的默认总分权重（provider 没给权重时用） */
const DEFAULT_ANNOTATION_WEIGHTS: AnnotationScoreWeights = { mass: 0.6, adduct: 0.1, spatial: 0.3 }

/** 权重系数：最多两位小数，去掉末尾的 0（0.7、0.05、0.33） */
function weightText(v: number): string {
  return String(Number(v.toFixed(2)))
}

/** 注释列表里的来源等级短写 */
const ORIGIN_TOKEN: Record<AnnotationOrigin, string> = {
  endogenous: 'endo',
  expected: 'expected',
  unknown: 'unknown',
  exogenous: 'exo',
}

function renderAnnotations(
  rows: AnnotationRow[],
  weights: AnnotationScoreWeights = DEFAULT_ANNOTATION_WEIGHTS,
): string {
  if (rows.length === 0) return 'No annotations in current context.'
  const header =
    `Top annotations by total score (${weightText(weights.mass)}×mass + ` +
    `${weightText(weights.adduct)}×adduct fit + ${weightText(weights.spatial)}×spatial, weights set ` +
    'by the user in the annotation conditions; spatial = 0.2×chaos + 0.8×same-molecule ' +
    'co-localization, unavailable co-localization counts as 0) with target-decoy FDR q-values. ' +
    'One row = one adduct ion; ions of the same molecule are separate rows (sib).'
  const body = rows.map((a) => {
    // name 截 32 字符：给证据 token 留预算（工具输出有 2000 字符截断）
    const name = a.name.length > 32 ? `${a.name.slice(0, 32)}…` : a.name
    const spatial =
      a.chaos != null
        ? ` ch=${a.chaos.toFixed(2)}${a.coloc != null ? ` col=${a.coloc.toFixed(2)}` : ''}`
        : ''
    const sib = a.siblings.length ? ` sib=${a.siblings.map((x) => x.adduct).join(',')}` : ''
    const shared = a.samePeak.length ? ` samePeak=${a.samePeak.length}` : ''
    // 未定不写，省字符
    const origin = a.origin && a.origin !== 'unknown' ? ` origin=${ORIGIN_TOKEN[a.origin]}` : ''
    return (
      `#${a.rank} ${name} ${a.adduct} mz=${a.obsMz.toFixed(4)} (${ppm(a.errPpm)}) ` +
      `s=${a.totalScore.toFixed(2)} q=${pct(a.q)} m=${a.massScore.toFixed(2)} ` +
      `fit=${a.adductFit.toFixed(1)}${spatial}${sib}${shared}${origin}`
    )
  })
  return [header, ...body].join('\n')
}

/** 单条注释的完整证据（get_annotation_detail 工具的渲染体） */
export function renderAnnotationDetail(a: AnnotationRow): string {
  const lines: string[] = []
  lines.push(`name: ${a.name}`)
  if (a.origin) {
    lines.push(
      `origin: ${a.origin} (provenance label from the annotation database; it only orders ` +
        'candidates, endogenous first, and is not spectral evidence)',
    )
  }
  if (a.candidates.length > 0) {
    const list = a.candidates.slice(0, 10).map((c) => {
      const tags = [c.id, c.origin].filter(Boolean).join(', ')
      return tags ? `${c.name} (${tags})` : c.name
    })
    lines.push(`candidates (${a.candidates.length}): ${list.join(' | ')}`)
  }
  lines.push(
    [
      `formula ${a.formula}`,
      `adduct ${a.adduct}`,
      `theoMz ${a.theoMz.toFixed(4)}`,
      `obsMz ${a.obsMz.toFixed(4)}`,
      `err ${ppm(a.errPpm)}`,
      a.intensity != null ? `intensity ${fmt(a.intensity)}` : '',
    ]
      .filter(Boolean)
      .join(' | '),
  )
  const spatialScore = a.spatialScore != null ? a.spatialScore.toFixed(3) : 'N/A'
  lines.push(
    `scores: total=${a.totalScore.toFixed(3)} (mass=${a.massScore.toFixed(3)} ` +
      `adductFit=${a.adductFit.toFixed(2)} spatial=${spatialScore}) q=${pct(a.q)} rank=${a.rank}`,
  )
  if (a.chaos != null) {
    const coloc =
      a.coloc != null ? ` coloc=${a.coloc.toFixed(3)} (best Pearson with same-molecule ions)` : ''
    lines.push(`spatial: chaos=${a.chaos.toFixed(3)}${coloc}`)
  } else {
    lines.push(
      'spatial: not scored (only the top-ranked ions and their same-molecule ions are scored)',
    )
  }
  if (a.siblings.length) {
    const sibs = a.siblings.map(
      (x) =>
        `${x.adduct} mz=${x.obsMz.toFixed(4)} rank=${x.rank}` +
        (x.r != null ? ` r=${x.r.toFixed(2)}` : ''),
    )
    lines.push(`same molecule: ${sibs.join('; ')}`)
  }
  if (a.missingAdducts.length) {
    lines.push(`enabled but not detected: ${a.missingAdducts.join(', ')}`)
  }
  if (a.samePeak.length) {
    const others = a.samePeak.map((x) => `${x.name} ${x.adduct}${x.origin ? ` (${x.origin})` : ''}`)
    lines.push(`same peak also explained by: ${others.join('; ')}`)
  }
  return lines.join('\n')
}

function renderUmap(u: UmapSummary): string {
  const lines: string[] = [`ready: ${u.ready}`, `overlayVisible: ${u.visible}`]
  if (u.computing)
    lines.push('computing: true (backend task still in progress, results may change)')
  if (u.error) lines.push(`error: ${u.error}`)
  lines.push(`grid: ${u.grid.width} x ${u.grid.height}`)
  // 提示模型解读语义：UMAP 颜色是 3 维 embedding 的 RGB 编码，非物理量
  lines.push(
    'note: colors encode a 3-D UMAP embedding (dimensionality-reduced spectra), spatially contiguous colors indicate spectrally similar regions.',
  )
  return lines.join('\n')
}

function renderPageState(s: PageState): string {
  const hasAnything =
    s.dataset ||
    s.selectedIon ||
    s.kmeans ||
    s.umap ||
    (s.annotationCount ?? 0) > 0 ||
    s.meanSpectrumAvailable
  if (!hasAnything) {
    return unavailable('Page state')
  }
  const lines: string[] = []
  if (s.dataset) lines.push(renderDataset(s.dataset))
  if (s.selectedIon)
    lines.push(`selected ion: mz=${fmt(s.selectedIon.mz)} +/- ${s.selectedIon.tolerance}`)
  if (s.kmeans)
    lines.push(
      `kmeans: k=${s.kmeans.k}, ${s.kmeans.clusterCount} clusters, ${s.kmeans.selectedCount} selected`,
    )
  if (s.umap)
    lines.push(`umap: ${s.umap.ready ? (s.umap.computing ? 'computing' : 'ready') : 'not loaded'}`)
  if (s.annotationCount != null) lines.push(`annotation matches: ${s.annotationCount}`)
  lines.push(`mean spectrum: ${s.meanSpectrumAvailable ? 'available' : 'not loaded'}`)
  return lines.join('\n')
}

/** guard：无数据时返回提示而不是抛错（模型可理解并告知用户） */
function unavailable(what: string): string {
  return `${what} is not available in the current page context. Ask the user to open a result detail page and select an ion / enable annotations.`
}

/**
 * 前端上下文工具插件。
 *
 * 在 bootstrap 中：ctx.plugin(frontendContextTools)
 * 工具依赖 ctx.tools 服务（providers/tools.ts 先加载）。
 */
export const frontendContextTools: Plugin.Function<void> = (ctx: Context) => {
  // 页面状态主入口：轻量、实时（直接字段，不做重统计），数据相关问题的第一步
  ctx.tools.register(
    defineTool({
      category: 'page',
      name: 'get_page_state',
      description:
        'Get the live state of the current page: dataset overview (dimensions, data mode, m/z range), currently selected ion, clustering summary, annotation match count. Lightweight and always current. Call this FIRST for any question about the loaded data, then use specialized get_* tools for detailed statistics.',
      parameters: {},
      async execute() {
        return renderPageState(buildPageState())
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      category: 'page',
      name: 'get_dataset_overview',
      description:
        'Get an overview of the currently loaded MSI dataset: dimensions, data mode, m/z range, instrument metadata. Note: static sample metadata is already in the system prompt (Dataset Context section) — use this only to verify or when the user asks about it explicitly.',
      parameters: {},
      async execute() {
        const d = buildDatasetOverview()
        return d ? renderDataset(d) : unavailable('Dataset overview')
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      category: 'page',
      name: 'get_ion_image_stats',
      description:
        'Get statistics of the currently selected ion image: m/z, tolerance, max/mean/min intensity, nonzero ratio, percentiles, hotspots.',
      parameters: {},
      async execute() {
        const i = buildIonImageStats()
        return i ? renderIonImage(i) : unavailable('Ion image statistics')
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      category: 'page',
      name: 'get_mean_spectrum_top_peaks',
      description: 'Get the top-N peaks of the mean spectrum (continuous mode only).',
      parameters: {
        topN: {
          type: 'integer',
          description: `Number of peaks to return (default ${DEFAULT_TOP_N}, max ${MAX_TOP_N})`,
        },
      },
      async execute(args) {
        const n = Math.min(Math.max(args.topN ?? DEFAULT_TOP_N, 1), MAX_TOP_N)
        return renderPeaks(buildMeanSpectrumTopPeaks(n))
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      category: 'page',
      name: 'get_kmeans_summary',
      description:
        'Get KMeans clustering summary: k, cluster sizes, currently selected cluster ids.',
      parameters: {},
      async execute() {
        const k = buildKmeansSummary()
        return k ? renderKmeans(k) : unavailable('KMeans clustering')
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      category: 'page',
      name: 'get_umap_summary',
      description:
        'Get the UMAP clustering overlay status: whether the UMAP zarr is loaded (ready), the backend task is still computing, any load error, the raster grid size, and whether the overlay currently shows on the ion image. Use before discussing UMAP dimensionality reduction or spatial clustering.',
      parameters: {},
      async execute() {
        const u = buildUmapSummary()
        return u ? renderUmap(u) : unavailable('UMAP clustering overlay')
      },
    }),
  )
  ctx.tools.register(
    defineTool({
      category: 'page',
      name: 'get_pixel_spectrum',
      description:
        'Get the top-N peaks of the currently loaded single-pixel spectrum (the spectrum shown in the spectrum panel when the user clicks a pixel of the ion image). Only the spectrum of the last-clicked pixel is kept in page state — if no pixel was clicked yet (or it is still loading), this returns that hint and the user should click a pixel first.',
      parameters: {
        topN: {
          type: 'integer',
          description: `Number of peaks to return (default ${DEFAULT_TOP_N}, max ${MAX_TOP_N})`,
        },
      },
      async execute(args) {
        const n = Math.min(Math.max(args.topN ?? DEFAULT_TOP_N, 1), MAX_TOP_N)
        const ps = buildPixelSpectrumPeaks(n)
        if (!ps) {
          return 'No single-pixel spectrum loaded yet. Ask the user to click a pixel on the ion image, then call this again.'
        }
        const header = `pixel #${ps.pixel.index} (x=${ps.pixel.x}, y=${ps.pixel.y}) top peaks:`
        return [header, renderPeaks(ps.peaks)].join('\n')
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      category: 'page',
      name: 'get_annotation_top',
      description:
        'Get the top annotations ranked by total score (mass error + adduct fit + spatial chaos with ' +
        'same-molecule co-localization) with target-decoy FDR q-values. One row = one adduct ion. ' +
        'Tokens: s=total q=FDR m=mass fit=adduct fit ch=chaos col=co-localization sib=other adducts ' +
        'of the same molecule samePeak=other annotations on the same peak ' +
        'origin=provenance label of the named compound from the database (endo / expected / exo; ' +
        'exo means every candidate is exogenous), a prior that orders candidates, not evidence.',
      parameters: {
        topN: {
          type: 'integer',
          description: `Number of matches to return (default ${DEFAULT_TOP_N}, max ${MAX_TOP_N})`,
        },
      },
      async execute(args) {
        const n = Math.min(Math.max(args.topN ?? DEFAULT_TOP_N, 1), MAX_TOP_N)
        return renderAnnotations(buildAnnotationTop(n), getAnnotationWeights() ?? undefined)
      },
    }),
  )

  // 单条注释的完整证据：get_annotation_top 为省字符做了精简（紧凑 token），
  // 模型深挖某一行（复核可信度/写报告）时用本工具拿全字段。
  // mzs/rowIds 支持批量：一次调取多行详情（annotation-review 的 step 3 常要
  // 深查多行，逐行调用是工具调用次数膨胀的主要来源）
  ctx.tools.register(
    defineTool({
      category: 'page',
      name: 'get_annotation_detail',
      description:
        'Get the FULL evidence for annotation rows (get_annotation_top abbreviates): score ' +
        'breakdown, chaos and co-localization, the other adduct ions of the same molecule with ' +
        'their Pearson r, enabled adducts that were not detected, other annotations on the same ' +
        'peak, and all candidate names. Identify rows by rowId, or by observed m/z (the ' +
        'best-ranked row on the closest peak is returned). BATCHING: pass "mzs" or "rowIds" ' +
        '(arrays) to fetch several rows in ONE call instead of one call per row.',
      parameters: {
        mz: { type: 'number', description: 'Observed m/z of the row (from get_annotation_top)' },
        mzs: {
          type: 'array',
          items: 'number',
          maxItems: MAX_BATCH_QUERIES,
          description: 'Batch form of "mz": many m/z values in one call',
        },
        rowId: { type: 'integer', description: 'Row id if known (takes precedence over mz)' },
        rowIds: {
          type: 'array',
          items: 'integer',
          maxItems: MAX_BATCH_QUERIES,
          description: 'Batch form of "rowId": many row ids in one call',
        },
      },
      async execute(args) {
        const rows = getAnnotationRows()
        if (!rows || rows.length === 0) return unavailable('Annotation data')

        // rowId 批（若有）；否则 mz 批（含单值）；两者都没给 → 报错
        const rowIdList = args.rowIds ?? (args.rowId != null ? [args.rowId] : [])
        const mzList = args.mzs ?? (args.mz != null ? [args.mz] : [])
        if (rowIdList.length === 0 && mzList.length === 0) {
          throw new Error('Provide "mz"/"mzs" or "rowId"/"rowIds" to identify the annotation row(s)')
        }

        // 单行定位（保留原语义：rowId 精确；mz 取 0.5 Da 内最近峰中排名最高的行）
        const findByRowId = (id: number): AnnotationRow | undefined => rows.find((r) => r.id === id)
        const findByMz = (mz: number): AnnotationRow | undefined => {
          const dist = (r: AnnotationRow) => Math.abs(r.obsMz - mz)
          const minD = rows.reduce((m, r) => Math.min(m, dist(r)), Infinity)
          if (minD > 0.5) return undefined
          return rows
            .filter((r) => dist(r) - minD <= 1e-9)
            .reduce((best, r) => (r.rank < best.rank ? r : best))
        }
        const renderRow = (rowId: number | undefined, mz: number | undefined) => {
          const row = rowId != null ? findByRowId(rowId) : findByMz(mz!)
          if (!row) {
            return rowId != null
              ? `No annotation row with rowId ${rowId}. Call get_annotation_top to list valid rows.`
              : `No annotation row matched near m/z ${mz}. Call get_annotation_top to list valid rows.`
          }
          return renderAnnotationDetail(row)
        }

        const idPart =
          rowIdList.length > 0
            ? await renderBatch(
                rowIdList,
                (id) => `rowId ${id}`,
                (id) => renderRow(id, undefined),
              )
            : ''
        const mzPart =
          mzList.length > 0
            ? await renderBatch(
                mzList,
                (mz) => `m/z ${mz}`,
                (mz) => renderRow(undefined, mz),
              )
            : ''
        return [idPart, mzPart].filter(Boolean).join('\n\n')
      },
    }),
  )

  // ---- skill 工具 ----
  ctx.tools.register(
    defineTool({
      category: 'system',
      name: 'skill',
      // SKILL.md 全文 3k-10k 字符（msi-analysis ~10k）：是完整工作流文档，必须
      // 整体可见——截到默认 2000 会让工作流后半段（生物化学工具编排/通路发现）
      // 和输出模板永远读不到（此前已发生：模型反复加载拿到同一份半截文档）
      maxResultChars: 12_000,
      description:
        'Load a domain skill by name to get detailed analysis instructions. Available skill names are listed in the system prompt.',
      parameters: {
        name: { type: 'string', required: true, description: 'Skill name from the catalog' },
      },
      async execute(args) {
        return await ctx.skills.load(args.name!)
      },
    }),
  )
}

// cordis 4：fiber 内访问兄弟服务（ctx.tools / ctx.skills）必须声明 inject，
// 否则 fiber 静默失败、工具一个都注册不上（机制同 agentLoopProvider 的 ctx.inject 包裹）。
frontendContextTools.inject = ['tools', 'skills']

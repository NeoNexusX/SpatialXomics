/**
 * 前端上下文工具集：从当前页面运行时数据读取整体结构与统计（全部只读）。
 *
 * 数据来源：
 * - services/zarr/zarrSharedState 的模块级共享状态（getSharedZarrContext / metadataAttrsRef）
 * - bridge/analysisContext 的实例级 provider 注册表（selectedIon / kmeans / annotations / datasetInfo）
 *
 * 排名窗口契约（决策 7）：get_annotation 与两个谱峰工具都支持零基 offset/limit 任意窗口，
 * 默认窗口 rank 1–10，offset 可达任意 rank（rank 20–30 = offset 19 + limit 11），
 * 绝不能先截前 N 再分页。get_page 固定只嵌入注释 rank 1–10 作为页面预览。
 */

import type { Context } from '@deepseek-ai/cordis'
import { store } from '@/services/zarr/zarrSharedState'
import {
  readIon,
  renderIonImages,
  renderOverlayImage,
  renderSpectrumPlot,
  type RenderOptions,
} from '../tool-ion-image'
import {
  defineTool,
  batchInput,
  EVIDENCE_BATCH_BUDGET,
  renderBatch,
  TOOL_RESULT_CHARS_EVIDENCE,
  MAX_BATCH_QUERIES,
} from '../tools'
import { fmt, renderDataset } from '../../bridge/renderDataset'
import {
  buildDatasetOverview,
  buildIonImageStats,
  buildIonState,
  buildKmeansState,
  buildUmapState,
  buildDatasetState,
  buildPageHeader,
  getKmeansOverlayData,
  getUmapOverlayData,
  buildMeanSpectrumPeakWindow,
  buildPixelSpectrumPeakWindow,
  buildPixelSpectrumAllPeaks,
  getLoadedPixelSpectrum,
  getAnnotationWindow,
  getAnnotationPanelState,
  getAnnotationRows,
  hasAnnotationContext,
} from '../../bridge/analysisContext'
import { resolveRankWindow, rankWindowMeta } from '../../bridge/analysisTypes'
import type { AnnotationRow, SpectrumPeak } from '../../bridge/analysisTypes'

function renderPeaks(peaks: SpectrumPeak[]): string {
  if (peaks.length === 0)
    return 'No spectrum data available (not in continuous mode, or not loaded).'
  return peaks.map((p, i) => `${i + 1}. mz=${fmt(p.mz)} intensity=${fmt(p.intensity)}`).join('\n')
}

/** guard：无数据时返回提示而不是抛错（模型可理解并告知用户） */
function unavailable(what: string): string {
  return `${what} is not available in the current page context. Ask the user to open a result detail page and select an ion / enable annotations.`
}

function jsonSafeValue(value: unknown): unknown {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol')
    return null
  if (Array.isArray(value)) return value.map(jsonSafeValue)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) out[key] = jsonSafeValue(item)
    }
    return out
  }
  return null
}

/** Deterministically reduce oversized JSON without ever breaking its syntax. */
function budgetJson(value: unknown, limit: number): string {
  const safe = jsonSafeValue(value)
  const root =
    safe && typeof safe === 'object' && !Array.isArray(safe)
      ? (safe as Record<string, unknown>)
      : { value: safe }
  if (JSON.stringify(root).length <= limit) return JSON.stringify(root)

  root.truncated = true
  root.omitted = []
  let omittedCount = 0
  const note = (path: string) => {
    omittedCount++
    if ((root.omitted as string[]).length < 8) (root.omitted as string[]).push(path)
  }

  // Each top-level data child is serialized once and cached; only the child we
  // just mutated is re-serialized, and arrays are cut proportionally instead of
  // one element per pass. The previous pop-one-element loop re-stringified the
  // whole root every iteration — O(n²), which froze the tab on zarr attrs with
  // large array fields.
  const META_KEYS = new Set(['truncated', 'omitted', 'omittedCount'])
  const cached = new Map<string, string>()
  const serialized = (key: string): string => {
    let json = cached.get(key)
    if (json === undefined) {
      json = JSON.stringify(root[key]) ?? 'null'
      cached.set(key, json)
    }
    return json
  }
  const assemble = (): string => {
    root.omittedCount = omittedCount
    let out = '{'
    let first = true
    for (const key of Object.keys(root)) {
      const json = META_KEYS.has(key) ? JSON.stringify(root[key]) : serialized(key)
      if (json === undefined) continue
      out += (first ? '' : ',') + JSON.stringify(key) + ':' + json
      first = false
    }
    return out + '}'
  }
  /** Cut one item in place; undefined means "drop this child entirely". */
  const shrink = (item: unknown, path: string): unknown => {
    if (typeof item === 'string') {
      if (item.length <= 24) return undefined
      note(path)
      return item.slice(0, Math.max(8, Math.floor(item.length / 2))) + '…[omitted]'
    }
    if (Array.isArray(item)) {
      if (!item.length) return undefined
      // Estimate a cut that lands under the limit assuming roughly uniform
      // per-element cost; always drop at least one element so the loop ends.
      const size = JSON.stringify(item).length
      const overshoot = assemble().length - limit
      const perElement = Math.max(1, size / item.length)
      const drop = Math.min(item.length, Math.max(1, Math.ceil((overshoot + 64) / perElement)))
      const kept = item.length - drop
      note(`${path}[${kept}]`)
      return item.slice(0, kept)
    }
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>
      const [key, child] =
        Object.entries(record).sort(
          ([, a], [, b]) => JSON.stringify(b).length - JSON.stringify(a).length,
        )[0] ?? []
      if (key === undefined) return undefined
      const reduced = shrink(child, `${path}.${key}`)
      if (reduced === undefined) {
        delete record[key]
        note(`${path}.${key}`)
      } else record[key] = reduced
      return record
    }
    return undefined
  }

  let passes = 0
  while (assemble().length > limit) {
    const [key] =
      Object.keys(root)
        .filter((key) => !META_KEYS.has(key))
        .map((key) => [key, serialized(key).length] as const)
        .sort((a, b) => b[1] - a[1])[0] ?? []
    if (key === undefined) break
    const reduced = shrink(root[key], key)
    if (reduced === undefined) {
      delete root[key]
      note(key)
    } else root[key] = reduced
    cached.delete(key)
    // Strings halve and arrays cut proportionally, so real inputs converge in
    // a handful of passes; the cap only guards against a pathological loop.
    if (++passes > 200) break
  }
  const out = assemble()
  if (out.length > limit) {
    const minimal = JSON.stringify({ truncated: true, omittedCount: omittedCount || 1 })
    return minimal.length <= limit ? minimal : '{}'
  }
  return out
}

function fitAnnotationRow(
  row: AnnotationRow,
): AnnotationRow & { truncated: true; omitted: string[] } {
  return {
    id: row.id,
    rank: row.rank,
    name: row.name.slice(0, 100),
    origin: row.origin,
    candidates: [],
    formula: row.formula.slice(0, 64),
    adduct: row.adduct.slice(0, 64),
    theoMz: row.theoMz,
    obsMz: row.obsMz,
    errPpm: row.errPpm,
    intensity: row.intensity,
    massScore: row.massScore,
    adductFit: row.adductFit,
    chaos: row.chaos,
    coloc: row.coloc,
    spatialScore: row.spatialScore,
    totalScore: row.totalScore,
    q: row.q,
    siblings: [],
    samePeak: [],
    missingAdducts: [],
    truncated: true,
    omitted: ['candidates', 'siblings', 'samePeak', 'missingAdducts'],
  }
}

/**
 * get_page 注释预览的字符子预算：header/dataset/ion 共用同一总预算（TOOL_RESULT_CHARS_EVIDENCE），
 * 预览若占满总预算会迫使外层 budgetJson 弹掉预览行。给预览一个独立子预算，
 * 让组合结果通常无需外层截断；万一仍截断，get_page 会以实际返回行数重写分页游标。
 */
const PAGE_PREVIEW_ANNOTATION_BUDGET = 6000

/** Build a bounded annotation page and keep the cursor aligned with returned rows. */
function annotationPage(
  offset: number,
  limit: number,
  budget = TOOL_RESULT_CHARS_EVIDENCE - 32,
): { json: string } | undefined {
  const window = getAnnotationWindow(offset, limit)
  if (!window) return undefined
  const max = budget
  const originalPanel = getAnnotationPanelState()
  const panelLimit = Math.min(max - 512, Math.max(128, Math.floor(max / 4)))
  let panel: unknown = originalPanel
  let truncated = false
  if (JSON.stringify(panel ?? {}).length > panelLimit) {
    panel = JSON.parse(budgetJson(panel ?? {}, panelLimit))
    truncated = true
  }

  const rows: (AnnotationRow | (AnnotationRow & { truncated: true; omitted: string[] }))[] = []
  for (const row of window.rows) {
    const candidateRows = [...rows, row]
    const paging = rankWindowMeta(window.window.total, offset, limit, candidateRows.length)
    const candidate = {
      panel,
      paging,
      rows: candidateRows,
      ...(truncated ? { truncated: true } : {}),
    }
    if (JSON.stringify(candidate).length <= max) {
      rows.push(row)
      continue
    }
    if (rows.length === 0) {
      rows.push(fitAnnotationRow(row))
      truncated = true
    }
    break
  }

  const omittedRows = window.rows.length - rows.length
  const result = {
    panel,
    paging: rankWindowMeta(window.window.total, offset, limit, rows.length),
    rows,
    ...(truncated || omittedRows > 0 ? { truncated: true } : {}),
    ...(omittedRows > 0 ? { omittedRows } : {}),
  }
  let json = JSON.stringify(result)
  if (json.length > max) {
    // Keep the row identity/page cursor and sacrifice panel details before rows.
    const first = rows[0]
    const minimal = {
      panel: null,
      paging: rankWindowMeta(window.window.total, offset, limit, first ? 1 : 0),
      rows: first ? [fitAnnotationRow(first)] : [],
      truncated: true,
      omitted: [
        'panel details',
        ...(window.rows.length > (first ? 1 : 0) ? ['additional rows'] : []),
      ],
    }
    json = JSON.stringify(minimal)
  }
  return {
    json:
      json.length <= max
        ? json
        : JSON.stringify({
            paging: rankWindowMeta(window.window.total, offset, limit, 0),
            rows: [],
            truncated: true,
          }),
  }
}

/** 注释行文本渲染（get_annotation 精确 rowIds/mzs 模式沿用 detail 批量语义） */
export function renderAnnotationDetail(a: AnnotationRow): string {
  const lines: string[] = []
  lines.push(`rowId: ${a.id}`)
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
      `err ${a.errPpm >= 0 ? '+' : ''}${a.errPpm.toFixed(1)}ppm`,
      a.intensity != null ? `intensity ${fmt(a.intensity)}` : '',
    ]
      .filter(Boolean)
      .join(' | '),
  )
  const spatialScore = a.spatialScore != null ? a.spatialScore.toFixed(3) : 'N/A'
  lines.push(
    `scores: total=${a.totalScore.toFixed(3)} (mass=${a.massScore.toFixed(3)} ` +
      `adductFit=${a.adductFit.toFixed(2)} spatial=${spatialScore}) q=${a.q != null ? a.q.toFixed(3) : 'N/A'} rank=${a.rank}`,
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

export const name = 'tool-page-context'
export const inject = ['tools']

export function apply(ctx: Context) {
  /**
   * get_page —— 当前页面完整实时状态（决策 1）。
   *
   * 作用：一次性返回整页 JSON 快照（provider 为实时值）：header（数据集名/处理状态）、
   * dataset 信息面板、选中离子视图（显示参数/谱区/通道/ROI/统计）、KMeans/UMAP 就绪
   * 状态、注释面板头 + 固定 rank 1–10 预览（预览用独立子预算 PAGE_PREVIEW_ANNOTATION_
   * BUDGET，不与 header/dataset/ion 抢总预算）。预览之外的注释行走
   * get_annotation(offset/limit)。默认图像目标 = 提问时（turn/start 绑定）捕获的离子，
   * 不受 turn 中途切换选择影响；外层预算截断弹掉预览行时会以实际返回行数重写分页游标。
   *
   * 参数：
   * - withImage (boolean, 可选)：附带当前离子图像，默认 true；仅文本足够时传 false
   */
  ctx.tools.register(
    defineTool({
      category: 'page',
      name: 'get_page',
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      description:
        'Get a live JSON snapshot of the current workbench page when you need overall context or need to ' +
        'check whether the dataset, selected ion, clustering and annotations are ready. Reads the page ' +
        'header (dataset name, processing status), dataset info panel, selected-ion view, KMeans/UMAP ' +
        'readiness, and an annotation preview covering rank 1–10 only. For more annotation rows call ' +
        'get_annotation(offset, limit). With withImage (default true) it attaches the ion captured at ' +
        'question time; the snapshot reflects call time, not a live subscription.',
      parameters: {
        withImage: {
          type: 'boolean',
          description:
            'Attach the ion image captured at question time (default true); set false when text-only state is enough.',
        },
      },
      timeoutMs: 60000,
      async execute(args, exec) {
        const header = buildPageHeader()
        const dataset = buildDatasetState()
        const ion = buildIonState()
        const kmeans = buildKmeansState()
        const umap = buildUmapState()
        // 预览用独立子预算，不与 header/dataset/ion 抢总预算
        const preview = annotationPage(0, 10, PAGE_PREVIEW_ANNOTATION_BUDGET)
        const overview = buildDatasetOverview()

        const page: Record<string, unknown> = {
          header: header ?? { datasetName: overview?.name ?? '', status: '' },
          dataset:
            dataset ??
            (overview
              ? {
                  attrs: {},
                  acquisition: {},
                  sourceFile: null,
                  methods: [],
                  displayRange: null,
                  imageInfo: { pixels: null, nonZero: null, totalIon: null, pixelSize: null },
                }
              : null),
          kmeans: kmeans
            ? { ready: kmeans.labelsAvailable, k: kmeans.k, computing: kmeans.computing }
            : null,
          umap: umap ? { ready: umap.ready, computing: umap.computing, error: umap.error } : null,
          annotation: preview ? JSON.parse(preview.json) : null,
        }
        if (ion) {
          const { view, ...raster } = ion
          page.ion = { ...view, width: raster.width, height: raster.height }
        }

        let images: import('../llm').ToolImage[] | undefined
        const turn = [...(exec.session?.events ?? [])]
          .reverse()
          .find((event) => event.type === 'turn/start')
        const captured = turn?.type === 'turn/start' ? turn.binding.page.selectedIon : undefined
        if (captured) page.imageTarget = { ...captured, source: 'turn-start' }
        if (args.withImage !== false && captured) {
          try {
            const targetMz = captured.mz > 0 ? captured.mz : undefined
            const raster = await readIon(
              targetMz,
              targetMz == null ? undefined : captured.tolerance,
              exec.signal,
            )
            const display = ion?.view.display
            const options: RenderOptions = {
              colormap: display?.colormap || 'viridis',
              scale: display?.intensityScale || 'linear',
              gamma: display?.gamma || 1,
              display: 'p1p95',
              normalize: 'per-image',
              layout: 'separate',
              columns: 1,
              width: 384,
              range:
                display && display.displayMax > display.displayMin
                  ? [display.displayMin, display.displayMax]
                  : undefined,
            }
            images = renderIonImages(
              [
                {
                  ...raster,
                  label:
                    targetMz == null ? 'turn-start TIC' : `turn-start ion m/z ${fmt(targetMz)}`,
                },
              ],
              options,
            ).images
          } catch {
            // 无可用图时省略 images 字段（不返回空数组）
          }
        }
        const budgeted = JSON.parse(budgetJson(page, TOOL_RESULT_CHARS_EVIDENCE)) as Record<
          string,
          unknown
        >
        // 防御：外层预算截断若弹掉了预览行，分页游标必须与实际行数一致，
        // 否则 nextOffset 会跳过被弹掉的 rank。截断发生在行尾，前缀保持连续。
        const annotation = budgeted.annotation as {
          rows?: unknown[]
          paging?: { total: number; offset: number; limit: number; returned: number }
          truncated?: boolean
        } | null
        if (
          annotation?.rows &&
          annotation.paging &&
          annotation.paging.returned !== annotation.rows.length
        ) {
          annotation.paging = rankWindowMeta(
            annotation.paging.total,
            annotation.paging.offset,
            annotation.paging.limit,
            annotation.rows.length,
          )
          annotation.truncated = true
        }
        return { page: budgeted, ...(images?.length ? { images } : {}) }
      },
      output: {
        render: (_args, value) => JSON.stringify(value.page),
        images: (_args, value) => value.images,
      },
    }),
  )

  /**
   * get_dataset —— 右侧数据集信息面板整体（JSON）。
   *
   * 作用：zarr attrs（全键透传，后端新字段自动纳入）、采集元数据、源文件记录（剔除
   * 技术/注册字段）、前处理方法、显示范围与图像统计。处理状态不在本工具（在
   * get_page.header）。datasetInfo provider 未注册（非 VizWorkbench 页面/测试桩）时
   * 回退 zarr 概览文本，两者皆无则返回 unavailable 引导语。
   *
   * 参数：无
   */
  ctx.tools.register(
    defineTool({
      category: 'page',
      name: 'get_dataset',
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      description:
        'Read the dataset info panel as JSON when the user asks about acquisition settings, source file, ' +
        'preprocessing or image statistics. Zarr attrs pass through as-is, so new backend fields appear ' +
        'automatically; the source-file record omits technical/registration fields. Processing status is ' +
        "NOT here — get it from get_page's header.",
      parameters: {},
      async execute() {
        const d = buildDatasetState()
        if (d) return budgetJson(d, TOOL_RESULT_CHARS_EVIDENCE)
        // datasetInfo provider 未注册（非 VizWorkbench 页面/测试桩）时退回 zarr 概览
        const overview = buildDatasetOverview()
        return overview ? renderDataset(overview) : unavailable('Dataset info')
      },
    }),
  )

  /**
   * get_ion —— 选中离子完整视图（JSON）+ 按当前显示参数重渲染的离子图。
   *
   * 作用：显示参数（colormap/强度标度/gamma/显示范围）、谱区（均值/像素视图与选中
   * 像素）、多离子通道列表（叠加激活时页面 colormap/范围输入置灰）、ROI 与导入 mask
   * 计数、强度统计。附图是按当前显示参数重渲染的栅格而非画布截图——ROI 高亮、通道
   * 混合、KMeans/UMAP 叠加不在图中；processed 数据 provider 为 null 时回退 TIC。
   * 任意 m/z 查询用 get_ion_image。
   *
   * 参数：
   * - withImage (boolean, 可选)：附带重渲染的离子图，默认 true
   */
  ctx.tools.register(
    defineTool({
      category: 'page',
      name: 'get_ion',
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      description:
        'Read the selected-ion view as JSON when the user asks about its display parameters, spectrum area, ' +
        'ROI counts, multi-ion channels or intensity statistics. With withImage (default true) attaches the ' +
        'ion raster re-rendered with the CURRENT display parameters (including range) — not a canvas ' +
        'screenshot: ROI highlights, channel blending and KMeans/UMAP overlays are absent. Processed data ' +
        'falls back to TIC. For arbitrary m/z images use get_ion_image.',
      parameters: {
        withImage: {
          type: 'boolean',
          description:
            'Attach the re-rendered ion image (default true); set false for state JSON only.',
        },
      },
      timeoutMs: 60000,
      async execute(args, exec) {
        let ion = buildIonState()
        // processed 模式 provider 为 null：回退 TIC（方案步骤 5）
        if (!ion) {
          const tic = await readIon(undefined, undefined, exec.signal)
          const stats = buildIonImageStats(tic)
          ion = {
            view: {
              mz: 0,
              tolerance: 0,
              dataMode: 'processed',
              display: {
                colormap: '',
                intensityScale: '',
                gamma: 1,
                displayMin: 0,
                displayMax: 0,
                globalMin: 0,
                globalMax: 0,
              },
              spectrum: { view: 'mean', selectedPixel: null },
              roi: { confirmed: 0, selected: 0 },
              masks: { imported: 0 },
              stats,
            },
            matrix: tic.matrix,
            width: tic.width,
            height: tic.height,
          }
        }
        let images: import('../llm').ToolImage[] | undefined
        if (args.withImage !== false) {
          try {
            const raster = await readIon(
              ion.view.mz || undefined,
              ion.view.tolerance || undefined,
              exec.signal,
            )
            const options: RenderOptions = {
              colormap: ion.view.display.colormap || 'viridis',
              scale: ion.view.display.intensityScale || 'linear',
              gamma: ion.view.display.gamma || 1,
              display: 'p1p95',
              normalize: 'per-image',
              layout: 'separate',
              columns: 1,
              width: 384,
              range:
                ion.view.display.displayMax > ion.view.display.displayMin
                  ? [ion.view.display.displayMin, ion.view.display.displayMax]
                  : undefined,
            }
            images = renderIonImages(
              [
                {
                  ...raster,
                  // processed 回退（mz=0）取到的是 TIC，标签不能写成 m/z 0
                  label:
                    ion.view.mz > 0
                      ? `selected ion m/z ${fmt(ion.view.mz)}`
                      : 'TIC (processed-data fallback)',
                },
              ],
              options,
            ).images
          } catch {
            // 无可用图省略 images（审核约束 4）
          }
        }
        return { ion: ion.view, ...(images?.length ? { images } : {}) }
      },
      output: {
        render: (_args, value) => JSON.stringify(value.ion),
        images: (_args, value) => value.images,
      },
    }),
  )

  /**
   * get_annotation —— 注释面板状态头 + 注释行读取（决策 2/7）。
   *
   * 作用：窗口模式（默认）按稳定 rank 序对完整结果集零基 offset/limit 翻页，绝不先
   * 截前 N 再分页；窗口忽略表格筛选/排序，面板头另行报告当前筛选与可见行数。精确
   * 模式按 m/z（就近峰中 rank 最优行，距离阈值 0.5 Da）或 rowId 取完整行，与
   * offset/limit 互斥。一行 = 一个加合物离子；精确模式批量走 renderBatch，单项失败
   * 不拖垮整批。
   *
   * 参数：
   * - offset (integer, 可选)：窗口模式零基起点，默认 0、可达任意 rank
   * - limit (integer, 可选)：窗口大小，默认 10、页 cap 25（字符预算可能少给）
   * - mz / mzs (number / number[], 可选)：精确模式按观察 m/z 找行；mzs 批量（≤25）
   * - rowId / rowIds (integer / integer[], 可选)：精确模式按行 id 找行；rowIds 批量（≤25）
   */
  ctx.tools.register(
    defineTool({
      category: 'page',
      name: 'get_annotation',
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      description:
        'Read annotation rows from the current page. Window mode (default): offset/limit page through the ' +
        'FULL result set in stable rank order — zero-based, default offset 0 / limit 10, any rank reachable ' +
        "(rank 20–30 = offset 19 + limit 11); windowing ignores the panel's current filters/sorting, which " +
        'the panel header reports separately. Exact mode: mz/mzs (nearest peak, best-ranked row within ' +
        '0.5 Da) or rowId/rowIds fetch specific full rows; exact selectors conflict with offset/limit. One ' +
        'row = one adduct ion. The character budget may return fewer rows than limit — follow the returned ' +
        'paging/nextOffset.',
      parameters: {
        offset: {
          type: 'integer',
          description:
            'Zero-based window start into the full rank order (any rank; default 0). Window mode only.',
        },
        limit: {
          type: 'integer',
          description:
            'Window size, default 10, page cap 25; the character budget may return fewer.',
        },
        mz: {
          type: 'number',
          description: 'Observed m/z to locate the row (exact mode); choose one selector form.',
        },
        mzs: {
          type: 'array',
          items: 'number',
          maxItems: MAX_BATCH_QUERIES,
          description:
            'Batch observed m/z values (exact mode); each value independently resolves its nearest best-ranked row.',
        },
        rowId: { type: 'integer', description: 'Known annotation row id (exact mode).' },
        rowIds: {
          type: 'array',
          items: 'integer',
          maxItems: MAX_BATCH_QUERIES,
          description: 'Batch annotation row ids (exact mode); one full row each.',
        },
      },
      async execute(args, exec) {
        const exact =
          args.mz != null || args.mzs != null || args.rowId != null || args.rowIds != null
        const rows = exact ? getAnnotationRows() : undefined
        const windowed = args.offset != null || args.limit != null
        if (exact && windowed) {
          throw new Error(
            'offset/limit (rank window) and mz/mzs/rowId/rowIds (exact lookup) are mutually exclusive; pass one mode only',
          )
        }
        if (exact && !rows) return unavailable('Annotation data')
        if (!exact && !hasAnnotationContext()) return unavailable('Annotation data')

        if (exact) {
          const rowIdList = batchInput<number>(args.rowIds, args.rowId)
          const mzList = batchInput<number>(args.mzs, args.mz)
          if (rowIdList.length === 0 && mzList.length === 0) {
            throw new Error(
              'Provide "mz"/"mzs" or "rowId"/"rowIds" to identify the annotation row(s)',
            )
          }
          const findByRowId = (id: number): AnnotationRow | undefined =>
            rows!.find((r) => r.id === id)
          const findByMz = (mz: number): AnnotationRow | undefined => {
            const dist = (r: AnnotationRow) => Math.abs(r.obsMz - mz)
            const minD = rows!.reduce((m, r) => Math.min(m, dist(r)), Infinity)
            if (minD > 0.5) return undefined
            return rows!
              .filter((r) => dist(r) - minD <= 1e-9)
              .reduce((best, r) => (r.rank < best.rank ? r : best))
          }
          const renderRow = (rowId: number | undefined, mz: number | undefined) => {
            const row = rowId != null ? findByRowId(rowId) : findByMz(mz!)
            if (!row) {
              return rowId != null
                ? `No annotation row with rowId ${rowId}. Call get_annotation to list valid rows.`
                : `No annotation row matched near m/z ${mz}. Call get_annotation to list valid rows.`
            }
            return renderAnnotationDetail(row)
          }
          const items = [
            ...rowIdList.map((id) => ({ id, mz: undefined as number | undefined })),
            ...(rowIdList.length
              ? []
              : mzList.map((mz) => ({ id: undefined as number | undefined, mz }))),
          ]
          return renderBatch(
            items,
            (item) => (item.id != null ? `rowId ${item.id}` : `m/z ${item.mz}`),
            (item) => renderRow(item.id, item.mz),
            {
              ...args,
              ...EVIDENCE_BATCH_BUDGET,
              session: exec.session,
              signal: exec.signal,
            },
          )
        }

        const { offset, limit } = resolveRankWindow(args.offset, args.limit)
        const page = annotationPage(offset, limit)
        return page ? page.json : unavailable('Annotation data')
      },
    }),
  )

  /**
   * get_kmeans —— KMeans 聚类完整状态（JSON）+ 叠加图。
   *
   * 作用：k、簇颜色/像素数、选中簇、labels 是否可用、计算中状态、叠加可见性。附图
   * 为 KMeans 叠加 PNG：透明背景、未选中簇隐藏、最近邻放大（与导出按钮同一逻辑），
   * 带色图例（簇 id、像素数），图例只列可见簇（= 选中簇，与图像前景同一集合）。
   *
   * 参数：
   * - withImage (boolean, 可选)：附带叠加图，默认 true
   */
  ctx.tools.register(
    defineTool({
      category: 'page',
      name: 'get_kmeans',
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      description:
        'Read the KMeans clustering state when the user asks about clusters, selection or the overlay. ' +
        'Returns k, clusters with colors and pixel counts, selected ids, label availability, computing state ' +
        'and overlay visibility. With withImage (default true) attaches the overlay PNG with a color legend ' +
        '(cluster id, pixel count), transparent background, unselected clusters hidden, nearest-neighbor ' +
        'upscaled — same logic as the export button. Images may be omitted when labels or dimensions are ' +
        'unusable.',
      parameters: {
        withImage: {
          type: 'boolean',
          description:
            'Attach the KMeans overlay PNG (default true); false returns state JSON only.',
        },
      },
      timeoutMs: 60000,
      async execute(args) {
        const k = buildKmeansState()
        if (!k) return unavailable('KMeans clustering')
        let images: import('../llm').ToolImage[] | undefined
        if (args.withImage !== false) {
          const data = getKmeansOverlayData()
          const dims = data?.dims
          if (
            data &&
            dims &&
            Number.isSafeInteger(dims.width) &&
            Number.isSafeInteger(dims.height) &&
            dims.width > 0 &&
            dims.height > 0 &&
            data.rgb.length === dims.width * dims.height * 3 &&
            data.labels.length === dims.width * dims.height
          ) {
            try {
              // 图例只列 visibleIds（= selectedIds）内的簇：与图像前景同一集合。
              const legend = k.clusters
                .filter((cluster) => data.visibleIds.has(cluster.id))
                .map((cluster) => ({
                  color: cluster.color as readonly [number, number, number],
                  label: `#${cluster.id} (${cluster.count} px)`,
                }))
              images = [
                renderOverlayImage(
                  data.rgb,
                  dims.width,
                  dims.height,
                  'KMeans overlay',
                  {
                    labels: data.labels,
                    visibleIds: data.visibleIds,
                  },
                  legend,
                ),
              ]
            } catch {
              // No usable canvas/image: omit attachments.
            }
          }
        }
        return { state: k, images }
      },
      output: {
        render: (_args, value) =>
          typeof value === 'string'
            ? value
            : JSON.stringify({
                ...value.state,
                ...(value.images?.length ? { imageAttached: true } : {}),
              }),
        images: (args, value) =>
          typeof value === 'string' || args.withImage === false ? undefined : value.images,
      },
    }),
  )

  /**
   * get_umap —— UMAP 叠加状态（JSON）+ 叠加图。
   *
   * 作用：聚类 zarr 是否已加载（ready，另有 error 优先于 computing/ready）、后端任务
   * 是否计算中、栅格尺寸、叠加当前是否显示。附图为 UMAP 叠加 PNG（透明背景；前景
   * 由嵌入坐标决定，不由颜色决定）。讨论 UMAP 降维/空间聚类前先调用。
   *
   * 参数：
   * - withImage (boolean, 可选)：附带叠加图，默认 true
   */
  ctx.tools.register(
    defineTool({
      category: 'page',
      name: 'get_umap',
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      description:
        'Read the UMAP overlay state before discussing UMAP dimensionality reduction or spatial clustering. ' +
        'Reports whether the clustering zarr is loaded (ready), whether the backend task is still computing, ' +
        'any load error, the raster grid size, and whether the overlay currently shows. With withImage ' +
        '(default true) attaches the overlay PNG (transparent background; foreground is decided by embedding ' +
        'coordinates, not by color). The image may be omitted when the raster is not loaded or invalid.',
      parameters: {
        withImage: {
          type: 'boolean',
          description: 'Attach the UMAP overlay PNG (default true); false returns state JSON only.',
        },
      },
      timeoutMs: 60000,
      async execute(args) {
        const u = buildUmapState()
        if (!u) return unavailable('UMAP clustering overlay')
        let images: import('../llm').ToolImage[] | undefined
        if (args.withImage !== false) {
          const data = getUmapOverlayData()
          const { width, height } = data?.dims ?? { width: 0, height: 0 }
          if (
            data &&
            Number.isSafeInteger(width) &&
            Number.isSafeInteger(height) &&
            width > 0 &&
            height > 0 &&
            data.rgb.length === width * height * 3 &&
            data.occupancy.length === width * height
          ) {
            try {
              images = [
                renderOverlayImage(data.rgb, width, height, 'UMAP overlay', {
                  occupancy: data.occupancy,
                }),
              ]
            } catch {
              // No usable canvas/image: omit attachments.
            }
          }
        }
        return { state: u, images }
      },
      output: {
        render: (_args, value) =>
          typeof value === 'string'
            ? value
            : JSON.stringify({
                ...value.state,
                ...(value.images?.length ? { imageAttached: true } : {}),
              }),
        images: (args, value) =>
          typeof value === 'string' || args.withImage === false ? undefined : value.images,
      },
    }),
  )

  /**
   * get_mean_spectrum_top_peaks —— 均值谱峰按强度降序分页（决策 7）。
   *
   * 作用：仅 continuous 模式。默认窗口 rank 1–10；offset 可达任意 rank（rank 20–30
   * = offset 19 + limit 11）；mzMin/mzMax 在排序前过滤谱段。无谱数据时返回提示而非
   * 抛错。返回 {window:{total,offset,returned,nextOffset}, peaks}。
   *
   * 参数：
   * - offset (integer, 可选)：强度排序的零基窗口起点，默认 0
   * - limit (integer, 可选)：窗口大小，默认 10、页 cap 25
   * - mzMin / mzMax (number, 可选)：含端的 m/z 过滤下/上界（mzMin ≤ mzMax）
   */
  ctx.tools.register(
    defineTool({
      category: 'page',
      name: 'get_mean_spectrum_top_peaks',
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      description:
        'Read mean-spectrum peaks ranked by descending intensity (continuous mode only), paged by a ' +
        'zero-based rank window. Default window is rank 1–10; offset reaches any rank (rank 20–30 = offset ' +
        '19 + limit 11). mzMin/mzMax filter the spectrum before ranking (inclusive bounds). Returns ' +
        '{window:{total,offset,returned,nextOffset},peaks}; continue with nextOffset.',
      parameters: {
        offset: {
          type: 'integer',
          description: 'Zero-based start into the intensity ranking (any rank; default 0).',
        },
        limit: { type: 'integer', description: 'Window size, default 10, page cap 25.' },
        mzMin: { type: 'number', description: 'Inclusive lower m/z bound applied before ranking.' },
        mzMax: { type: 'number', description: 'Inclusive upper m/z bound; must be ≥ mzMin.' },
      },
      async execute(args) {
        if (args.mzMin != null && args.mzMax != null && args.mzMin > args.mzMax)
          throw new Error('mzMin must be at most mzMax')
        const { offset, limit } = resolveRankWindow(args.offset, args.limit)
        const { window, peaks } = buildMeanSpectrumPeakWindow(offset, limit, args.mzMin, args.mzMax)
        if (!window.total) return renderPeaks([])
        return `${JSON.stringify({ window, peaks })}`
      },
    }),
  )

  /**
   * get_pixel_spectrum —— 单像素谱峰按强度降序分页 + 附谱图（决策 7）。
   *
   * 作用：像素来源四选一：末次点击像素（不带选择器）、pixelIndex、pixelIndices（≤4）、
   * x/y 对（1 起采集坐标；显式读取不改动页面选择，跨 zarr 会话变更会报错）。默认窗口
   * rank 1–10、offset 可达任意 rank；每像素返回带 window 元数据的 JSON。withImage
   * （默认 true）每像素附一张全谱棒图 PNG（灰全谱 + 当前窗口峰高亮，>2000 峰按强度
   * 截断但保留高亮峰）。
   *
   * 参数：
   * - offset / limit (integer, 可选)：零基 rank 窗口，默认 0/10、limit cap 25
   * - withImage (boolean, 可选)：附全谱棒图，默认 true
   * - pixelIndex (integer, 可选)：零基谱行索引（与 pixelIndices 互斥）
   * - pixelIndices (integer[], 可选)：1–4 个谱行索引
   * - x / y (integer, 可选)：1 起采集坐标对，必须成对（与索引选择器互斥）
   */
  ctx.tools.register(
    defineTool({
      category: 'page',
      name: 'get_pixel_spectrum',
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      description:
        'Read single-pixel spectrum peaks ranked by descending intensity, paged by a zero-based rank window. ' +
        'Pixel source: the last clicked pixel (no selector), a pixelIndex, up to 4 pixelIndices, or an x/y ' +
        'pair in 1-based acquisition coordinates (explicit reads leave the page selection unchanged). Default ' +
        'window rank 1–10; offset reaches any rank. Each pixel returns its own JSON with window metadata. ' +
        'With withImage (default true) attaches one stick-spectrum PNG per pixel: full spectrum in gray with ' +
        "the current window's peaks highlighted (plots cap at 2000 peaks but keep highlighted ones).",
      timeoutMs: 60000,
      parameters: {
        offset: {
          type: 'integer',
          description: 'Zero-based start into the intensity ranking (any rank; default 0).',
        },
        limit: { type: 'integer', description: 'Window size, default 10, page cap 25.' },
        withImage: {
          type: 'boolean',
          description:
            'Attach a full-spectrum stick plot per pixel with the window peaks highlighted (default true).',
        },
        pixelIndex: {
          type: 'integer',
          description: 'Zero-based spectrum row index; mutually exclusive with pixelIndices.',
        },
        pixelIndices: {
          type: 'array',
          items: 'integer',
          description: '1–4 zero-based spectrum row indices; more or negative values error.',
        },
        x: {
          type: 'integer',
          description:
            '1-based acquisition x coordinate; must pair with y, exclusive of index selectors.',
        },
        y: { type: 'integer', description: '1-based acquisition y coordinate; must pair with x.' },
      },
      async execute(args, exec) {
        const { offset, limit } = resolveRankWindow(args.offset, args.limit)
        const wantImage = args.withImage !== false
        const explicit =
          args.pixelIndex != null || args.pixelIndices != null || args.x != null || args.y != null
        if (explicit) {
          const requestStore = store
          if (!requestStore) throw new Error('Zarr store is unavailable')
          if (args.pixelIndex != null && args.pixelIndices != null)
            throw new Error('Provide pixelIndex or pixelIndices, not both')
          let indices: number[] =
            args.pixelIndices ?? (args.pixelIndex != null ? [args.pixelIndex] : [])
          if (args.x != null || args.y != null) {
            if (args.x == null || args.y == null || indices.length)
              throw new Error('Provide an x/y pair or pixel indices')
            const coordinates = await requestStore.loadCoordinates()
            exec.signal.throwIfAborted()
            let index = -1
            for (let i = 0; i < coordinates.length; i += 3) {
              if (coordinates[i] === args.x && coordinates[i + 1] === args.y) {
                index = i / 3
                break
              }
            }
            if (index < 0) throw new Error(`No acquired pixel at (${args.x}, ${args.y})`)
            indices = [index]
          }
          if (!indices.length || indices.length > 4 || indices.some((index) => index < 0))
            throw new Error('Provide 1–4 nonnegative pixel indices')
          const results: string[] = []
          const images: import('../llm').ToolImage[] = []
          for (const index of indices) {
            exec.signal.throwIfAborted()
            if (store !== requestStore) throw new Error('Zarr session changed')
            const spectrum = await requestStore.getPixelSpectrum(index)
            exec.signal.throwIfAborted()
            if (store !== requestStore) throw new Error('Zarr session changed')
            const page = buildPixelSpectrumPeakWindow(offset, limit, spectrum)
            results.push(
              page
                ? `pixel #${index} (x=${page.pixel.x}, y=${page.pixel.y}): ${JSON.stringify({ window: page.window, peaks: page.peaks })}`
                : `pixel #${index}: no spectrum peaks`,
            )
            if (wantImage && page) {
              try {
                const all = buildPixelSpectrumAllPeaks(spectrum)
                if (all.length > 0) {
                  images.push(
                    renderSpectrumPlot(all, {
                      label: `pixel #${index} (x=${page.pixel.x}, y=${page.pixel.y})`,
                      highlightMzs: page.peaks.map((peak) => peak.mz),
                    }),
                  )
                }
              } catch {
                // No usable canvas/image: omit attachments for this pixel.
              }
            }
          }
          if (images.length > 0) return { text: results.join('\n\n'), images }
          return results.join('\n\n')
        }
        const page = buildPixelSpectrumPeakWindow(offset, limit)
        if (!page) {
          return 'No single-pixel spectrum loaded yet. Ask the user to click a pixel on the ion image, then call this again.'
        }
        const text = `pixel #${page.pixel.index} (x=${page.pixel.x}, y=${page.pixel.y}): ${JSON.stringify({ window: page.window, peaks: page.peaks })}`
        if (!wantImage) return text
        try {
          const all = buildPixelSpectrumAllPeaks(getLoadedPixelSpectrum())
          if (all.length > 0) {
            return {
              text,
              images: [
                renderSpectrumPlot(all, {
                  label: `pixel #${page.pixel.index} (x=${page.pixel.x}, y=${page.pixel.y})`,
                  highlightMzs: page.peaks.map((peak) => peak.mz),
                }),
              ],
            }
          }
        } catch {
          // No usable canvas/image: omit attachments.
        }
        return text
      },
      output: {
        render: (_args, value) => (typeof value === 'string' ? value : value.text),
        images: (args, value) =>
          typeof value === 'string' || args.withImage === false ? undefined : value.images,
      },
    }),
  )
}

// Shared lazy overlay data is read from the VizWorkbench analysis-context provider.

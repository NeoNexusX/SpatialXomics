import type { Context } from '@deepseek-ai/cordis'
import { defineTool, TOOL_RESULT_CHARS_EVIDENCE } from '../tools'
import { buildIonImageStats, getSelectedIon, getAnnotationRows } from '../../bridge/analysisContext'
import { store, mzAxisRef, dataModeRef, ionDims, ticMatrix } from '@/services/zarr/zarrSharedState'
import { findClosestMzIndex, loadIonMatrixByIndex } from '@/services/zarr/ionRead'
import { ZARR_STORE } from '@/shared/config/defaults'
import {
  renderIonImages,
  renderOverlayImage,
  renderSpectrumPlot,
  type IonRaster,
  type RenderOptions,
} from './render'

export { renderIonImages, renderOverlayImage, renderSpectrumPlot }
export type { RenderOptions }

export const name = 'tool-ion-image'
export const inject = ['tools']

export async function readIon(
  mz: number | undefined,
  tolerance: number | undefined,
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  if (mz != null && (!Number.isFinite(mz) || mz <= 0)) throw new Error('m/z must be positive')
  if (tolerance != null && (!Number.isFinite(tolerance) || tolerance <= 0))
    throw new Error('tolerance must be positive')
  const selected = getSelectedIon()
  const tol = Math.min(
    ZARR_STORE.maxMzTolerance,
    Math.max(
      ZARR_STORE.minMzTolerance,
      tolerance ?? selected?.tolerance ?? ZARR_STORE.defaultMzTolerance,
    ),
  )
  if (dataModeRef.value === 'processed') {
    if (mz !== undefined)
      throw new Error('Ion extraction is unavailable for processed data. Only TIC is available.')
    if (
      !ticMatrix.value ||
      !ionDims.value ||
      ticMatrix.value.length !== ionDims.value.width * ionDims.value.height
    )
      throw new Error('TIC image is unavailable or has invalid dimensions')
    return { ...ionDims.value, matrix: ticMatrix.value, mz: 0, tolerance: 0, label: 'TIC' }
  }
  const target = mz ?? selected?.mz
  if (target === undefined) throw new Error('Select an ion or supply mz')
  const axis = mzAxisRef.value
  const dims = ionDims.value
  const requestStore = store
  if (!axis || !dims || !requestStore) throw new Error('Ion-image dataset is unavailable')
  const index = findClosestMzIndex(target)
  if (index < 0 || Math.abs(axis[index]! - target) > tol)
    throw new Error(`No m/z axis value within ${tol} Da of ${target}`)
  const matrix = await loadIonMatrixByIndex(index, tol)
  signal.throwIfAborted()
  if (store !== requestStore) throw new Error('Zarr session changed')
  const matched = axis[index]!
  return {
    ...dims,
    matrix,
    mz: matched,
    tolerance: tol,
    label: `m/z ${target} (axis ${matched}, window ${matched - tol}–${matched + tol} Da)`,
  }
}

const parameters = {
  mz: {
    type: 'number',
    description: 'Single target m/z; mutually exclusive with mzs/rowIds; continuous mode only.',
  },
  mzs: {
    type: 'array',
    items: 'number',
    description: '1–9 m/z values to view; mutually exclusive with mz/rowIds.',
  },
  rowIds: {
    type: 'array',
    items: 'integer',
    description:
      'Annotation row ids; mutually exclusive with mz/mzs; rows sharing an obsMz are grouped into one labeled target.',
  },
  tolerance: {
    type: 'number',
    description:
      'Integration half-window in Da; defaults to the captured/current tolerance, clamped to configured bounds.',
  },
  colormap: {
    type: 'string',
    enum: ['viridis', 'inferno', 'magma', 'hot', 'gray'],
    description: 'viridis | inferno | magma | hot | gray; default viridis.',
  },
  scale: { type: 'string', enum: ['linear', 'log'], description: 'linear | log; default linear.' },
  gamma: {
    type: 'number',
    description: 'Gamma adjustment, default 1, clamped to 0.2–3.',
  },
  display: {
    type: 'string',
    enum: ['p1p95', 'p99', 'max'],
    description: 'Display range strategy: p1p95 | p99 | max; default p1p95.',
  },
  width: {
    type: 'integer',
    description: 'Maximum panel edge in pixels, default 384, clamped 64–640.',
  },
  normalize: {
    type: 'string',
    enum: ['shared', 'per-image'],
    description: 'shared | per-image intensity normalization; default shared for comparison.',
  },
  layout: {
    type: 'string',
    enum: ['separate', 'montage'],
    description: 'separate | montage; default by target count (montage above 4).',
  },
  columns: { type: 'integer', description: 'Montage columns 1–3, default 2.' },
} as const

export function apply(ctx: Context) {
  /**
   * get_ion_image —— 离子热图查看（选中离子 / 单个 mz / ≤9 个 mz / 注释 rowIds）。
   *
   * 作用：mz/mzs/rowIds 三个选择器互斥，多传即报错（不做静默优先级）；rowIds 模式把
   * 共享 obsMz 的行分组并保留各自标签。≤4 个目标出独立图，否则拼 montage；默认共享
   * 色阶便于对比；附带每个目标的定量统计（grid 尺寸 + stats JSON）。processed 数据在
   * 不给目标时返回带标签的 TIC、拒绝显式 m/z。默认目标 = 提问时（turn/start 绑定）
   * 捕获的离子，不受 turn 中途切换选择影响。
   *
   * 参数：
   * - mz (number, 可选)：单个 m/z（与 mzs/rowIds 互斥）
   * - mzs (number[], 可选)：1–9 个 m/z
   * - rowIds (integer[], 可选)：注释行 id；同 obsMz 的行分组并保留标签
   * - tolerance (number, 可选)：积分半窗（Da），默认当前容差（夹在配置上下限内）
   * - colormap (string, 可选)：viridis | inferno | magma | hot | gray，默认 viridis
   * - scale (string, 可选)：linear | log，默认 linear
   * - gamma (number, 可选)：0.2–3，默认 1
   * - display (string, 可选)：p1p95 | p99 | max，默认 p1p95
   * - width (integer, 可选)：单图最大边，默认 384、cap 640
   * - normalize (string, 可选)：shared | per-image，默认 shared
   * - layout (string, 可选)：separate | montage；缺省按目标数（>4 出 montage）
   * - columns (integer, 可选)：montage 列数 1–3，默认 2
   */
  ctx.tools.register(
    defineTool({
      name: 'get_ion_image',
      category: 'page',
      description:
        'View spatial ion heatmaps for the selected ion, a single mz, up to 9 mzs, or annotation rowIds ' +
        '(rows sharing an observed m/z are grouped and keep their labels). The three selectors ' +
        'mz/mzs/rowIds are mutually exclusive — passing more than one errors. Up to 4 targets render as ' +
        'separate images, more as a montage; the color range is shared by default for comparison. Each ' +
        'target returns grid dimensions and quantitative statistics alongside its image. Processed data ' +
        'only returns a labeled TIC when no target is given and rejects explicit m/z values. Without a ' +
        'target the image is the ion captured at question time, immune to mid-turn selection changes.',
      timeoutMs: 60000,
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      parameters,
      async execute(args, exec) {
        // 选择器互斥（审核修正）：不做静默优先级
        const given = [
          args.mz != null && 'mz',
          args.mzs != null && 'mzs',
          args.rowIds != null && 'rowIds',
        ].filter(Boolean) as string[]
        if (given.length > 1)
          throw new Error(
            `Selectors are mutually exclusive; got ${given.join(' + ')}. Pass exactly one of mz, mzs, rowIds.`,
          )

        const turn = [...(exec.session?.events ?? [])]
          .reverse()
          .find((event) => event.type === 'turn/start')
        const captured = turn?.type === 'turn/start' ? turn.binding.page.selectedIon : undefined
        const tolerance =
          args.tolerance ?? (dataModeRef.value === 'continuous' ? captured?.tolerance : undefined)
        const selectedMz = dataModeRef.value === 'continuous' ? captured?.mz : undefined

        let targets: { mz: number | undefined; label?: string }[]
        if (args.rowIds != null) {
          const rows = getAnnotationRows()
          if (!rows?.length) throw new Error('Annotation data is unavailable')
          const selected = args.rowIds.map((id) => {
            const row = rows.find((row) => row.id === id)
            if (!row) throw new Error(`Unknown annotation rowId ${id}`)
            return row
          })
          const grouped = new Map<number, string[]>()
          for (const row of selected)
            grouped.set(row.obsMz, [
              ...(grouped.get(row.obsMz) ?? []),
              `rowId=${row.id} #${row.rank} ${row.name} ${row.adduct}`,
            ])
          targets = [...grouped].map(([mz, labels]) => ({ mz, label: labels.join(' | ') }))
        } else if (args.mzs != null) {
          targets = args.mzs.map((mz) => ({ mz }))
        } else {
          targets = [{ mz: args.mz ?? selectedMz }]
        }

        if (!targets.length || targets.length > 9) throw new Error('Provide 1–9 m/z values')
        const layout = args.layout ?? (targets.length > 4 ? 'montage' : 'separate')
        if (layout === 'separate' && targets.length > 4)
          throw new Error(
            'Separate layout accepts at most 4 images. Use montage or split the batch.',
          )
        const options: RenderOptions = {
          colormap: args.colormap ?? 'viridis',
          scale: args.scale ?? 'linear',
          gamma: Math.min(3, Math.max(0.2, args.gamma ?? 1)),
          display: args.display ?? 'p1p95',
          normalize: args.normalize ?? 'shared',
          layout,
          columns: Math.min(3, Math.max(1, args.columns ?? 2)),
          width: Math.min(640, Math.max(64, args.width ?? 384)),
        }
        const images: IonRaster[] = []
        const summaries: string[] = []
        for (const [index, target] of targets.entries()) {
          try {
            const ion = await readIon(target.mz, tolerance, exec.signal)
            const label = `#${index + 1} ${target.label ?? ion.label}`
            images.push({ ...ion, label })
            summaries.push(
              `${label}\n${ion.label}; grid ${ion.width}×${ion.height}; stats ${JSON.stringify(buildIonImageStats(ion))}`,
            )
          } catch (error) {
            throw new Error(
              `Image #${index + 1} (${target.mz ?? 'selected'}) failed: ${String(error)}`,
            )
          }
        }
        exec.signal.throwIfAborted()
        return { ...renderIonImages(images, options), summaries }
      },
      output: {
        render: (_args, value) =>
          `${value.description}\n${value.summaries.join('\n')}\n[${value.images.length} image attachments]`,
        images: (_args, value) => value.images,
      },
    }),
  )
}

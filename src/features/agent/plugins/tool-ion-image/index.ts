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

const toleranceParameter = {
  type: 'number',
  description:
    'Integration half-window in Da; defaults to the captured/current tolerance, clamped to configured bounds.',
} as const

/** 注释审查只保留判据相关输入；显示策略固定为 p99 + shared，避免观感参数改变跨图比较。 */
function renderOptions(targetCount: number): RenderOptions {
  return {
    colormap: 'viridis',
    scale: 'linear',
    gamma: 1,
    display: 'p99',
    normalize: 'shared',
    layout: targetCount > 4 ? 'montage' : 'separate',
    columns: 2,
    width: 384,
  }
}

function capturedTolerance(
  tolerance: number | undefined,
  session: { events?: readonly unknown[] } | undefined,
): number | undefined {
  const turn = [...(session?.events ?? [])]
    .reverse()
    .find((event) => (event as { type?: string }).type === 'turn/start') as
    | { binding?: { page?: { selectedIon?: { tolerance?: number } } } }
    | undefined
  return tolerance ?? (dataModeRef.value === 'continuous' ? turn?.binding?.page?.selectedIon?.tolerance : undefined)
}

async function renderIonTargets(
  targets: { mz: number; label?: string }[],
  tolerance: number | undefined,
  signal: AbortSignal,
) {
  if (!targets.length || targets.length > 9) throw new Error('Provide 1–9 image targets')
  const images: IonRaster[] = []
  const summaries: string[] = []
  const failures: string[] = []
  for (const [index, target] of targets.entries()) {
    try {
      const ion = await readIon(target.mz, tolerance, signal)
      const label = `#${index + 1} ${target.label ?? ion.label}`
      images.push({ ...ion, label })
      summaries.push(
        `${label}\n${ion.label}; grid ${ion.width}×${ion.height}; stats ${JSON.stringify(buildIonImageStats(ion))}`,
      )
    } catch (error) {
      signal.throwIfAborted()
      failures.push(`Image #${index + 1} (${target.mz}) unavailable: ${String(error)}`)
    }
  }
  signal.throwIfAborted()
  if (!images.length) throw new Error(failures.join('; '))
  return { ...renderIonImages(images, renderOptions(targets.length)), summaries, failures }
}

const ionImageOutput = {
  render: (_args: unknown, value: Awaited<ReturnType<typeof renderIonTargets>>) =>
    `${value.description}\n${value.summaries.join('\n')}${value.failures.length ? `\nUnavailable targets (not evidence of absence):\n${value.failures.join('\n')}` : ''}\n[${value.images.length} image attachments]`,
  images: (_args: unknown, value: Awaited<ReturnType<typeof renderIonTargets>>) => value.images,
}

export function apply(ctx: Context) {
  /**
   * get_ion_image_by_rowIds —— 按注释行 id 取离子热图。
   * 同 obsMz 的行合并为一个带标签目标；固定 p99 显示范围与 shared 色阶。
   */
  ctx.tools.register(
    defineTool({
      name: 'get_ion_image_by_rowIds',
      category: 'page',
      description:
        'View spatial ion heatmaps for annotation rowIds. Rows sharing an observed m/z are grouped into one ' +
        'labeled target; 1–9 grouped targets are allowed. Display is fixed to p99 with a shared color range ' +
        'for comparison; up to 4 targets render as separate images, more as a 2-column montage. Batch 6 ' +
        'targets per call: 4 fills the separate-image limit and 6 fills the montage evenly, while odd counts ' +
        'and larger batches leave a ragged grid. Each target returns ' +
        'grid dimensions and quantitative statistics alongside its image. Unavailable targets are reported ' +
        'separately while successful images are retained; an unavailable m/z is not evidence that an isotope ' +
        'or molecule is absent. Requires continuous ion data and loaded annotations.',
      timeoutMs: 60000,
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      parameters: {
        rowIds: {
          type: 'array',
          items: { type: 'integer' },
          required: true,
          description:
            'Annotation row ids; rows sharing an obsMz are grouped into one labeled target (1–9 grouped targets; batch 6).',
        },
        tolerance: toleranceParameter,
      },
      async execute(args, exec) {
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
        const targets = [...grouped].map(([mz, labels]) => ({ mz, label: labels.join(' | ') }))
        return renderIonTargets(targets, capturedTolerance(args.tolerance, exec.session), exec.signal)
      },
      output: ionImageOutput,
    }),
  )

  /**
   * get_ion_image_by_mzs —— 按显式 m/z 取离子热图（含未注释峰）。
   * 固定 p99 显示范围与 shared 色阶；processed 数据拒绝显式 m/z，TIC 走 get_ion。
   */
  ctx.tools.register(
    defineTool({
      name: 'get_ion_image_by_mzs',
      category: 'page',
      description:
        'View spatial ion heatmaps for 1–9 explicit m/z values, including unannotated peaks. Display is fixed ' +
        'to p99 with a shared color range for comparison; up to 4 targets render as separate images, more as ' +
        'a 2-column montage. Batch 6 targets per call: 4 fills the separate-image limit and 6 fills the ' +
        'montage evenly, while odd counts and larger batches leave a ragged grid. ' +
        'Each target returns grid dimensions and quantitative statistics alongside its image. ' +
        'Unavailable targets are reported separately while successful images are retained; an unavailable m/z ' +
        'is not evidence that an isotope or molecule is absent. Requires continuous ion data; processed data ' +
        'rejects explicit m/z values (use get_ion for TIC).',
      timeoutMs: 60000,
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      parameters: {
        mzs: {
          type: 'array',
          items: { type: 'number' },
          maxItems: 9,
          required: true,
          description: '1–9 explicit m/z values to view; batch 6 per call.',
        },
        tolerance: toleranceParameter,
      },
      async execute(args, exec) {
        const targets = args.mzs.map((mz) => ({ mz }))
        return renderIonTargets(targets, capturedTolerance(args.tolerance, exec.session), exec.signal)
      },
      output: ionImageOutput,
    }),
  )
}
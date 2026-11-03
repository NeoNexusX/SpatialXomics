import type { Context } from '@deepseek-ai/cordis'
import { defineTool, TOOL_RESULT_CHARS_EVIDENCE } from '../tools'
import { buildIonImageStats, getSelectedIon, getAnnotationRows } from '../../bridge/analysisContext'
import { store, mzAxisRef, dataModeRef, ionDims, ticMatrix } from '@/services/zarr/zarrSharedState'
import { findClosestMzIndex, loadIonMatrixByIndex } from '@/services/zarr/ionRead'
import { ZARR_STORE } from '@/shared/config/defaults'
import { renderIonImages, type IonRaster, type RenderOptions } from './render'

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
  tolerance: {
    type: 'number',
    description: 'Integration half-window in Da, defaults to the current tolerance',
  },
  colormap: { type: 'string', enum: ['viridis', 'inferno', 'magma', 'hot', 'gray'] },
  scale: { type: 'string', enum: ['linear', 'log'] },
  gamma: { type: 'number', description: '0.2–3, default 1' },
  display: { type: 'string', enum: ['p1p95', 'p99', 'max'] },
  width: { type: 'integer', description: 'Panel maximum edge, default 384, maximum 640' },
} as const

const allParameters = {
  ...parameters,
  mz: { type: 'number' },
  mzs: { type: 'array', items: 'number', required: true },
  rowIds: { type: 'array', items: 'integer' },
  topN: { type: 'integer', description: 'Default 4, maximum 6' },
  normalize: { type: 'string', enum: ['shared', 'per-image'] },
  layout: { type: 'string', enum: ['separate', 'montage'] },
  columns: { type: 'integer', description: 'Montage columns, 1–3, default 2' },
} as const

function imageParameters(toolName: string): typeof allParameters {
  const inputKeys =
    toolName === 'get_ion_image'
      ? ['mz']
      : toolName === 'get_ion_images'
        ? ['mzs']
        : ['rowIds', 'topN']
  return Object.fromEntries(
    Object.entries(allParameters).filter(
      ([key]) => !['mz', 'mzs', 'rowIds', 'topN'].includes(key) || inputKeys.includes(key),
    ),
  ) as typeof allParameters
}

export function apply(ctx: Context) {
  for (const toolName of ['get_ion_image', 'get_ion_images', 'get_annotation_images']) {
    ctx.tools.register(
      defineTool({
        name: toolName,
        category: 'page',
        description:
          toolName === 'get_annotation_images'
            ? 'View ion heatmaps for annotation rowIds or the topN ranked rows. Labels preserve annotation identities.'
            : toolName === 'get_ion_image'
              ? 'View the selected ion or any specified mz as an image with quantitative statistics. Processed data returns labeled TIC when mz is omitted.'
              : 'View 1–9 ion heatmaps. Up to 4 separate images, otherwise a montage. Shared color range by default for comparison.',
        timeoutMs: 60000,
        maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
        parameters: imageParameters(toolName),
        async execute(args, exec) {
          const turn = [...(exec.session?.events ?? [])]
            .reverse()
            .find((event) => event.type === 'turn/start')
          const captured = turn?.type === 'turn/start' ? turn.binding.page.selectedIon : undefined
          const tolerance = args.tolerance ?? captured?.tolerance
          const selectedMz = dataModeRef.value === 'continuous' ? captured?.mz : undefined
          let targets: { mz: number | undefined; label?: string }[] =
            toolName === 'get_ion_image'
              ? [{ mz: args.mz ?? selectedMz }]
              : (args.mzs ?? []).map((mz) => ({ mz }))
          if (toolName === 'get_annotation_images') {
            const rows = getAnnotationRows()
            if (!rows?.length) throw new Error('Annotation data is unavailable')
            const selected = args.rowIds
              ? args.rowIds.map((id) => {
                  const row = rows.find((row) => row.id === id)
                  if (!row) throw new Error(`Unknown annotation rowId ${id}`)
                  return row
                })
              : [...rows]
                  .sort((a, b) => a.rank - b.rank)
                  .slice(0, Math.min(6, Math.max(1, args.topN ?? 4)))
            if (!selected.length || selected.length > 6)
              throw new Error('Select 1–6 annotation rows')
            const grouped = new Map<number, string[]>()
            for (const row of selected)
              grouped.set(row.obsMz, [
                ...(grouped.get(row.obsMz) ?? []),
                `rowId=${row.id} #${row.rank} ${row.name} ${row.adduct}`,
              ])
            targets = [...grouped].map(([mz, labels]) => ({ mz, label: labels.join(' | ') }))
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
}

import { computed, reactive, shallowReactive, shallowRef, type Ref } from 'vue'
import {
  intersectRoiMasks,
  isRoiContour,
  paintRoiShape,
  type DraftROI,
  type MaskOperation,
  type ROIContourType,
  type ROIPoint,
  type ROIType,
} from '@/features/vizworkbench/utils/roiMask'
import { ROI_SHAPE_COLORS } from '@/features/vizworkbench/utils/regionPalette'
import type { ConfirmedROI } from './useROI'
import { buildRegionMask, type Region } from '@/features/vizworkbench/utils/region'

type RegionSnapshot = Pick<Region, 'id' | 'label'> & { mask: Uint8Array }
type Source = DraftROI | RegionSnapshot

interface Mark {
  source: Source
  color: string
}

interface Step extends Mark {
  operation: MaskOperation
}

interface Contour {
  type: ROIContourType
  points: ROIPoint[]
  color: string
}

/** Keep each edit once, moving it between stacks on undo and redo. */
function useHistory<T>() {
  const entries = shallowReactive<T[]>([])
  const future = shallowReactive<T[]>([])
  const latest = computed(() => entries[entries.length - 1])
  return {
    entries,
    future,
    latest,
    append(entry: T) {
      entries.push(entry)
      future.length = 0
    },
    undo() {
      if (entries.length) future.push(entries.pop()!)
    },
    redo() {
      if (future.length) entries.push(future.pop()!)
    },
    reset() {
      entries.length = future.length = 0
    },
  }
}

export function useRoiEditor(width: Ref<number>, height: Ref<number>, runId: Ref<string>) {
  const tool = shallowRef<ROIType | null>(null)
  const operation = shallowRef<MaskOperation>('union')
  const steps = useHistory<Step>()
  const contour = useHistory<Contour>()
  const pendingShape = shallowRef<Mark | null>(null)
  const colorCursor = shallowRef(0)
  const gestureColor = shallowRef<string | null>(null)

  const openPathType = computed(() => contour.latest.value?.type ?? null)
  const path = computed(() => contour.entries.flatMap((segment) => segment.points))
  const hasPath = computed(() => !!openPathType.value)
  const hasPendingShape = computed(() => pendingShape.value !== null)
  const hasUnconfirmedShape = computed(() => hasPath.value || hasPendingShape.value)
  const pendingRegion = computed(() => {
    const source = pendingShape.value?.source
    return source && 'mask' in source ? source : null
  })
  const canSelectRegion = computed(() => !hasUnconfirmedShape.value || pendingRegion.value !== null)
  const hasDraft = computed(() => steps.entries.length > 0)

  const latestColor = computed(() => steps.latest.value?.color ?? null)
  const shapeMark = computed(() => pendingShape.value ?? steps.latest.value)
  const shapeColor = computed(() => shapeMark.value?.color ?? null)
  const contourColor = computed(() => contour.latest.value?.color ?? null)
  const currentColor = computed(
    () =>
      gestureColor.value ??
      pendingShape.value?.color ??
      (openPathType.value && tool.value === openPathType.value
        ? contourColor.value
        : latestColor.value) ??
      contourColor.value,
  )
  const nextColorIndex = computed(() => {
    let index = colorCursor.value
    while (
      ROI_SHAPE_COLORS[index] === latestColor.value ||
      ROI_SHAPE_COLORS[index] === contourColor.value
    ) {
      index = (index + 1) % ROI_SHAPE_COLORS.length
    }
    return index
  })
  const nextColor = computed(() => ROI_SHAPE_COLORS[nextColorIndex.value]!)

  function takeColor() {
    const color = nextColor.value
    colorCursor.value = (nextColorIndex.value + 1) % ROI_SHAPE_COLORS.length
    return color
  }

  function paintSource(mask: Uint8Array, source: Source, value: 0 | 1) {
    if (!('mask' in source)) {
      paintRoiShape(mask, width.value, height.value, source, value)
      return
    }
    for (let i = 0; i < mask.length; i++) {
      if (source.mask[i]) mask[i] = value
    }
  }

  const shapeMask = computed(() => {
    if (!shapeMark.value) return null
    const mask = new Uint8Array(width.value * height.value)
    paintSource(mask, shapeMark.value.source, 1)
    return mask
  })

  const previewMask = computed(() => {
    if (!hasDraft.value) return null
    const result = new Uint8Array(width.value * height.value)
    let operand: Uint8Array | undefined
    for (const { operation, source } of steps.entries) {
      if (operation === 'intersection') {
        operand ??= new Uint8Array(result.length)
        operand.fill(0)
        paintSource(operand, source, 1)
        intersectRoiMasks(result, operand)
      } else {
        paintSource(result, source, operation === 'union' ? 1 : 0)
      }
    }
    return result
  })

  const previewCount = computed(() => previewMask.value?.reduce((sum, bit) => sum + bit, 0) ?? 0)
  const openShape = computed<DraftROI | null>(() =>
    openPathType.value ? { type: openPathType.value, rect: null, path: path.value } : null,
  )
  const canClosePath = computed(
    () => !hasPendingShape.value && !!openShape.value && hasPixels(openShape.value),
  )
  const canSave = computed(() => !hasUnconfirmedShape.value && previewCount.value > 0)

  const editingPath = computed(() => !tool.value || isRoiContour(tool.value))
  const canUndo = computed(() => !hasPendingShape.value && (hasPath.value || hasDraft.value))
  const canRedoStep = computed(
    () => steps.future.length > 0 && (!hasPath.value || !editingPath.value),
  )
  const canRedo = computed(
    () =>
      !hasPendingShape.value &&
      ((editingPath.value && contour.future.length > 0) || canRedoStep.value),
  )

  const editableBox = computed(() => {
    const source = pendingShape.value?.source
    return source && 'rect' in source ? source.rect : null
  })
  const editableColor = computed(() => pendingShape.value?.color ?? null)

  const type = computed<ConfirmedROI['type']>(() => {
    const source = steps.latest.value?.source
    return steps.entries.length === 1 && source && 'type' in source ? source.type : 'composite'
  })

  function selectTool(value: ROIType | null) {
    if (hasPendingShape.value) return
    if (isRoiContour(value)) {
      if (openPathType.value && value !== openPathType.value) return
      const nextContour = contour.future[contour.future.length - 1]
      if (!hasPath.value && nextContour && value !== nextContour.type) contour.reset()
    }
    tool.value = value
  }

  function hasPixels(shape: DraftROI) {
    return paintRoiShape(null, width.value, height.value, shape, 1) > 0
  }

  function stageShape(shape: DraftROI) {
    if (!hasPendingShape.value && hasPixels(shape)) {
      pendingShape.value = { source: shape, color: takeColor() }
    }
  }

  function replaceBox(shape: DraftROI) {
    const pending = pendingShape.value
    if (!pending) return
    const { source, color } = pending
    if ('rect' in source && source.rect && shape.type === source.type && hasPixels(shape)) {
      pendingShape.value = { source: shape, color }
    }
  }

  function addSegment(points: ROIPoint[]) {
    const type = tool.value
    if (
      hasPendingShape.value ||
      !points.length ||
      !isRoiContour(type) ||
      (openPathType.value && openPathType.value !== type)
    )
      return
    contour.append({ type, points, color: contourColor.value ?? takeColor() })
  }

  function closePath() {
    const current = contour.latest.value
    const shape = openShape.value
    if (!canClosePath.value || !current || !shape) return
    pendingShape.value = { source: shape, color: current.color }
    contour.reset()
  }

  function confirmShape() {
    const pending = pendingShape.value
    if (!pending) return
    pendingShape.value = null
    if (!hasPath.value) contour.reset()
    // Undo can expose a prior shape that has the same palette color as a paused outline.
    steps.append({
      operation: operation.value,
      source: pending.source,
      color: pending.color === latestColor.value ? takeColor() : pending.color,
    })
  }

  function discardShape() {
    if (hasPendingShape.value) pendingShape.value = null
    else contour.reset()
  }

  function undo() {
    if (hasPendingShape.value) return
    if (hasPath.value && (editingPath.value || !hasDraft.value)) {
      contour.undo()
    } else {
      if (!hasPath.value) contour.reset()
      steps.undo()
      if (!hasDraft.value) operation.value = 'union'
    }
  }

  function redo() {
    if (hasPendingShape.value) return
    if (editingPath.value && contour.future.length) contour.redo()
    else if (canRedoStep.value) steps.redo()
  }

  function selectOperation(value: MaskOperation) {
    if (
      value === operation.value ||
      hasUnconfirmedShape.value ||
      (value !== 'union' && !hasDraft.value)
    )
      return
    contour.reset()
    operation.value = value
  }

  function stageRegion(region: Region) {
    if (!canSelectRegion.value) return
    const mask = buildRegionMask([region], {
      runId: runId.value,
      shape: [height.value, width.value],
    })
    if (!mask) return
    pendingShape.value = {
      source: { id: region.id, label: region.label, mask },
      color: pendingShape.value?.color ?? takeColor(),
    }
  }

  function reset() {
    tool.value = null
    operation.value = 'union'
    colorCursor.value = 0
    gestureColor.value = null
    pendingShape.value = null
    steps.reset()
    contour.reset()
  }

  return reactive({
    tool,
    operation,
    path,
    hasPendingShape,
    hasUnconfirmedShape,
    pendingRegion,
    canSelectRegion,
    openPathType,
    hasDraft,
    previewMask,
    shapeMask,
    shapeColor,
    latestColor,
    contourColor,
    nextColor,
    gestureColor,
    currentColor,
    setGestureColor(color: string | null) {
      gestureColor.value = color
    },
    previewCount,
    canClosePath,
    canSave,
    canUndo,
    canRedo,
    editableBox,
    editableColor,
    type,
    selectTool,
    selectOperation,
    stageShape,
    replaceBox,
    addSegment,
    closePath,
    confirmShape,
    discardShape,
    stageRegion,
    undo,
    redo,
    reset,
  })
}

export type RoiEditor = ReturnType<typeof useRoiEditor>

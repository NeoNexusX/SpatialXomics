export interface RegionGrid {
  runId: string
  shape: readonly [height: number, width: number]
}

interface RegionIdentity {
  id: string
  label: string
  color: string
  pixelCount: number
  grid: RegionGrid
}

export type Region = RegionIdentity &
  (
    | { kind: 'roi' | 'imported'; sourceId: string; mask: Uint8Array }
    | { kind: 'kmeans'; clusterId: number; labels: Int32Array }
  )

/** Materialize a binary union on the current grid. Scan each shared label map once. */
export function buildRegionMask(regions: readonly Region[], grid: RegionGrid) {
  const [height, width] = grid.shape
  if (!regions.length || !height || !width) return null
  const size = height * width
  const mask = new Uint8Array(size)
  const selectedLabels = new Map<Int32Array, Set<number>>()
  for (const region of regions) {
    if (
      region.grid.runId !== grid.runId ||
      region.grid.shape[0] !== height ||
      region.grid.shape[1] !== width
    )
      return null

    if (region.kind === 'kmeans') {
      const { labels, clusterId } = region
      if (labels.length !== size || clusterId < 0) return null
      let ids = selectedLabels.get(labels)
      if (!ids) {
        ids = new Set()
        selectedLabels.set(labels, ids)
      }
      ids.add(clusterId)
    } else {
      if (region.mask.length !== size) return null
      for (let i = 0; i < size; i++) {
        if (region.mask[i]) mask[i] = 1
      }
    }
  }
  for (const [labels, ids] of selectedLabels) {
    for (let i = 0; i < size; i++) {
      if (ids.has(labels[i]!)) mask[i] = 1
    }
  }
  return mask
}

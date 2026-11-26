export interface RegionGrid {
  runId: string
  shape: readonly [height: number, width: number]
}

interface RegionIdentity {
  id: string
  label: string
  color: string
  grid: RegionGrid
}

/** A row-major 0/1 mask, such as a saved ROI. */
export interface RoiRegion extends RegionIdentity {
  kind: 'roi'
  mask: Uint8Array
}

/** One cluster of a KMeans label map (-1 = unlabelled). */
export interface KmeansRegion extends RegionIdentity {
  kind: 'kmeans'
  clusterId: number
  labels: Int32Array
}

export type Region = RoiRegion | KmeansRegion

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

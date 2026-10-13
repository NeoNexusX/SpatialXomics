/**
 * Shared categorical color palette for spatial regions (KMeans clusters,
 * ROIs, and the region-comparison UI).
 *
 * Single source of truth for every place a region gets a color: the KMeans
 * Web Worker, the ROI composable, the compare panel badges, the comparison
 * overlay, and the region preview thumbnail. Because everyone indexes into
 * this one table, a region's color is its identity and stays consistent
 * across all views.
 *
 * Layout (50 colors):
 * - [0, 20)   matplotlib tab20 - used by KMeans (cluster id indexes directly,
 *             so k <= 20 never collides with the ROI block below).
 * - [20, 50)  derived set (tab20 hues, rotated lightness) - reserved for
 *             ROIs and any other non-cluster regions.
 */

export interface RGB {
  r: number
  g: number
  b: number
}

const TAB20: ReadonlyArray<readonly [number, number, number]> = [
  [31, 119, 180],
  [174, 199, 232],
  [255, 127, 14],
  [255, 187, 120],
  [44, 160, 44],
  [152, 223, 138],
  [214, 39, 40],
  [255, 152, 150],
  [148, 103, 189],
  [197, 176, 213],
  [140, 86, 75],
  [196, 156, 148],
  [227, 119, 194],
  [247, 182, 210],
  [127, 127, 127],
  [199, 199, 199],
  [188, 189, 34],
  [219, 219, 141],
  [23, 190, 207],
  [158, 218, 229],
]

/** Extra 30 colors derived from tab20 hues with rotated lightness, so they
 *  read as "related but distinct" next to the KMeans colors. */
const EXTRA: ReadonlyArray<readonly [number, number, number]> = [
  [86, 180, 233],
  [10, 60, 120],
  [230, 159, 0],
  [120, 70, 0],
  [0, 158, 115],
  [150, 230, 180],
  [204, 121, 167],
  [255, 204, 221],
  [102, 51, 153],
  [77, 34, 128],
  [153, 102, 51],
  [102, 61, 20],
  [213, 94, 0],
  [255, 153, 153],
  [70, 70, 70],
  [168, 168, 168],
  [128, 128, 0],
  [230, 230, 120],
  [0, 114, 178],
  [0, 60, 100],
  [0, 200, 200],
  [255, 85, 0],
  [120, 200, 80],
  [60, 110, 30],
  [255, 60, 60],
  [140, 20, 20],
  [200, 140, 255],
  [120, 60, 180],
  [255, 200, 120],
  [200, 150, 60],
]

const ALL: ReadonlyArray<readonly [number, number, number]> = [...TAB20, ...EXTRA]

export const REGION_PALETTE: readonly RGB[] = ALL.map(([r, g, b]) => ({ r, g, b }))

/** Number of leading palette slots reserved for KMeans clusters. */
export const KMEANS_COLOR_COUNT = TAB20.length // 20

/**
 * Fixed identity colors for comparison groups A/B. Chosen as a colorblind-safe
 * blue/orange pair (the conventional A/B contrast in MSI tools), deliberately
 * outside the tab20-derived palette hues used by clusters/ROIs so the compared
 * groups never read as "just another region".
 */
export const COMPARISON_A_RGB: RGB = { r: 37, g: 99, b: 235 } // #2563eb blue-600
export const COMPARISON_B_RGB: RGB = { r: 234, g: 88, b: 12 } // #ea580c orange-600

/**
 * Fill alpha per group in the region preview thumbnail. B is painted second
 * with lower alpha so A/B overlap shows through instead of reading as B-only.
 */
export const COMPARISON_A_ALPHA = 0.75
export const COMPARISON_B_ALPHA = 0.45

/** Same idea for the semi-transparent comparison overlay on the ion image
 *  (alpha on the 0-255 scale used by Uint8ClampedArray). */
export const COMPARISON_A_OVERLAY_ALPHA = 110
export const COMPARISON_B_OVERLAY_ALPHA = 65

/** First palette index available to ROIs (kmeans never reaches this far). */
export const ROI_COLOR_OFFSET = KMEANS_COLOR_COUNT

/** Color for a KMeans cluster id (wraps if k somehow exceeds the table). */
export function kmeansColor(id: number): RGB {
  return REGION_PALETTE[id % REGION_PALETTE.length]!
}

/**
 * Color for the n-th ROI (0-based). Starts at ROI_COLOR_OFFSET so ROIs never
 * share a color with any KMeans cluster (k <= 20); wraps inside the ROI block
 * only after 30 ROIs.
 */
export function roiColorAt(index: number): RGB {
  const span = REGION_PALETTE.length - ROI_COLOR_OFFSET
  return REGION_PALETTE[ROI_COLOR_OFFSET + (index % span)]!
}

/** "rgb(r,g,b)" CSS string - usable anywhere a CSS color is accepted,
 *  including hex+alpha-suffix concatenation ("...40") in the ROI panel. */
export function rgbCss(c: RGB): string {
  return `rgb(${c.r},${c.g},${c.b})`
}

/** "#rrggbb" hex string. */
export function rgbHex(c: RGB): string {
  const h = (v: number) => v.toString(16).padStart(2, '0')
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`
}

/** Parse a hex or CSS rgb(...) color string back to RGB. */
export function hexToRgb(color: string): RGB | null {
  const value = color.trim()
  const hex = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value)
  if (hex) {
    return { r: parseInt(hex[1]!, 16), g: parseInt(hex[2]!, 16), b: parseInt(hex[3]!, 16) }
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value)
  if (!rgb) return null
  const values = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  if (values.some((v) => v < 0 || v > 255)) return null
  return { r: values[0]!, g: values[1]!, b: values[2]! }
}

/** Convert a CSS color into an rgba() string with the supplied alpha. */
export function cssWithAlpha(color: string, alpha: number): string {
  const rgb = hexToRgb(color)
  if (!rgb) return color
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${Math.max(0, Math.min(1, alpha))})`
}

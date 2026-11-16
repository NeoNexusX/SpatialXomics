const COLORMAP_TABLE: Record<string, [number, number, number][]> = {
  viridis: [
    [68, 1, 84],
    [72, 35, 116],
    [64, 74, 138],
    [49, 104, 142],
    [38, 130, 142],
    [31, 157, 137],
    [108, 206, 89],
    [254, 231, 37],
  ],
  inferno: [
    [0, 0, 4],
    [40, 11, 84],
    [101, 21, 110],
    [159, 42, 99],
    [212, 72, 66],
    [245, 125, 21],
    [250, 193, 39],
    [252, 255, 164],
  ],
  // magma: black -> purple -> orange -> pale yellow (matplotlib 'magma' sampled evenly)
  magma: [
    [0, 0, 4],
    [34, 17, 80],
    [95, 24, 127],
    [152, 45, 128],
    [211, 67, 110],
    [248, 118, 92],
    [254, 187, 129],
    [252, 253, 191],
  ],
  // hot: black -> red -> yellow -> white (matplotlib 'hot' sampled evenly)
  hot: [
    [0, 0, 0],
    [109, 0, 0],
    [219, 0, 0],
    [255, 73, 0],
    [255, 182, 0],
    [255, 255, 36],
    [255, 255, 146],
    [255, 255, 255],
  ],
  gray: [
    [0, 0, 0],
    [255, 255, 255],
  ],
}

/** The stops a colormap interpolates between, shared by the image LUT and the display-range gradient. */
export function getColormapStops(name: string): [number, number, number][] {
  return (COLORMAP_TABLE[name] ?? COLORMAP_TABLE.viridis)!
}

// LUTs are pure functions of the colormap name — cache by name so repeated
// renders don't rebuild 256 stops every frame. Callers must treat the
// returned array as read-only.
const lutCache = new Map<string, [number, number, number][]>()

export function buildLUT(name: string): [number, number, number][] {
  const cached = lutCache.get(name)
  if (cached) return cached
  const stops = getColormapStops(name)
  const lut: [number, number, number][] = new Array(256)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    const segment = t * (stops.length - 1)
    const idx = Math.min(Math.floor(segment), stops.length - 2)
    const frac = segment - idx
    const a = stops[idx]!,
      b = stops[idx + 1]!
    lut[i] = [
      Math.round(a[0] + (b[0] - a[0]) * frac),
      Math.round(a[1] + (b[1] - a[1]) * frac),
      Math.round(a[2] + (b[2] - a[2]) * frac),
    ]
  }
  lutCache.set(name, lut)
  return lut
}

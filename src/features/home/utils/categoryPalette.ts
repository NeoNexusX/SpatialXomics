import type { CategoryRow } from './foldTail'

/**
 * Gradient families for the distribution rings, six steps each, largest share first.
 * Rows arrive sorted by count, so the shade repeats the order the ring and list show.
 * Each hue drifts with lightness (teal → green, purple → pink, rust → amber, navy → sky),
 * so dark mode runs from the light end down. Every ramp passes the ordinal checks on
 * its card surface: hue spread ≤ 40°, adjacent OKLCH ΔL ≥ 0.06, faintest step ≥ 2:1.
 */
const RAMPS = {
  green: {
    light: ['#035d57', '#027365', '#008a71', '#21a07a', '#46b682', '#67cb89'],
    dark: ['#86eba6', '#66d39d', '#46bb93', '#24a488', '#0d8b7b', '#05736c'],
  },
  berry: {
    light: ['#6c2893', '#873e9d', '#a154a6', '#bb69af', '#d480b8', '#ec97c3'],
    dark: ['#feb9db', '#f099d3', '#d581c8', '#ba6abe', '#9d54b4', '#813faa'],
  },
  amber: {
    light: ['#9d3105', '#b04700', '#c05f0b', '#d27502', '#e28c13', '#eea530'],
    dark: ['#fec679', '#fda63c', '#ee8b28', '#dd7117', '#cb560b', '#b83b07'],
  },
  blue: {
    light: ['#2142b0', '#235dbf', '#2d77cd', '#3e90db', '#54a8e7', '#6dc0f4'],
    dark: ['#a0d9ff', '#77c2fd', '#58a9f6', '#468fe7', '#3974d8', '#3258c8'],
  },
} as const
/** The folded tail stays neutral: it is a remainder, not another category. */
const OTHER = { light: '#cdd1d6', dark: '#4b5058' } as const

export type CategoryPalette = keyof typeof RAMPS

/** Spread the named rows over the whole ramp so short lists keep wide steps. */
export function categoryColors(
  rows: readonly CategoryRow[],
  palette: CategoryPalette,
  dark: boolean,
): string[] {
  const ramp = RAMPS[palette][dark ? 'dark' : 'light']
  const span = Math.max(1, rows.filter((row) => !row.other).length - 1)
  let named = 0
  return rows.map((row) => {
    if (row.other) return dark ? OTHER.dark : OTHER.light
    const step = Math.round((named++ * (ramp.length - 1)) / span)
    return ramp[Math.min(step, ramp.length - 1)]!
  })
}

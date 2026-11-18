/** Geometry uses scroll pixels: each complete card enters from below the viewport,
 * lands below its predecessor, and gets a reading interval before the next enters. */
export function cardStackLayout(
  count: number,
  stageHeight: number,
  entryOffset = stageHeight + 32,
  introEntries: readonly number[] = [],
) {
  const transitions = Math.max(0, count - 1)
  const step = transitions ? Math.min(28, 84 / transitions) : 0
  const trail = Math.min(84, step * transitions)
  const cardHeight = Math.max(0, stageHeight - trail)
  const entry = Math.max(stageHeight + 32, entryOffset)
  const hasIntro = count > 0 && introEntries.length > 0
  const hold = transitions || hasIntro ? Math.max(160, Math.min(240, cardHeight * 0.4)) : 0
  let introCursor = 0
  const introPhases = (hasIntro ? introEntries : []).map((distance, index) => {
    const entry = Math.max(0, distance)
    const start = introCursor
    const end = start + entry
    introCursor = end + hold * 0.25
    return { index, entry, start, end }
  })
  const firstStart = (introPhases[introPhases.length - 1]?.end ?? 0) + hold
  const firstEntrance = hasIntro ? { start: firstStart, end: firstStart + entry } : null
  const phases: { index: number; landing: number; start: number; end: number }[] = []
  let cursor = (firstEntrance?.end ?? 0) + hold

  for (let index = 1; index < count; index++) {
    const landing = Math.min(trail, index * step)
    const end = cursor + entry - landing
    phases.push({ index, landing, start: cursor, end })
    cursor = end + hold
  }

  return {
    step,
    trail,
    cardHeight,
    entry,
    hold,
    introPhases,
    firstEntrance,
    phases,
    travel: phases[phases.length - 1]?.end ?? firstEntrance?.end ?? 0,
    dwell: transitions || hasIntro ? cursor : 0,
  }
}

/** Only the landed card is interactive; reading intervals keep it active. */
export function activeStackCard(layout: ReturnType<typeof cardStackLayout>, distance: number) {
  if (layout.firstEntrance && distance < layout.firstEntrance.end - 0.5) return -1
  return layout.phases.filter((phase) => distance >= phase.end - 0.5).length
}

import { describe, expect, it } from 'vitest'
import { activeStackCard, cardStackLayout } from '../cardStackLayout'

describe('card stack layout bounds', () => {
  it.each([0, 1])('does not reserve scrolling for %i cards', (count) => {
    expect(cardStackLayout(count, 500)).toMatchObject({ step: 0, trail: 0, travel: 0, dwell: 0 })
  })

  it.each([2, 4, 8, 20, 100])(
    'keeps %i cards inside the stage with every lower edge covered by its successor',
    (count) => {
      const stageHeight = 500
      const layout = cardStackLayout(count, stageHeight)
      const tops = [0, ...layout.phases.map((phase) => phase.landing)]
      expect(layout.trail).toBeLessThanOrEqual(84)
      expect(layout.cardHeight).toBeGreaterThanOrEqual(416)
      expect(tops[tops.length - 1]! + layout.cardHeight).toBeCloseTo(stageHeight)
      for (let index = 1; index < tops.length; index++) {
        expect(tops[index]).toBeGreaterThan(tops[index - 1]!)
        expect(tops[index]! + layout.cardHeight).toBeGreaterThan(
          tops[index - 1]! + layout.cardHeight,
        )
      }
    },
  )

  it('keeps incoming cards below the viewport until their own entrance', () => {
    const distanceToViewportBottom = 720
    const layout = cardStackLayout(4, 500, distanceToViewportBottom + 24)
    expect(layout.entry).toBeGreaterThan(distanceToViewportBottom)
    expect(layout.entry).toBeGreaterThan(layout.cardHeight + layout.trail)
  })

  it('gives every card reading distance, including the first and last', () => {
    const layout = cardStackLayout(4, 500)
    expect(layout.phases[0]!.start).toBeGreaterThanOrEqual(160)
    for (let index = 1; index < layout.phases.length; index++) {
      expect(layout.phases[index]!.start - layout.phases[index - 1]!.end).toBeGreaterThanOrEqual(
        160,
      )
    }
    expect(layout.dwell - layout.travel).toBeGreaterThanOrEqual(160)
  })

  it('gives an appended card entrance and reading distance without losing earlier cards', () => {
    const before = cardStackLayout(4, 500)
    const after = cardStackLayout(5, 500)
    expect(after.phases).toHaveLength(before.phases.length + 1)
    expect(after.dwell - before.dwell).toBeGreaterThanOrEqual(500)
    expect(after.trail).toBeLessThanOrEqual(84)
  })

  it('recalculates travel and card size for the viewport', () => {
    const small = cardStackLayout(4, 400, 550)
    const large = cardStackLayout(4, 600, 850)
    expect(large.travel).toBeGreaterThan(small.travel)
    expect(large.cardHeight).toBeGreaterThan(small.cardHeight)
  })

  it('keeps the landed card interactive through reading intervals and reverse scrolling', () => {
    const layout = cardStackLayout(4, 500)
    expect(activeStackCard(layout, 0)).toBe(0)
    for (const phase of layout.phases) {
      expect(activeStackCard(layout, phase.start)).toBe(phase.index - 1)
      expect(activeStackCard(layout, phase.end + 10)).toBe(phase.index)
      expect(activeStackCard(layout, phase.start + 10)).toBe(phase.index - 1)
    }
    expect(activeStackCard(layout, layout.dwell)).toBe(3)
  })

  it('finishes the left entrance sequence before the first right card enters', () => {
    const entries = [720, 600, 350]
    const layout = cardStackLayout(4, 500, 720, entries)
    expect(layout.introPhases).toHaveLength(3)
    for (const phase of layout.introPhases) {
      expect(phase.entry).toBe(entries[phase.index])
      expect(phase.end - phase.start).toBeCloseTo(phase.entry)
    }
    for (let index = 1; index < layout.introPhases.length; index++) {
      expect(layout.introPhases[index]!.start).toBeGreaterThan(layout.introPhases[index - 1]!.end)
    }
    expect(
      layout.firstEntrance!.start - layout.introPhases[layout.introPhases.length - 1]!.end,
    ).toBeCloseTo(layout.hold)
    expect(layout.phases[0]!.start - layout.firstEntrance!.end).toBeCloseTo(layout.hold)
    expect(activeStackCard(layout, layout.firstEntrance!.start)).toBe(-1)
    expect(activeStackCard(layout, layout.firstEntrance!.end)).toBe(0)
    expect(activeStackCard(layout, layout.dwell)).toBe(3)
    expect(activeStackCard(layout, 0)).toBe(-1)
  })

  it('supports adding intro modules and a single right card without changing stack bounds', () => {
    const before = cardStackLayout(4, 500, 720)
    const after = cardStackLayout(4, 500, 720, [720, 600, 350, 200])
    expect(after.trail).toBe(before.trail)
    expect(after.cardHeight).toBe(before.cardHeight)
    expect(after.dwell).toBeGreaterThan(before.dwell)
    const single = cardStackLayout(1, 500, 720, [720, 600, 350])
    expect(single.phases).toHaveLength(0)
    expect(single.travel).toBe(single.firstEntrance!.end)
    expect(single.dwell - single.travel).toBeCloseTo(single.hold)
  })
})

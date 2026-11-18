import { describe, expect, it } from 'vitest'
import { categoryColors } from '../categoryPalette'

const rows = (count: number, other = false) => [
  ...Array.from({ length: count }, (_, index) => ({ category: `c${index}`, count: 10 - index })),
  ...(other ? [{ category: 'Others', count: 1, other: true }] : []),
]

describe('categoryColors', () => {
  it('runs the ramp from its deepest step and keeps the folded tail gray', () => {
    expect(categoryColors(rows(6, true), 'blue', false)).toEqual([
      '#2142b0',
      '#235dbf',
      '#2d77cd',
      '#3e90db',
      '#54a8e7',
      '#6dc0f4',
      '#cdd1d6',
    ])
  })

  it('spreads short lists across both ends of the ramp without repeating a step', () => {
    const colors = categoryColors(rows(3), 'berry', false)
    expect(colors[0]).toBe('#6c2893')
    expect(colors[2]).toBe('#ec97c3')
    expect(new Set(colors).size).toBe(3)
  })

  it('gives each card its own family and leads with the brightest step on dark surfaces', () => {
    expect(categoryColors(rows(1), 'green', false)).not.toEqual(
      categoryColors(rows(1), 'amber', false),
    )
    expect(categoryColors(rows(2, true), 'amber', true)).toEqual(['#fec679', '#b83b07', '#4b5058'])
  })
})

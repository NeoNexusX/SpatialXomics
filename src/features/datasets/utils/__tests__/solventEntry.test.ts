import { describe, expect, it } from 'vitest'
import { formatSolventEntry, parseSolventEntry, SOLVENT_UNITS } from '../solventEntry'

describe('parseSolventEntry', () => {
  it('parses a percentage entry', () => {
    expect(parseSolventEntry('50% Water')).toEqual({ value: 50, unit: '%', name: 'Water' })
  })

  it('parses concentration entries with a space between value and unit', () => {
    expect(parseSolventEntry('1 mM Acetic acid')).toEqual({ value: 1, unit: 'mM', name: 'Acetic acid' })
    expect(parseSolventEntry('350 μM Ammonium fluoride')).toEqual({
      value: 350,
      unit: 'μM',
      name: 'Ammonium fluoride',
    })
  })

  it('keeps long units ahead of their prefixes', () => {
    expect(parseSolventEntry('2 mg/mL Sodium acetate')).toEqual({ value: 2, unit: 'mg/mL', name: 'Sodium acetate' })
    expect(parseSolventEntry('5 μg/mL Lithium chloride (LiCl)')).toEqual({
      value: 5,
      unit: 'μg/mL',
      name: 'Lithium chloride (LiCl)',
    })
  })

  it('parses custom units without truncating them to a known prefix', () => {
    expect(parseSolventEntry('5 mg/kg Water')).toEqual({ value: 5, unit: 'mg/kg', name: 'Water' })
    expect(parseSolventEntry('1 v/v Acetic acid')).toEqual({ value: 1, unit: 'v/v', name: 'Acetic acid' })
  })

  it('does not mistake ratio notation for a custom unit', () => {
    expect(parseSolventEntry('1:1 MeOH')).toBeNull()
  })

  it('normalizes legacy micro unit spellings', () => {
    expect(parseSolventEntry('10 uM Ammonium acetate')?.unit).toBe('μM')
    expect(parseSolventEntry('10 µM Ammonium acetate')?.unit).toBe('μM')
  })

  it('offers only composition units, not bare mass', () => {
    expect(SOLVENT_UNITS).not.toContain('mg')
    expect(SOLVENT_UNITS).not.toContain('μg')
  })

  it('still parses legacy bare-mass entries', () => {
    expect(parseSolventEntry('1 mg Ammonium fluoride')).toEqual({
      value: 1,
      unit: 'mg',
      name: 'Ammonium fluoride',
    })
  })

  it('allows no space between unit and name', () => {
    expect(parseSolventEntry('50%Water')).toEqual({ value: 50, unit: '%', name: 'Water' })
  })

  it('rejects free text without a value+unit prefix', () => {
    expect(parseSolventEntry('H2O/MeOH (1:1)')).toBeNull()
  })

  it('rejects a quantity with no component name', () => {
    expect(parseSolventEntry('50%')).toBeNull()
  })
})

describe('formatSolventEntry', () => {
  it('omits the space between number and percent', () => {
    expect(formatSolventEntry(50, '%', 'Water')).toBe('50% Water')
  })

  it('keeps a space for letter units', () => {
    expect(formatSolventEntry(1, 'mM', 'Acetic acid')).toBe('1 mM Acetic acid')
  })

  it('round-trips every supported unit', () => {
    for (const unit of SOLVENT_UNITS) {
      expect(parseSolventEntry(formatSolventEntry(1.5, unit, 'Water'))).toEqual({ value: 1.5, unit, name: 'Water' })
    }
  })

  it('round-trips custom units', () => {
    expect(formatSolventEntry(5, 'mg/kg', 'Water')).toBe('5 mg/kg Water')
    expect(parseSolventEntry('5 mg/kg Water')).toEqual({ value: 5, unit: 'mg/kg', name: 'Water' })
  })
})

import { describe, expect, it } from 'vitest'
import { SOLVENTS } from '@/features/datasets/constants/datasetMetadata'
import {
  additivesOf,
  analyzerFamilyOf,
  buildAcquisitionContext,
  matrixKeyOf,
  normalizePolarity,
  sourceFamilyOf,
} from '../acquisitionContext'
import { resolveAdducts } from '../adductRules'
import { resolveTolerance } from '../tolerance'
import type { AcquisitionContext } from '@/features/vizworkbench/types/annotation'

const base = { polarity: '', ionSource: '', analyzer: '', maldiMatrix: '', solvent: '' }

function enabledFits(ctx: AcquisitionContext, overrides = {}) {
  return Object.fromEntries(
    resolveAdducts(ctx, overrides)
      .filter((a) => a.enabled)
      .map((a) => [a.def.id, a.fit]),
  )
}

describe('acquisition context', () => {
  it('reads polarity in any case', () => {
    expect(normalizePolarity('Positive')).toBe('positive')
    expect(normalizePolarity('negative')).toBe('negative')
    expect(normalizePolarity('')).toBeNull()
  })

  it('groups ion sources and analyzers into families', () => {
    expect(sourceFamilyOf('AP-SMALDI')).toBe('maldi')
    expect(sourceFamilyOf('SALDI')).toBe('ldi')
    expect(sourceFamilyOf('nano-DESI')).toBe('esi')
    expect(sourceFamilyOf('IR-MALDESI')).toBe('esi')
    expect(sourceFamilyOf('my custom DESI')).toBe('esi')
    expect(sourceFamilyOf('')).toBe('other')
    expect(analyzerFamilyOf('Q Exactive HF')).toBe('orbitrap')
    expect(analyzerFamilyOf('FTMS')).toBe('orbitrap')
    expect(analyzerFamilyOf('FTICR')).toBe('fticr')
    expect(analyzerFamilyOf('timsTOF fleX')).toBe('qtof')
    expect(analyzerFamilyOf('TOF')).toBe('tof')
    expect(analyzerFamilyOf('Other')).toBe('other')
  })

  it('maps matrix vocabulary and free text', () => {
    expect(matrixKeyOf('DHB (2,5-Dihydroxybenzoic acid)')).toBe('dhb')
    expect(matrixKeyOf('DHAP (2,6-Dihydroxyacetophenone)')).toBe('dhap')
    expect(matrixKeyOf('NEDC(N-(1-naphthyl)ethylenediamine dihydrochloride)')).toBe('nedc')
    expect(matrixKeyOf('Silver nanoparticle')).toBe('agnp')
    expect(matrixKeyOf('home-made CHCA mix')).toBe('chca')
    expect(matrixKeyOf('')).toBeNull()
  })

  it('maps solvent vocabulary entries exactly', () => {
    // 纯溶剂不提供加合离子（词表完整性由 SOLVENT_ADDITIVES 的类型保证）
    const pure = SOLVENTS.filter((s) => /Water|ACN|MeOH|Ethanol|IPA|Acetone|DMF|TFA|Other/.test(s))
    for (const s of pure) expect(additivesOf(`50% ${s}`)).toEqual([])
    expect(additivesOf('70% Methanol (MeOH), 30% Water, 0.1% Trifluoroacetic acid (TFA)')).toEqual(
      [],
    )
    expect(additivesOf('50% Methanol (MeOH), 0.1% Formic acid').sort()).toEqual(['formate'])
    expect(additivesOf('0.1% Ammonium acetate').sort()).toEqual(['acetate', 'ammonium'])
    expect(additivesOf('1% Lithium chloride (LiCl)').sort()).toEqual(['chloride', 'lithium'])
    expect(additivesOf('0.1% Silver nitrate (AgNO3)')).toEqual(['silver'])
  })

  it('avoids keyword traps in free text', () => {
    expect(additivesOf('0.1% trifluoroacetic acid')).toEqual([])
    expect(additivesOf('0.1% 三氟乙酸')).toEqual([])
    expect(additivesOf('二羟基苯甲酸 溶液')).toEqual([])
    expect(additivesOf('10 mM 乙酸铵').sort()).toEqual(['acetate', 'ammonium'])
    expect(additivesOf('0.1% 甲酸')).toEqual(['formate'])
  })
})

describe('adduct selection', () => {
  it('positive MALDI with DHB and TFA: H, Na, K only', () => {
    const ctx = buildAcquisitionContext({
      ...base,
      polarity: 'Positive',
      ionSource: 'MALDI',
      maldiMatrix: 'DHB (2,5-Dihydroxybenzoic acid)',
      solvent: '70% Methanol (MeOH), 30% Water, 0.1% Trifluoroacetic acid (TFA)',
    })
    expect(enabledFits(ctx)).toEqual({ 'M+H': 1, 'M+Na': 0.9, 'M+K': 0.9 })
    const nh4 = resolveAdducts(ctx, {}).find((a) => a.def.id === 'M+NH4')!
    expect(nh4.enabled).toBe(false)
    expect(nh4.requires).toEqual(['ammoniumSolvent'])
  })

  it('negative DESI with formic acid: M-H, Cl (ESI), HCOO', () => {
    const ctx = buildAcquisitionContext({
      ...base,
      polarity: 'Negative',
      ionSource: 'DESI',
      solvent: '50% Methanol (MeOH), 50% Water, 0.1% Formic acid',
    })
    expect(enabledFits(ctx)).toEqual({ 'M-H': 1, 'M+Cl': 0.8, 'M+HCOO': 0.8 })
  })

  it('negative MALDI with NEDC raises chloride to 1.0', () => {
    const ctx = buildAcquisitionContext({
      ...base,
      polarity: 'negative',
      ionSource: 'MALDI',
      maldiMatrix: 'NEDC(N-(1-naphthyl)ethylenediamine dihydrochloride)',
    })
    expect(enabledFits(ctx)).toEqual({ 'M-H': 1, 'M+Cl': 1 })
  })

  it('applies user overrides: off wins, forced-on uses the manual fit', () => {
    const ctx = buildAcquisitionContext({ ...base, polarity: 'Positive', ionSource: 'MALDI' })
    const fits = enabledFits(ctx, { 'M+K': 'off', 'M+NH4': 'on', 'M+H-H2O': 'on' })
    expect(fits).toEqual({ 'M+H': 1, 'M+Na': 0.9, 'M+NH4': 0.5, 'M+H-H2O': 0.4 })
  })

  it('uses unconditional rules when the ion source is unknown, nothing without polarity', () => {
    const ctx = buildAcquisitionContext({ ...base, polarity: 'Positive' })
    expect(enabledFits(ctx)).toEqual({ 'M+H': 1, 'M+Na': 0.8, 'M+K': 0.6 })
    expect(resolveAdducts(buildAcquisitionContext(base), {})).toEqual([])
    expect(
      buildAcquisitionContext(base, 'negative').polarity,
      'the panel can supply a missing polarity',
    ).toBe('negative')
  })
})

describe('tolerance', () => {
  it('prefers the user value, then the analyzer default, then 10 ppm', () => {
    expect(resolveTolerance({ value: 0.01, unit: 'Da' }, 'orbitrap')).toEqual({
      value: 0.01,
      unit: 'Da',
      origin: 'user',
    })
    expect(resolveTolerance({ value: null, unit: 'Da' }, 'fticr')).toEqual({
      value: 3,
      unit: 'ppm',
      origin: 'analyzer',
    })
    expect(resolveTolerance({ value: null, unit: 'ppm' }, 'other').origin).toBe('fallback')
  })
})

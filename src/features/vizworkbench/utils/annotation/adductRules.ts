/**
 * 加合物筛选：先按极性，再按规则表算适配度（fit），最后应用用户覆盖。
 *
 * 规则语义：条件字段之间是「且」，同一字段列出的多个值是「或」，不写的字段不限；
 * 同一加合物命中多条规则取最大 fit；一条都不命中 fit 为 0，不自动启用。
 * 取最大值意味着条件只能抬高 fit，现在的表里条件全是抬高。
 */

import { ADDUCT_DEFS, type AdductId } from '@/shared/chem/adducts'
import type {
  AcquisitionContext,
  AdductOverride,
  AdductRule,
  ResolvedAdduct,
} from '@/features/vizworkbench/types/annotation'

export const ADDUCT_RULES: readonly AdductRule[] = [
  // 正离子
  { adduct: 'M+H', fit: 1.0, reason: 'protonation' },
  { adduct: 'M+Na', fit: 0.8, reason: 'sodiumEndogenous' },
  { adduct: 'M+Na', fit: 0.9, sources: ['maldi', 'ldi'], reason: 'sodiumLaser' },
  { adduct: 'M+Na', fit: 1.0, additives: ['sodium'], reason: 'sodiumSolvent' },
  { adduct: 'M+K', fit: 0.6, reason: 'potassiumEndogenous' },
  { adduct: 'M+K', fit: 0.9, sources: ['maldi', 'ldi'], reason: 'potassiumLaser' },
  { adduct: 'M+NH4', fit: 0.8, additives: ['ammonium'], reason: 'ammoniumSolvent' },
  { adduct: 'M+Li', fit: 0.9, additives: ['lithium'], reason: 'lithiumSolvent' },
  { adduct: 'M+Ag', fit: 1.0, matrices: ['agnp'], reason: 'silverMatrix' },
  { adduct: 'M+Ag', fit: 1.0, additives: ['silver'], reason: 'silverSolvent' },
  // 负离子
  { adduct: 'M-H', fit: 1.0, reason: 'deprotonation' },
  { adduct: 'M+Cl', fit: 0.7, reason: 'chlorideEndogenous' },
  { adduct: 'M+Cl', fit: 0.8, sources: ['esi'], reason: 'chlorideEsi' },
  { adduct: 'M+Cl', fit: 0.9, additives: ['chloride'], reason: 'chlorideSolvent' },
  { adduct: 'M+Cl', fit: 1.0, matrices: ['nedc'], reason: 'chlorideNedc' },
  { adduct: 'M+HCOO', fit: 0.8, additives: ['formate'], reason: 'formateSolvent' },
  { adduct: 'M+CH3COO', fit: 0.8, additives: ['acetate'], reason: 'acetateSolvent' },
]

/** 没有规则、只能手动开启的加合物，以及手动开启时的 fit */
export const MANUAL_FIT: Partial<Record<AdductId, number>> = {
  'M+H-H2O': 0.4,
  'M-H-H2O': 0.4,
}

/** 其他被强制开启的加合物的 fit */
export const FORCED_FIT = 0.5

function ruleMatches(rule: AdductRule, ctx: AcquisitionContext): boolean {
  if (rule.sources && !rule.sources.includes(ctx.source)) return false
  if (rule.matrices && !(ctx.matrix && rule.matrices.includes(ctx.matrix))) return false
  if (rule.additives && !rule.additives.some((a) => ctx.additives.includes(a))) return false
  return true
}

export function resolveAdducts(
  ctx: AcquisitionContext,
  overrides: Partial<Record<AdductId, AdductOverride>>,
): ResolvedAdduct[] {
  if (!ctx.polarity) return []
  return ADDUCT_DEFS.filter((def) => def.polarity === ctx.polarity).map((def) => {
    const rules = ADDUCT_RULES.filter((r) => r.adduct === def.id)
    const hits = rules.filter((r) => ruleMatches(r, ctx))
    const ruleFit = hits.reduce((m, r) => Math.max(m, r.fit), 0)
    const reasons = hits.map((r) => r.reason)
    const requires = ruleFit > 0 ? [] : rules.map((r) => r.reason)
    const ov = overrides[def.id]
    if (ov === 'off') {
      return { def, fit: ruleFit, reasons, requires, enabled: false, origin: 'rule' as const }
    }
    if (ruleFit > 0) {
      return { def, fit: ruleFit, reasons, requires, enabled: true, origin: 'rule' as const }
    }
    if (ov === 'on') {
      const fit = MANUAL_FIT[def.id] ?? FORCED_FIT
      return { def, fit, reasons, requires, enabled: true, origin: 'user' as const }
    }
    return { def, fit: 0, reasons, requires, enabled: false, origin: 'rule' as const }
  })
}

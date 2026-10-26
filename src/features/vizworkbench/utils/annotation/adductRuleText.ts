import { t } from '@/i18n'
import type { ResolvedAdduct, RuleReason } from '@/features/vizworkbench/types/annotation'

/** 加合物多选列表中的采集条件规则提示。 */
const RULE_TEXT: Record<RuleReason, () => string> = {
  protonation: () => t('vizworkbench.annotation.rule.protonation'),
  sodiumEndogenous: () => t('vizworkbench.annotation.rule.sodiumEndogenous'),
  sodiumLaser: () => t('vizworkbench.annotation.rule.sodiumLaser'),
  sodiumSolvent: () => t('vizworkbench.annotation.rule.sodiumSolvent'),
  potassiumEndogenous: () => t('vizworkbench.annotation.rule.potassiumEndogenous'),
  potassiumLaser: () => t('vizworkbench.annotation.rule.potassiumLaser'),
  ammoniumSolvent: () => t('vizworkbench.annotation.rule.ammoniumSolvent'),
  lithiumSolvent: () => t('vizworkbench.annotation.rule.lithiumSolvent'),
  silverMatrix: () => t('vizworkbench.annotation.rule.silverMatrix'),
  silverSolvent: () => t('vizworkbench.annotation.rule.silverSolvent'),
  deprotonation: () => t('vizworkbench.annotation.rule.deprotonation'),
  chlorideEndogenous: () => t('vizworkbench.annotation.rule.chlorideEndogenous'),
  chlorideEsi: () => t('vizworkbench.annotation.rule.chlorideEsi'),
  chlorideSolvent: () => t('vizworkbench.annotation.rule.chlorideSolvent'),
  chlorideNedc: () => t('vizworkbench.annotation.rule.chlorideNedc'),
  formateSolvent: () => t('vizworkbench.annotation.rule.formateSolvent'),
  acetateSolvent: () => t('vizworkbench.annotation.rule.acetateSolvent'),
}

export function adductReasonText(adduct: ResolvedAdduct): string {
  return adduct.origin === 'user'
    ? t('vizworkbench.annotation.adductForced', { fit: adduct.fit })
    : adduct.reasons.map((reason) => RULE_TEXT[reason]()).join(' / ')
}

export function adductRequirementText(adduct: ResolvedAdduct): string {
  return adduct.requires.length === 0
    ? t('vizworkbench.annotation.adductManualOnly')
    : t('vizworkbench.annotation.adductRequires', {
        conditions: adduct.requires.map((reason) => RULE_TEXT[reason]()).join(' / '),
      })
}

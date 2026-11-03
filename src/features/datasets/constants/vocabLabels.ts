import { t, te } from '@/i18n'
import * as DATASET_VOCABS from './datasetMetadata'

/**
 * 数据集词表（datasetMetadata.ts）的显示文字。
 *
 * 词表数组里的英文原值是提交给后端、存进 URL / 筛选条件的值，一个字都不改；这里只负责
 * 界面显示。key 写死成静态字符串，t() 的 key 能被类型检查和 ESLint 校验，不需要动态拼 key。
 *
 * 显示规则（按词表分三类）：
 * - 原样显示英文，不进本表：仪器型号、离子源、谱图/存储模式，以及稳定化处理、MALDI 基质、
 *   溶剂——这些是化学 / 专业术语或表达式，如 `CHCA (α-Cyano-4-hydroxycinnamic acid)`；
 * - 「中文 (English)」：组织部位、实验条件、培养条件、组织前处理、基质涂布方式，
 *   译文里带上英文原值，如 `脑 (Brain)`；
 * - 物种沿用「中文名 (拉丁学名)」，极性与 Other 直接译成中文。
 * 表里没有的值——用户在 Other 里自填的、后端历史数据——同样原样显示。
 * 在 computed / 模板里调用才会随语言切换刷新。
 */
const VOCAB_LABELS: Record<string, () => string> = {
  Other: () => t('common.input.other'),
  Positive: () => t('datasets.vocab.positive'),
  Negative: () => t('datasets.vocab.negative'),
  'Human (Homo sapiens)': () => t('datasets.vocab.human'),
  'Mouse (Mus musculus)': () => t('datasets.vocab.mouse'),
  'Rat (Rattus norvegicus)': () => t('datasets.vocab.rat'),
  'Zebrafish (Danio rerio)': () => t('datasets.vocab.zebrafish'),
  'Fruit fly (Drosophila melanogaster)': () => t('datasets.vocab.fruitFly'),
  'Arabidopsis (Arabidopsis thaliana)': () => t('datasets.vocab.arabidopsis'),
  'E. coli (Escherichia coli)': () => t('datasets.vocab.ecoli'),
  'Yeast (Saccharomyces cerevisiae)': () => t('datasets.vocab.yeast'),
  Brain: () => t('datasets.vocab.brain'),
  Heart: () => t('datasets.vocab.heart'),
  Liver: () => t('datasets.vocab.liver'),
  Lung: () => t('datasets.vocab.lung'),
  Kidney: () => t('datasets.vocab.kidney'),
  Spleen: () => t('datasets.vocab.spleen'),
  Pancreas: () => t('datasets.vocab.pancreas'),
  Intestine: () => t('datasets.vocab.intestine'),
  Stomach: () => t('datasets.vocab.stomach'),
  Skin: () => t('datasets.vocab.skin'),
  Blood: () => t('datasets.vocab.blood'),
  Tumor: () => t('datasets.vocab.tumor'),
  Muscle: () => t('datasets.vocab.muscle'),
  Bone: () => t('datasets.vocab.bone'),
  Eye: () => t('datasets.vocab.eye'),
  Embryo: () => t('datasets.vocab.embryo'),
  Fetus: () => t('datasets.vocab.fetus'),
  'Whole organism': () => t('datasets.vocab.wholeOrganism'),
  Control: () => t('datasets.vocab.control'),
  Disease: () => t('datasets.vocab.disease'),
  Cancer: () => t('datasets.vocab.cancer'),
  Infection: () => t('datasets.vocab.infection'),
  'Drug-treated': () => t('datasets.vocab.drugTreated'),
  'Genetic modification': () => t('datasets.vocab.geneticModification'),
  'Time-course': () => t('datasets.vocab.timeCourse'),
  'In vivo': () => t('datasets.vocab.inVivo'),
  'Ex vivo': () => t('datasets.vocab.exVivo'),
  'In vitro': () => t('datasets.vocab.inVitro'),
  'Cell culture': () => t('datasets.vocab.cellCulture'),
  '2D culture': () => t('datasets.vocab.culture2d'),
  '3D culture': () => t('datasets.vocab.culture3d'),
  Organoid: () => t('datasets.vocab.organoid'),
  None: () => t('datasets.vocab.none'),
  Sectioned: () => t('datasets.vocab.sectioned'),
  Cryosectioned: () => t('datasets.vocab.cryosectioned'),
  Microdissected: () => t('datasets.vocab.microdissected'),
  Washed: () => t('datasets.vocab.washed'),
  Digested: () => t('datasets.vocab.digested'),
  Stained: () => t('datasets.vocab.stained'),
  'Enzymatic treatment': () => t('datasets.vocab.enzymaticTreatment'),
  'Chemical derivatization': () => t('datasets.vocab.chemicalDerivatization'),
  Spraying: () => t('datasets.vocab.spraying'),
  Airbrush: () => t('datasets.vocab.airbrush'),
  'Automated sprayer': () => t('datasets.vocab.automatedSprayer'),
  Sublimation: () => t('datasets.vocab.sublimation'),
  Spotting: () => t('datasets.vocab.spotting'),
  'Droplet deposition': () => t('datasets.vocab.dropletDeposition'),
  'Inkjet printing': () => t('datasets.vocab.inkjetPrinting'),
}

export function vocabLabel(value: string | null | undefined): string {
  if (!value) return ''
  // datasets 语言包随路由懒加载；在没加载它的页面里调用时原样显示，而不是显示裸 key。
  // 探针必须是 datasets 自己的 key——common 启动即加载，拿它判断会恒为真。
  if (!te('datasets.vocab.positive', 'en')) return value
  return VOCAB_LABELS[value]?.() ?? value
}

/** 所有词表取值的集合（含原样显示英文、不在上表里的那些） */
const ALL_VOCAB_VALUES = new Set<string>(
  Object.values(DATASET_VOCABS).flatMap((v) => (Array.isArray(v) ? (v as readonly string[]) : [])),
)

/** 是否为词表内的取值。词表值是规范写法（大小写、化学式），展示时不应再做大小写变换 */
function isVocabValue(value: string): boolean {
  return ALL_VOCAB_VALUES.has(value)
}

/**
 * 元数据展示归一：空值 → 「—」；词表值原样/按译文显示；自填值沿用首字母大写。
 * 词表值是规范写法（如 CHCA (α-Cyano-4-hydroxycinnamic acid)），不能再做大小写变换。
 */
export function formatVocabOrText(val?: string): string {
  if (!val) return '—'
  if (isVocabValue(val)) return vocabLabel(val)
  return val.charAt(0).toUpperCase() + val.slice(1).toLowerCase()
}

/** 供 IconSelect 使用的 { 显示文字: 原值 } 映射 */
export function vocabOptionMap(values: readonly string[]): Record<string, string> {
  return Object.fromEntries(values.map((v) => [vocabLabel(v), v]))
}

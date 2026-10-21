/**
 * 数据集元数据的下拉选项 —— 质谱成像的领域词表。
 *
 * 这些词表描述的是学科事实（有哪些离子源、哪些基质），而不是部署差异：同一份前端在任何
 * 部署下都应给出同样的选项。它们原先放在 `public/config.json` 的 `options` 块，但那份文件
 * 是启动关键路径上的阻塞请求，而这 2.5KB 只有上传表单和数据集筛选两处用得到。迁到这里后
 * 随路由 chunk 走、带 hash 长缓存，未被引用的词表还能被 tree-shake 掉。
 *
 * 代价是改词表需要重新构建，这是有意的取舍：新增一个离子源本来也要同步改
 * `ionSourceRules.ts` 的匹配规则，两者放在一起反而不容易改漏。
 *
 * 全部用 `as const`，消费端拿到的是字面量联合类型而非 `string[]`，拼错值编译期即报错。
 * 需要按普通字符串使用时（如对任意输入做 `.includes` 判断），在调用点断言为 `readonly string[]`。
 */

/** 离子极性 */
export const POLARITIES = ['Positive', 'Negative'] as const

/** 离子源 / 电离方式 */
export const ION_SOURCES = [
  'MALDI',
  'DESI',
  'SIMS',
  'AP-MALDI',
  'AP-SMALDI',
  'nano-DESI',
  'LDI',
  'SALDI',
  'MALDI-2',
  'LAESI',
  'IR-MALDESI',
  'Other',
] as const

/** 质量分析器型号 */
export const ANALYZERS = [
  'Orbitrap Exploris 480',
  'Orbitrap Exploris 240',
  'Orbitrap Exploris 120',
  'Q Exactive HF',
  'Q Exactive',
  'timsTOF fleX',
  'Orbitrap',
  'FTICR',
  'TOF',
  'FTMS',
  'Q-TOF',
  'Other',
] as const

/** 谱图模式 */
export const SPECTRUM_MODES = ['profile', 'centroid'] as const

/** imzML 存储模式 */
export const STORAGE_MODES = ['continuous', 'processed'] as const

/** 实验 / 数据类型 */
export const EXPERIMENT_TYPES = ['imzML', 'Other'] as const

/** 物种 */
export const ORGANISMS = [
  'Human (Homo sapiens)',
  'Mouse (Mus musculus)',
  'Rat (Rattus norvegicus)',
  'Zebrafish (Danio rerio)',
  'Fruit fly (Drosophila melanogaster)',
  'Arabidopsis (Arabidopsis thaliana)',
  'E. coli (Escherichia coli)',
  'Yeast (Saccharomyces cerevisiae)',
  'Other',
] as const

/** 取材部位 */
export const ORGANISM_PARTS = [
  'Brain',
  'Heart',
  'Liver',
  'Lung',
  'Kidney',
  'Spleen',
  'Pancreas',
  'Intestine',
  'Stomach',
  'Skin',
  'Blood',
  'Tumor',
  'Muscle',
  'Bone',
  'Eye',
  'Embryo',
  'Fetus',
  'Whole organism',
  'Other',
] as const

/** 样本状态 / 实验条件 */
export const CONDITIONS = [
  'Control',
  'Disease',
  'Cancer',
  'Infection',
  'Drug-treated',
  'Genetic modification',
  'Time-course',
  'Other',
] as const

/** 样本培养条件 */
export const SAMPLE_GROWTH_CONDITIONS = [
  'In vivo',
  'Ex vivo',
  'In vitro',
  'Cell culture',
  '2D culture',
  '3D culture',
  'Organoid',
  'Other',
] as const

/** 样本稳定化处理 */
export const SAMPLE_STABILIZATIONS = [
  'Fresh',
  'Fresh frozen',
  'Snap frozen',
  'FFPE (Formalin-fixed paraffin-embedded)',
  'Fixed (formalin)',
  'Ethanol fixed',
  'Dried',
  'Other',
] as const

/** 组织修饰 / 前处理 */
export const TISSUE_MODIFICATIONS = [
  'None',
  'Sectioned',
  'Cryosectioned',
  'Microdissected',
  'Washed',
  'Digested',
  'Stained',
  'Enzymatic treatment',
  'Chemical derivatization',
  'Other',
] as const

/** MALDI 基质 */
export const MALDI_MATRICES = [
  'CHCA (α-Cyano-4-hydroxycinnamic acid)',
  'DHB (2,5-Dihydroxybenzoic acid)',
  'NEDC(N-(1-naphthyl)ethylenediamine dihydrochloride)',
  'Sinapinic acid',
  '9-AA (9-Aminoacridine)',
  'Norharmane',
  'DAN (1,5-Diaminonaphthalene)',
  'DHAP (2,6-Dihydroxyacetophenone)',
  'Ionic liquid matrices',
  'Gold nanoparticle',
  'Silver nanoparticle',
  'Other',
] as const

/** 基质涂布方式 */
export const MALDI_MATRIX_APPLICATIONS = [
  'Spraying',
  'Airbrush',
  'Automated sprayer',
  'Sublimation',
  'Spotting',
  'Droplet deposition',
  'Inkjet printing',
  'Other',
] as const

/**
 * 溶剂（含常见添加剂与掺杂盐）。注释的加合物规则按这里的每一项判断溶剂提供了哪些离子，
 * 新增一项要同步 vizworkbench/utils/annotation/acquisitionContext.ts 的 SOLVENT_ADDITIVES
 * （那张表按本词表声明类型，漏了会编译报错）。
 */
export const SOLVENTS = [
  'Water',
  'Acetonitrile (ACN)',
  'Methanol (MeOH)',
  'Ethanol',
  'Isopropanol (IPA)',
  'Acetone',
  'Dimethylformamide (DMF)',
  'Chloroform',
  'Formic acid',
  'Acetic acid',
  'Trifluoroacetic acid (TFA)',
  'Ammonium hydroxide',
  'Ammonium acetate',
  'Ammonium formate',
  'Ammonium fluoride',
  'Lithium chloride (LiCl)',
  'Sodium acetate',
  'Silver nitrate (AgNO3)',
  'Other',
] as const

export function createDefaultDatasetFilters() {
  return {
    filename: '',
    experiment_type: '',
    organism: '',
    organism_part: '',
    condition: '',
    sample_stabilization: '',
    sample_growth_conditions: '',
    tissue_modification: '',
    maldi_matrix: '',
    maldi_matrix_application: '',
    solvent: '',
    polarity: '',
    ionisation_source: '',
    analyzer: '',
    first_uploaded_by: '',
  }
}

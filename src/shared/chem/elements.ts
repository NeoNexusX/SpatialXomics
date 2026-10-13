/**
 * 元素的单同位素质量（Da）：每个元素取丰度最高的同位素，数值来自 NIST
 * Atomic Weights and Isotopic Compositions。
 *
 * 加合物质量位移（adducts.ts）、注释库分子式质量计算和 decoy 元素池共用这一张表，
 * 避免各处手写常数导致电子质量之类的细节对不齐。
 */

/** 电子质量（Da） */
export const ELECTRON_MASS = 0.00054857990946

/**
 * 只作为 decoy 加合元素使用的元素（化学上不会以加合形式出现在 MSI 数据里），
 * 注释 FDR 的 decoy 元素池按这里的顺序取（vizworkbench/utils/annotation/decoys.ts）。
 */
export const DECOY_ONLY_MASS: Readonly<Record<string, number>> = {
  Sc: 44.95590828,
  Ti: 47.94794198,
  V: 50.94395704,
  Cr: 51.94050623,
  Mn: 54.93804391,
  Co: 58.93319429,
  Ni: 57.93534241,
  Ga: 68.9255735,
  Ge: 73.921177761,
  As: 74.92159457,
  Sr: 87.9056125,
  Y: 88.9058403,
  Zr: 89.9046977,
  Nb: 92.906373,
  Mo: 97.90540482,
  Ru: 101.9043441,
  Rh: 102.905498,
  Pd: 105.9034804,
  Cd: 113.90336509,
  In: 114.903878776,
  Sn: 119.90220163,
  Sb: 120.903812,
  Te: 129.906222748,
  Ba: 137.905247,
  La: 138.9063563,
  Ce: 139.9054431,
  Pr: 140.9076576,
  Nd: 141.907729,
  Sm: 151.9197397,
  Eu: 152.921238,
  Gd: 157.9241123,
  Tb: 158.9253547,
  Dy: 163.9291819,
  Ho: 164.9303288,
  Er: 165.9302995,
  Tm: 168.9342179,
  Yb: 173.9388664,
  Lu: 174.9407752,
  Hf: 179.946557,
  Ta: 180.9479958,
  W: 183.95093092,
  Re: 186.9557501,
  Os: 191.961477,
  Ir: 192.9629216,
  Pt: 194.9647917,
  Hg: 201.9706434,
  Tl: 204.9744278,
  Pb: 207.9766525,
  Bi: 208.9803991,
  Th: 232.0380558,
  U: 238.0507884,
}

export const MONOISOTOPIC_MASS: Readonly<Record<string, number>> = {
  // 有机元素与常见杂原子
  H: 1.00782503223,
  B: 11.00930536,
  C: 12,
  N: 14.00307400443,
  O: 15.99491461957,
  F: 18.99840316273,
  Si: 27.97692653465,
  P: 30.97376199842,
  S: 31.9720711744,
  Cl: 34.968852682,
  Se: 79.9165218,
  Br: 78.9183376,
  I: 126.9044719,
  // 碱金属、碱土与生物常见金属
  Li: 7.0160034366,
  Na: 22.989769282,
  Mg: 23.985041697,
  K: 38.9637064864,
  Ca: 39.962590863,
  Fe: 55.93493633,
  Cu: 62.92959772,
  Zn: 63.92914201,
  Rb: 84.9117897379,
  Cs: 132.905451961,
  // 纳米颗粒 / 掺杂
  Ag: 106.9050916,
  Au: 196.96656879,
  ...DECOY_ONLY_MASS,
}

/**
 * 分子式 → 单同位素质量（Da）。支持 `C42H82NO8P` 这类「元素 + 个数」写法，
 * 忽略空白和末尾的电荷符号（`C24H50NO4+`）。括号、同位素标记或未知元素 → null。
 */
export function formulaMass(formula: string): number | null {
  const s = formula.replace(/\s+/g, '').replace(/[+-]+$/, '')
  if (!s) return null
  let mass = 0
  let consumed = 0
  for (const m of s.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    const el = MONOISOTOPIC_MASS[m[1]!]
    if (el == null) return null
    mass += el * (m[2] ? Number(m[2]) : 1)
    consumed += m[0].length
  }
  return consumed === s.length ? mass : null
}

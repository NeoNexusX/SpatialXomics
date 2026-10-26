/**
 * 最近一次注释运行的结果，发布给跨面板消费者（如区域比较的富集导出）。
 *
 * useAnnotation 在每次结果到达 / 更新 / 清空时同步到这里（replace 风格，
 * shallowRef 只认引用替换，恰好与 useAnnotation 的更新方式一致）。
 * 区域比较结果表读取这里，把检出率 enriched 的离子对上注释信息。
 */

import { shallowRef, type ShallowRef } from 'vue'
import type { IonAnnotation, Molecule } from '@/features/vizworkbench/types/annotation'

export const sharedAnnotationIons: ShallowRef<IonAnnotation[]> = shallowRef([])

export const sharedAnnotationMolecules: ShallowRef<Map<number, Molecule>> = shallowRef(
  new Map<number, Molecule>(),
)

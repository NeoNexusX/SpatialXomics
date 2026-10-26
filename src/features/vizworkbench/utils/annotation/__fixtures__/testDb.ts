/**
 * 注释测试用的小库（annotation-db.csv，按库模板 ID,Name,Formula,InChI,Mass 一行一个化合物）：
 * 组织中常见的脂质与代谢物，与 peaks.positive.csv / peaks.negative.csv 配套。
 * 编号为测试用的 TEST0001…；最后一行是库模板的示例行（HMDB0240254）。
 */

import dbCsv from './annotation-db.csv?raw'
import { parseAnnotationDbCsv } from '../annotationDb'
import type { AnnotationDb } from '@/features/vizworkbench/types/annotation'

export function buildTestDb(): AnnotationDb {
  return parseAnnotationDbCsv(dbCsv, { id: 'test', label: 'Test DB', version: '1' })
}

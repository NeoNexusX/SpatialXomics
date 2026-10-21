/**
 * 数据源注册表：页面 tab 的顺序即数组顺序。
 * 新数据库 = 新建 source 文件（照 hmdb.ts 的样子）+ 在此追加，其余零改动。
 */
import type { DatabaseSource } from '../types/database'
import { hmdbSource } from './hmdb'

export const DATABASE_SOURCES: DatabaseSource[] = [hmdbSource]

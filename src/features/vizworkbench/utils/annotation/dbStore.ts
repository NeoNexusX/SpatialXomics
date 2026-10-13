/**
 * 记住用户导入的注释库 CSV（IndexedDB，全站一份，不分结果页）。
 * 纯便利功能：任何读写失败（隐私模式、配额、被禁用）都静默忽略，用户仍可选择本地文件。
 */

const DB_NAME = 'spatialxomics-annotation'
const DB_VERSION = 2
const STORE = 'custom-db'
/** 旧版本按结果页存特征峰 CSV 的表，升级时删掉 */
const LEGACY_STORE = 'feature-csv'
const KEY = 'current'

export interface StoredDbCsv {
  fileName: string
  text: string
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let settled = false
    const done = (db: IDBDatabase | null) => {
      if (settled) {
        db?.close()
        return
      }
      settled = true
      resolve(db)
    }
    try {
      if (typeof indexedDB === 'undefined') return done(null)
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (db.objectStoreNames.contains(LEGACY_STORE)) db.deleteObjectStore(LEGACY_STORE)
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      }
      req.onsuccess = () => done(req.result)
      req.onerror = () => done(null)
      // 别的页签还开着旧版本时升级会一直等：先按没有存储处理，等到了再关掉
      req.onblocked = () => done(null)
    } catch {
      done(null)
    }
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      req.onsuccess = () => resolve((req.result as T) ?? null)
      req.onerror = () => resolve(null)
      tx.oncomplete = () => db.close()
    } catch {
      db.close()
      resolve(null)
    }
  })
}

export function loadStoredDb(): Promise<StoredDbCsv | null> {
  return withStore<StoredDbCsv>('readonly', (s) => s.get(KEY))
}

export async function saveStoredDb(value: StoredDbCsv): Promise<void> {
  await withStore('readwrite', (s) => s.put(value, KEY))
}

export async function clearStoredDb(): Promise<void> {
  await withStore('readwrite', (s) => s.delete(KEY))
}

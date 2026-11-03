/**
 * Simple, generic LRU cache with O(1) get / set.
 *
 * Implementation note: we rely on `Map`'s built-in insertion-order
 * iteration. On a hit, `get` deletes the entry first and re-inserts it,
 * which moves it to the tail (most-recently-used position).
 */
export class LruCache<K, V> {
  private map = new Map<K, V>()
  private maxSize: number

  constructor(maxSize = 5) {
    this.maxSize = Math.max(1, maxSize)
  }

  get(key: K): V | undefined {
    const v = this.map.get(key)
    if (v === undefined) return undefined
    // hit → move to end
    this.map.delete(key)
    this.map.set(key, v)
    return v
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.maxSize) {
      // Evict the least-recently-used entry: the FIRST key in Map iteration order.
      const oldest = this.map.keys().next().value as K | undefined
      if (oldest !== undefined) this.map.delete(oldest)
    }
  }

  clear(): void {
    this.map.clear()
  }
}

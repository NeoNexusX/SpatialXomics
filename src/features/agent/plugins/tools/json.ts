/** 无损 JSON 值：工具参数、schema 注解和回答都只能是这些 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/** 自有属性判断；项目的 lib 还没有 Object.hasOwn */
export function hasOwn(target: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(target, key)
}

/** 普通对象：字面量或 JSON.parse 产出的对象，不含数组和类实例 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** 能经 JSON 往返而不变的数：有限，且不是 -0 */
export function isJsonNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)
}

/** 值能原样经过 JSON 序列化：没有 undefined、函数、NaN、类实例、稀疏数组或循环引用 */
export function isJsonValue(value: unknown, ancestors = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return isJsonNumber(value)
  if (typeof value !== 'object') return false
  if (ancestors.has(value)) return false
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        if (!hasOwn(value, index) || !isJsonValue(value[index], ancestors)) return false
      }
      return true
    }
    return isPlainObject(value) && Object.values(value).every((item) => isJsonValue(item, ancestors))
  } finally {
    ancestors.delete(value)
  }
}

/** 逐层冻结，返回同一个值 */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const item of Object.values(value)) deepFreeze(item)
  }
  return value
}

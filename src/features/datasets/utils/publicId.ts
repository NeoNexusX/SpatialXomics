import type { FilePublicId } from '../types/dataset'

/** Shared backend contract for dataset and collection public identifiers. */
const PUBLIC_ID_RE = /^[A-Za-z0-9]{16}$/

export function isValidPublicId(value: unknown): value is FilePublicId {
  return typeof value === 'string' && PUBLIC_ID_RE.test(value)
}

export function toFilePublicId(value: unknown): FilePublicId {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!isValidPublicId(id)) {
    throw new Error(`Backend contract violation: invalid file public_id ${JSON.stringify(value)}`)
  }
  return id
}

/**
 * Normalization and validation for "Other" custom text inputs in select dropdowns.
 *
 * Rules:
 * - Trim leading/trailing whitespace
 * - Collapse consecutive spaces
 * - Convert to Title Case
 * - Max 50 characters by default (callers such as the metadata editor can pass a larger cap)
 * - Allow only: A-Z a-z 0-9 space - _ / ( ) , .
 */

import { t } from '@/i18n'

const DEFAULT_MAX_LENGTH = 50
const ALLOWED_RE = /^[A-Za-z0-9\s\-_/(),.]*$/

export function normalizeOtherInput(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
}

export function toTitleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function validateOtherInput(value: string, maxLength = DEFAULT_MAX_LENGTH): string {
  const normalized = normalizeOtherInput(value)

  if (!normalized) {
    return ''
  }

  if (normalized.length > maxLength) {
    return t('common.input.otherTooLong', { max: maxLength })
  }

  if (!ALLOWED_RE.test(normalized)) {
    return t('common.input.otherInvalidChars')
  }

  return ''
}

import { getCurrentScope, onScopeDispose } from 'vue'

/** Only the latest request may publish state; disposed scopes reject late responses. */
export function useLatestRequest() {
  let version = 0
  const invalidate = () => { version++ }
  if (getCurrentScope()) onScopeDispose(invalidate)
  return {
    begin() {
      const requestVersion = ++version
      return () => requestVersion === version
    },
    invalidate,
  }
}

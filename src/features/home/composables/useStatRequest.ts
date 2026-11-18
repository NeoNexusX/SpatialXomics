import { shallowReadonly, shallowRef, watch } from 'vue'

/** Each statistic owns its request; retries and disposal invalidate older responses. */
export function useStatRequest<T, E = string>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  describeError: (cause: unknown) => E,
) {
  const data = shallowRef<T | null>(null)
  const loading = shallowRef(true)
  const error = shallowRef<E | null>(null)
  const revision = shallowRef(0)

  watch(
    revision,
    async (_, __, onCleanup) => {
      const controller = new AbortController()
      onCleanup(() => controller.abort())
      loading.value = true
      error.value = null
      data.value = null
      try {
        const result = await fetcher(controller.signal)
        if (!controller.signal.aborted) data.value = result
      } catch (cause) {
        if (!controller.signal.aborted) error.value = describeError(cause)
      } finally {
        if (!controller.signal.aborted) loading.value = false
      }
    },
    { immediate: true },
  )

  return {
    data: shallowReadonly(data),
    loading: shallowReadonly(loading),
    error: shallowReadonly(error),
    reload: () => revision.value++,
  }
}

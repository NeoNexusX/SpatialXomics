/** Stop waiting even when a provider ignores its signal. Late results stay isolated. */
export function abortable<T>(start: () => PromiseLike<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void Promise.resolve()
      .then(() => {
        signal.throwIfAborted()
        return start()
      })
      .then(
        (value) => {
          signal.removeEventListener('abort', onAbort)
          resolve(value)
        },
        (error) => {
          signal.removeEventListener('abort', onAbort)
          reject(error)
        },
      )
  })
}

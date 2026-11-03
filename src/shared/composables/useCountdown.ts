import { computed, onUnmounted, ref } from 'vue'

export function useCountdown(
  initialCount = 60,
  storageKey = 'countdown_attempts',
  maxAttempts = 10,
) {
  // State
  const count = ref(initialCount)
  const isActive = ref(false)
  const attempts = ref(0)

  let timer: ReturnType<typeof setInterval> | null = null

  if (storageKey) {
    const savedAttempts = sessionStorage.getItem(storageKey)
    if (savedAttempts) {
      attempts.value = parseInt(savedAttempts, 10) || 0
    }
  }

  // Computed
  const isExhausted = computed(() => attempts.value >= maxAttempts)

  // Methods
  const stop = () => {
    isActive.value = false
    count.value = initialCount
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  const cstart = () => {
    if (isActive.value || attempts.value >= maxAttempts) return

    isActive.value = true
    count.value = initialCount

    attempts.value++
    if (storageKey) {
      sessionStorage.setItem(storageKey, attempts.value.toString())
    }

    timer = setInterval(() => {
      count.value--
      if (count.value <= 0) {
        stop()
      }
    }, 1000)
  }

  // Lifecycle
  onUnmounted(() => {
    stop()
  })

  return {
    count,
    isActive,
    maxAttempts,
    isExhausted,
    start: cstart,
  }
}

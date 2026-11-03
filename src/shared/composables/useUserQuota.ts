import { computed, ref } from 'vue'
import { getUserQuota } from '@/shared/api/quotaApi'
import type { UserQuota } from '@/shared/types/quota'
import { formatBytes } from '@/shared/utils/format'

const GB = 1024 ** 3
const pct = (used: number, max: number) => (max ? Math.min(100, (used / max) * 100) : 0)

export function useUserQuota() {
  // State
  const quotaData = ref<UserQuota | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Computed
  const quota = computed(() => {
    const q = quotaData.value
    if (!q) {
      return {
        uploadUsed: '—',
        uploadMax: '—',
        uploadPercent: 0,
        fileCount: '—',
        maxFiles: '—',
        filePercent: 0,
        procUsed: '—',
        procMax: '—',
        procPercent: 0,
        downloadUsed: '—',
        downloadMax: '—',
        downloadPercent: 0,
      }
    }
    return {
      uploadUsed: formatBytes(q.total_uploaded_size_bytes),
      uploadMax: `${q.max_total_file_size} GB`,
      uploadPercent: pct(q.total_uploaded_size_bytes, q.max_total_file_size * GB),
      fileCount: String(q.file_count),
      maxFiles: String(q.max_files_per_user),
      filePercent: pct(q.file_count, q.max_files_per_user),
      procUsed: formatBytes(q.total_processed_size_bytes),
      procMax: `${q.max_processing_size_gb} GB`,
      procPercent: pct(q.total_processed_size_bytes, q.max_processing_size_gb * GB),
      downloadUsed: String(q.download_used),
      downloadMax: String(q.max_download_count),
      downloadPercent: pct(q.download_used, q.max_download_count),
    }
  })

  // Methods
  async function fetchQuota() {
    loading.value = true
    error.value = null
    try {
      quotaData.value = await getUserQuota()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn('[useUserQuota] fetch failed:', msg)
      error.value = msg
    } finally {
      loading.value = false
    }
  }

  return { quota, loading, error, fetchQuota }
}

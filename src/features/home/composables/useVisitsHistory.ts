import { isAxiosError } from 'axios'
import { getVisitsHistory } from '../api/statsApi'
import { useStatRequest } from './useStatRequest'

/** Loads the public 90-day history and cancels superseded retries or unmounted requests. */
export function useVisitsHistory() {
  const { data: history, ...request } = useStatRequest(getVisitsHistory, (cause) =>
    isAxiosError(cause) && cause.response?.status === 503 ? 'unavailable' : 'loadFailed',
  )
  return { history, ...request }
}

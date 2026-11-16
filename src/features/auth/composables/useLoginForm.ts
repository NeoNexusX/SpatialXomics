import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/shared/auth/authStore'
import { login as loginApi } from '@/shared/auth/authApi'
import { extractBackendError } from '@/shared/api/httpClient'
import { useToast } from '@/shared/composables/useToast'
import { t } from '@/i18n'

export function useLoginForm() {
  // External composables
  const { showToast } = useToast()
  const router = useRouter()
  const authStore = useAuthStore()

  // State
  const username = ref('')
  const password = ref('')
  const isLoading = ref(false)

  // Methods
  const login = async () => {
    if (!username.value || !password.value) {
      showToast(t('auth.toast.missingCredentials'), 'warning')
      return
    }

    isLoading.value = true
    try {
      const { access_token } = await loginApi({
        username: username.value,
        password: password.value,
      })
      if (!access_token) throw new Error(t('auth.toast.invalidToken'))

      // Await login(): authStore.login internally awaits fetchUser(), so the
      // navbar renders with auth.user already populated instead of racing it
      // with a second GET /user.
      await authStore.login(access_token)
      // login() resolved -> token survived the profile fetch (a 401 would have
      // cleared it and bounced to /login via the http interceptor).
      sessionStorage.setItem('just_logged_in', '1')
      showToast(t('auth.toast.loginSuccess'), 'success')
      // 登录后的默认落地页是公开数据集列表（与 router.beforeEach 里
      // 「已登录用户访问 /login 时的去向」保持一致）。
      router.push('/datasets').catch((err) => console.error('Router Push Error:', err))
    } catch (error: any) {
      console.error('Login Error:', error)
      showToast(extractBackendError(error), 'error')
    } finally {
      isLoading.value = false
    }
  }

  return {
    username,
    password,
    isLoading,
    login,
  }
}

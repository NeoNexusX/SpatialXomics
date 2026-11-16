import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getCurrentUser, updateUserProfile } from '@/shared/auth/authApi'
import { useToast } from '@/shared/composables/useToast'
import { useAuthStore } from '@/shared/auth/authStore'
import { extractBackendError } from '@/shared/api/httpClient'
import { useSendEmailCode } from '@/shared/composables/useSendEmailCode'
import { useUserQuota } from '@/shared/composables/useUserQuota'
import { POSITION_OPTIONS } from '@/shared/constants/profileOptions'
import { getRegionOptions } from '@/shared/utils/regionOptions'
import { SESSION_KEYS } from '@/shared/config'
import {
  PROFILE_EMAIL_PATTERN,
  VALIDATION_PATTERNS,
} from '@/features/auth/constants/validationPatterns'
import type { UsrProfileUpdate } from '@/shared/auth/types'
import { t } from '@/i18n'

export function useUserProfileForm() {
  // External composables
  const router = useRouter()
  const { showToast } = useToast()
  const authStore = useAuthStore()
  const { quota, fetchQuota } = useUserQuota()
  const {
    count: codeCooldown,
    isActive: isCooldownActive,
    isExhausted,
    sendCode: sendCodeRequest,
  } = useSendEmailCode({
    sessionKey: SESSION_KEYS.profileEmailCode,
    purpose: 'update',
    successMessage: () => t('auth.code.sentCheckEmail'),
  })

  // 国家名随界面语言变化；提交的始终是 ISO 代码
  const regionOptions = computed(() => getRegionOptions())

  // State
  const loading = ref(false)
  const formData = reactive({
    username: '',
    email: '',
    identity: '',
    institution: '',
    position: '',
    research_field: '',
    region: '',
    orcid: '',
    homepage: '',
  })

  const isEmailModalOpen = ref(false)
  const newEmail = ref('')
  const emailCode = ref('')
  const sendingCode = ref(false)

  // ── Password change modal ────────────────────────────────────────────────
  const isPasswordModalOpen = ref(false)
  const newPassword = ref('')
  const confirmPassword = ref('')
  const savingPassword = ref(false)

  // Computed

  // Methods
  const applyUserData = (data: any) => {
    formData.username = data.username || ''
    formData.email = data.email || ''
    formData.identity = data.identity || ''
    formData.institution = data.institution || ''
    formData.position = data.position || ''
    formData.research_field = data.research_field || ''
    formData.region = data.region || ''
    formData.orcid = data.orcid || ''
    formData.homepage = data.homepage || ''
  }

  const handleLogout = async () => {
    await authStore.logout()
    router.push('/login')
  }

  const openEmailModal = () => {
    newEmail.value = ''
    emailCode.value = ''
    isEmailModalOpen.value = true
  }

  const closeEmailModal = () => {
    isEmailModalOpen.value = false
  }

  const sendVerificationCode = async () => {
    await sendCodeRequest(newEmail.value, {
      validate: () => {
        if (!newEmail.value || !new RegExp(PROFILE_EMAIL_PATTERN).test(newEmail.value)) {
          showToast(t('auth.toast.enterValidEmail'), 'warning')
          return false
        }
        return true
      },
      setLoading: (value) => {
        sendingCode.value = value
      },
    })
  }

  const submitEmailChange = async () => {
    if (!newEmail.value || !emailCode.value) {
      showToast(t('users.toast.enterEmailAndCode'), 'warning')
      return
    }
    try {
      loading.value = true
      await updateUserProfile({
        username: formData.username,
        email: newEmail.value,
        verify_code: emailCode.value,
      } as any)
      formData.email = newEmail.value
      showToast(t('common.feedback.updated'), 'success')
      closeEmailModal()
    } catch (err: any) {
      console.error('Email change failed:', err?.response?.data ?? err)
      showToast(extractBackendError(err), 'error')
    } finally {
      loading.value = false
    }
  }

  // ── Password change modal methods ──────────────────────────────────────

  const openPasswordModal = () => {
    newPassword.value = ''
    confirmPassword.value = ''
    isPasswordModalOpen.value = true
  }

  const closePasswordModal = () => {
    isPasswordModalOpen.value = false
  }

  const submitPasswordChange = async () => {
    const pw = newPassword.value
    if (!pw || !confirmPassword.value) {
      showToast(t('users.toast.fillBothPasswords'), 'warning')
      return
    }

    const passwordPattern = new RegExp(VALIDATION_PATTERNS.password)
    if (!passwordPattern.test(pw)) {
      showToast(t('users.toast.passwordRule'), 'error')
      return
    }

    if (pw !== confirmPassword.value) {
      showToast(t('auth.validation.passwordMismatch'), 'error')
      return
    }

    savingPassword.value = true
    try {
      await updateUserProfile({
        username: formData.username,
        password: pw,
      } as Partial<UsrProfileUpdate>)
      showToast(t('users.toast.passwordChanged'), 'success')
      closePasswordModal()
      setTimeout(() => {
        handleLogout()
      }, 1500)
    } catch (err: any) {
      console.error('Password change failed:', err?.response?.data ?? err)
      showToast(extractBackendError(err), 'error')
    } finally {
      savingPassword.value = false
    }
  }

  const loadProfile = async () => {
    loading.value = true
    fetchQuota()
    try {
      applyUserData((await getCurrentUser()) || {})
    } catch (error: any) {
      console.error('Failed to fetch user profile:', error)
      if (error.response && error.response.status === 401) {
        handleLogout()
      }
    } finally {
      loading.value = false
    }
  }

  const handleSave = async () => {
    loading.value = true
    const messages: string[] = []
    // 用布尔标记判断成败，不要再从文案里找 "failed"——文案翻译后就匹配不到了
    let failed = false

    const profilePayload: Partial<UsrProfileUpdate> = {
      username: formData.username,
      institution: formData.institution,
      position: formData.position,
      research_field: formData.research_field,
      region: formData.region,
      orcid: formData.orcid,
      homepage: formData.homepage,
    }

    try {
      await updateUserProfile(profilePayload)
      messages.push(t('common.feedback.updated'))
    } catch (profileError: any) {
      failed = true
      messages.push(
        t('common.feedback.withDetail', {
          message: t('common.feedback.updateFailed'),
          detail: extractBackendError(profileError),
        }),
      )
    }

    try {
      const refreshed = await getCurrentUser()
      if (refreshed) applyUserData({ ...formData, ...refreshed })
    } catch (refreshError) {
      console.warn('Silent refresh failed after save:', refreshError)
      failed = true
      messages.push(
        t('common.feedback.withDetail', {
          message: t('common.feedback.updateFailed'),
          detail: extractBackendError(refreshError),
        }),
      )
    }

    showToast(messages.join('\n'), failed ? 'error' : 'success')

    loading.value = false
  }

  // Lifecycle
  onMounted(loadProfile)

  return {
    loading,
    positionOptions: POSITION_OPTIONS,
    regionOptions,
    formData,
    isEmailModalOpen,
    newEmail,
    emailCode,
    sendingCode,
    codeCooldown,
    isCooldownActive,
    isExhausted,
    isPasswordModalOpen,
    newPassword,
    confirmPassword,
    savingPassword,
    quota,
    openEmailModal,
    closeEmailModal,
    sendVerificationCode,
    submitEmailChange,
    openPasswordModal,
    closePasswordModal,
    submitPasswordChange,
    handleSave,
  }
}

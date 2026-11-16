import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useSendEmailCode } from '@/shared/composables/useSendEmailCode'
import { resetPassword } from '@/shared/auth/authApi'
import { useToast } from '@/shared/composables/useToast'
import { SESSION_KEYS } from '@/shared/config'
import { t } from '@/i18n'
import { useLocale } from '@/shared/composables/useLocale'
import { VALIDATION_PATTERNS } from '@/features/auth/constants/validationPatterns'
import {
  passwordScore as scorePassword,
  passwordProgressClass,
} from '@/features/auth/utils/passwordStrength'

const patterns = { ...VALIDATION_PATTERNS }

export function useForgotPassword() {
  const router = useRouter()
  const { showToast } = useToast()
  const {
    count: countdown,
    isActive: isCountdownActive,
    isExhausted,
    sendCode: sendCodeRequest,
  } = useSendEmailCode({
    sessionKey: SESSION_KEYS.forgotPasswordCodeAttempts,
    purpose: 'reset_password',
    successMessage: () => t('auth.code.sentCheckEmail'),
  })

  // ── State ──────────────────────────────────────────────────────────────

  const form = reactive({
    email: '',
    verify_code: '',
    new_password: '',
    confirm_password: '',
  })

  const errors = reactive({
    email: '',
    verify_code: '',
    new_password: '',
    confirm_password: '',
  })

  const loading = reactive({
    sendCode: false,
    reset: false,
  })

  /** 当前步骤：'email' — 输邮箱 → 'reset' — 输验证码和新密码 */
  const step = ref<'email' | 'reset'>('email')

  // ── Password strength ─────────────────────────────────────────────────

  const passwordScore = computed(() => scorePassword(form.new_password))

  const progressBarClass = computed(() => passwordProgressClass(passwordScore.value))

  // ── Validation ────────────────────────────────────────────────────────

  function validateField(field: keyof typeof form) {
    const value = form[field]
    switch (field) {
      case 'email':
        if (!value) errors.email = t('auth.validation.emailRequired')
        else if (!new RegExp(patterns.email).test(value))
          errors.email = t('auth.validation.emailInvalid')
        else errors.email = ''
        break
      case 'verify_code':
        if (!value) errors.verify_code = t('auth.validation.verificationCodeRequired')
        else if (!new RegExp(patterns.verify_code).test(value))
          errors.verify_code = t('auth.validation.codeInvalid')
        else errors.verify_code = ''
        break
      case 'new_password':
        if (!value) errors.new_password = t('auth.validation.newPasswordRequired')
        else if (!new RegExp(patterns.password).test(value))
          errors.new_password = t('auth.validation.passwordInvalid')
        else errors.new_password = ''
        break
      case 'confirm_password':
        if (!value) errors.confirm_password = t('auth.validation.confirmNewPasswordRequired')
        else if (value !== form.new_password)
          errors.confirm_password = t('auth.validation.passwordMismatch')
        else errors.confirm_password = ''
        break
    }
  }

  function clearError(field: keyof typeof form) {
    errors[field] = ''
  }

  // 错误文案是校验那一刻按当时语言生成的字符串；切语言后把正在显示的错误按新语言重算
  const { locale } = useLocale()
  watch(locale, () => {
    ;(Object.keys(errors) as (keyof typeof form)[]).forEach((field) => {
      if (errors[field]) validateField(field)
    })
  })

  function validateStep(): boolean {
    if (step.value === 'email') {
      validateField('email')
      return !errors.email
    } else {
      const fields: (keyof typeof form)[] = ['email', 'verify_code', 'new_password', 'confirm_password']
      fields.forEach(validateField)
      return fields.every((f) => !errors[f])
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────

  /** 发送验证码 → 进入第二步 */
  async function sendCode() {
    await sendCodeRequest(form.email, {
      validate: () => {
        validateField('email')
        if (errors.email) {
          showToast(t('auth.toast.enterValidEmail'), 'error')
          return false
        }
        return true
      },
      setLoading: (value) => {
        loading.sendCode = value
      },
      onSuccess: () => {
        step.value = 'reset'
      },
      onError: (error) => console.error('Send code error:', error.message),
    })
  }

  /** 提交重置密码 */
  async function submitReset() {
    if (!validateStep()) {
      showToast(t('auth.toast.fixErrorsBeforeSubmit'), 'error')
      return
    }

    loading.reset = true
    try {
      await resetPassword({
        email: form.email,
        verify_code: form.verify_code,
        new_password: form.new_password,
      })
      showToast(t('auth.toast.resetSuccess'), 'success')
      setTimeout(() => {
        router.replace('/login')
      }, 2000)
    } catch (error: any) {
      console.error('Reset password error:', error.message)
      showToast(error.message || t('auth.toast.resetFailed'), 'error')
    } finally {
      loading.reset = false
    }
  }

  /** 返回上一步 */
  function backToEmail() {
    step.value = 'email'
  }

  return {
    form,
    errors,
    patterns,
    loading,
    step,
    passwordScore,
    progressBarClass,
    countdown,
    isCountdownActive,
    isExhausted,
    validateField,
    clearError,
    sendCode,
    submitReset,
    backToEmail,
  }
}

<script setup lang="ts">
import { computed } from 'vue'
import RegisterAccountForm from '@/features/auth/components/RegisterAccountForm.vue'
import RegisterProfileForm from '@/features/auth/components/RegisterProfileForm.vue'
import { useRegisterForm } from '@/features/auth/composables/useRegisterForm'

const registerForm = useRegisterForm()

const accountFormProps = computed(() => ({
  form: registerForm.form,
  errors: registerForm.errors,
  patterns: registerForm.patterns,
  loading: registerForm.loading,
  passwordScore: registerForm.passwordScore.value,
  progressBarClass: registerForm.progressBarClass.value,
  countdown: registerForm.countdown.value,
  isCountdownActive: registerForm.isCountdownActive.value,
  isExhausted: registerForm.isExhausted.value,
  validateField: registerForm.validateField,
  clearError: registerForm.clearError,
  sendVerificationCode: registerForm.sendVerificationCode,
}))

const profileFormProps = computed(() => ({
  form: registerForm.form,
  errors: registerForm.errors,
  patterns: registerForm.patterns,
  loading: registerForm.loading,
  positionOptions: registerForm.positionOptions,
  regionOptions: registerForm.regionOptions.value,
  researchFieldOptions: registerForm.researchFieldOptions,
  validateField: registerForm.validateField,
  clearError: registerForm.clearError,
}))
</script>

<template>
  <div class="flex-1 w-full flex items-center justify-center p-4 sm:p-8 bg-base-200/30 kawaru-text-100">
    <div
      class="card max-w-5xl w-full bg-base-100 shadow-2xl rounded-2xl overflow-visible border border-base-200"
    >
      <form class="flex flex-col lg:flex-row relative items-stretch" @submit.prevent="registerForm.register">
        <RegisterAccountForm
          v-bind="accountFormProps"
        />

        <RegisterProfileForm
          v-bind="profileFormProps"
        />
      </form>
    </div>
  </div>
</template>

<style scoped>
.progress {
  transition: all 0.3s ease;
}
.toast {
  animation: slideIn 0.3s ease;
}
@keyframes slideIn {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
</style>

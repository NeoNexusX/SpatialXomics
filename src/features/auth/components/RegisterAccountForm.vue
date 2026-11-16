<script setup lang="ts">
import { computed } from 'vue'
import IconInput from '@/shared/components/IconInput.vue'
import { getAppName } from '@/shared/config/appName'
import { passwordStrengthLabel } from '@/features/auth/utils/passwordStrength'

const props = defineProps<{
  form: Record<string, any>
  errors: Record<string, string>
  patterns: Record<string, string>
  loading: { register: boolean; sendCode: boolean }
  passwordScore: number
  progressBarClass: string
  countdown: number
  isCountdownActive: boolean
  isExhausted: boolean
  validateField: (field: any) => void
  clearError: (field: any) => void
  sendVerificationCode: () => void
}>()

const strengthLabel = computed(() => passwordStrengthLabel(props.passwordScore))
</script>

<template>
  <div
    class="w-full lg:w-1/2 p-5 sm:p-8 md:p-10 flex flex-col flex-1 min-h-0 border-b lg:border-b-0 lg:border-r border-base-200"
  >
    <div class="min-h-[72px] mb-4">
      <h2
        class="kawaru-text-page-title leading-[1.15] font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent w-fit"
      >
        {{ $t('auth.register.title') }}
      </h2>
      <p class="kawaru-text-100 text-base-content/70 mt-5 mb-5">
        {{ $t('auth.register.subtitle', { app: getAppName() }) }}
      </p>
    </div>

    <div class="flex flex-col gap-5">
      <div class="min-h-[56px]">
        <IconInput
          v-model="form.username"
          icon-type="user"
          type="text"
          autocomplete="username"
          required
          validator
          :placeholder="$t('common.field.username')"
          :pattern="patterns.username"
          :error="errors.username"
          @blur="validateField('username')"
          @focus="clearError('username')"
        />
      </div>
      <div class="min-h-[56px]">
        <IconInput
          v-model="form.email"
          icon-type="email"
          type="email"
          autocomplete="email"
          required
          validator
          :placeholder="$t('common.field.email')"
          :pattern="patterns.email"
          :error="errors.email"
          @blur="validateField('email')"
          @focus="clearError('email')"
        />
      </div>
      <div class="min-h-[56px] flex flex-col justify-center">
        <IconInput
          v-model="form.password"
          icon-type="password"
          type="password"
          required
          validator
          autocomplete="new-password"
          :placeholder="$t('common.field.password')"
          :error="errors.password"
          @focus="clearError('password')"
          @blur="validateField('password')"
        />
        <div class="w-full">
          <progress
            :value="passwordScore"
            class="progress w-full h-2"
            :class="progressBarClass"
            max="5"
          ></progress>
          <div class="flex justify-between kawaru-text-75 mb-2 opacity-70">
            <span>{{ $t('auth.strength.label') }}</span>
            <span>{{ strengthLabel }}</span>
          </div>
        </div>
      </div>
      <div class="min-h-[56px]">
        <IconInput
          v-model="form.confirm_password"
          icon-type="password"
          type="password"
          required
          validator
          autocomplete="new-password"
          :placeholder="$t('auth.field.confirmPassword')"
          :error="errors.confirm_password"
          @blur="validateField('confirm_password')"
          @focus="clearError('confirm_password')"
        />
      </div>
      <div class="min-h-[56px] flex items-start">
        <div class="form-control w-full">
          <div class="flex flex-col sm:flex-row w-full gap-3 items-start">
            <div class="flex-grow">
              <IconInput
                v-model="form.verify_code"
                icon-type="verify_code"
                type="text"
                required
                validator
                :placeholder="$t('auth.field.verificationCode')"
                :pattern="patterns.verify_code"
                :error="errors.verify_code"
                @blur="validateField('verify_code')"
                @focus="clearError('verify_code')"
              />
            </div>
            <button
              type="button"
              @click="sendVerificationCode"
              class="btn btn-neutral w-full sm:w-auto sm:min-w-[100px] kawaru-text-87"
              :disabled="isCountdownActive || loading.sendCode || isExhausted"
              :class="{ 'opacity-50 cursor-not-allowed': isExhausted }"
              :title="isExhausted ? $t('auth.code.tooManyRequests') : ''"
            >
              <span v-if="loading.sendCode" class="loading loading-spinner loading-xs"></span>
              <span v-else-if="isCountdownActive" class="font-mono">{{
                $t('auth.code.countdown', { seconds: countdown })
              }}</span>
              <span v-else-if="isExhausted">{{ $t('auth.code.limitReached') }}</span>
              <span v-else>{{ $t('auth.code.send') }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="mt-auto pt-6 flex items-center justify-center kawaru-text-87">
      <span class="opacity-70">{{ $t('auth.register.haveAccount') }}</span>
      <router-link
        to="/login"
        class="link link-primary font-bold ml-1 no-underline hover:underline"
      >
        {{ $t('auth.register.signIn') }}
      </router-link>
    </div>
  </div>
</template>

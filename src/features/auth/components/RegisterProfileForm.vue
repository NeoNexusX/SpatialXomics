<script setup lang="ts">
import IconInput from '@/shared/components/IconInput.vue'
import IconSelect from '@/shared/components/IconSelect.vue'
import SelectWithOther from '@/shared/components/SelectWithOther.vue'
import { profileOptionLabel, profileOptionMap } from '@/shared/constants/profileOptions'

defineProps<{
  form: Record<string, any>
  errors: Record<string, string>
  patterns: Record<string, string>
  loading: { register: boolean; sendCode: boolean }
  positionOptions: readonly string[]
  regionOptions: Record<string, string>
  researchFieldOptions: readonly string[]
  validateField: (field: any) => void
  clearError: (field: any) => void
}>()
</script>

<template>
  <div
    class="w-full lg:w-1/2 p-5 sm:p-8 md:p-10 pb-8 flex flex-col flex-1 min-h-0 bg-base-200/50 dark:bg-base-200/20"
  >
    <div class="min-h-[72px] mb-4">
      <h3 class="kawaru-text-150 font-bold flex items-center gap-2">
        {{ $t('auth.register.profileTitle') }}
      </h3>
      <p class="text-base-content/60 kawaru-text-100 mt-3">{{ $t('auth.register.profileSubtitle') }}</p>
    </div>

    <div class="flex flex-col gap-5">
      <div class="min-h-[56px]">
        <IconInput
          v-model="form.institution"
          icon-type="institution"
          type="text"
          required
          validator
          :placeholder="$t('auth.field.institution')"
          :pattern="patterns.institution"
          :error="errors.institution"
          @blur="validateField('institution')"
          @focus="clearError('institution')"
        />
      </div>
      <div class="min-h-[56px]">
        <IconSelect
          v-model="form.position"
          :options="profileOptionMap(positionOptions)"
          icon-type="position"
          :placeholder="$t('common.field.position')"
          :error="errors.position"
          @change="validateField('position')"
          @focus="clearError('position')"
        />
      </div>
      <div class="min-h-[56px]">
        <IconSelect
          v-model="form.region"
          :options="regionOptions"
          icon-type="region"
          :placeholder="$t('common.field.region')"
          :error="errors.region"
          @change="validateField('region')"
          @focus="clearError('region')"
        />
      </div>
      <div class="min-h-[56px]">
        <SelectWithOther
          v-model="form.research_field"
          :options="researchFieldOptions"
          :label-of="profileOptionLabel"
          icon-type="research"
          required
          validator
          :placeholder="$t('common.field.researchField')"
          :error="errors.research_field"
          :other-placeholder="$t('auth.field.researchFieldOther')"
          @change="validateField('research_field')"
          @focus="clearError('research_field')"
          @blur="validateField('research_field')"
        />
      </div>
      <div class="min-h-[56px]">
        <IconInput
          v-model="form.orcid"
          icon-type="id-card"
          type="text"
          validator
          :placeholder="$t('auth.field.orcid')"
          :pattern="patterns.orcid"
          :error="errors.orcid"
          @blur="validateField('orcid')"
          @focus="clearError('orcid')"
        />
      </div>
      <div class="min-h-[56px]">
        <IconInput
          v-model="form.homepage"
          icon-type="link"
          type="text"
          validator
          :placeholder="$t('auth.field.homepage')"
          :pattern="patterns.url"
          :error="errors.homepage"
          @blur="validateField('homepage')"
          @focus="clearError('homepage')"
        />
      </div>
    </div>

    <div class="mt-auto pt-6">
      <button
        type="submit"
        class="btn btn-primary w-full btn-lg shadow-xl hover:scale-[1.01] transition-transform kawaru-text-112"
        :disabled="loading.register"
      >
        <span v-if="loading.register" class="loading loading-spinner loading-md"></span>
        <span v-else class="kawaru-text-112">{{ $t('auth.register.submit') }}</span>
      </button>
    </div>
  </div>
</template>

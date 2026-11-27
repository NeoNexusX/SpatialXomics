<template>
  <dialog class="modal" :class="{ 'modal-open': open }">
    <!-- 12 个调用方，有的外壳设了字号有的没有，弹窗还可能脱离文档流，
         所以三处字号全部显式挂档位、不靠继承。 -->
    <div class="modal-box">
      <h3 class="kawaru-text-112 font-bold flex items-center gap-2">
        <slot name="icon" />
        {{ title }}
      </h3>
      <p class="py-4 kawaru-text-100">
        <slot>{{ message }}</slot>
      </p>
      <div class="modal-action">
        <button
          v-if="!hideCancel"
          class="btn kawaru-text-87"
          :disabled="loading"
          @click="$emit('cancel')"
        >
          {{ cancelLabel ?? $t('common.action.cancel') }}
        </button>
        <button
          v-if="!hideConfirm"
          :class="['btn kawaru-text-87', danger ? 'btn-error text-white' : 'btn-primary']"
          @click="$emit('confirm')"
          :disabled="loading"
        >
          <span v-if="loading" class="loading loading-spinner loading-sm"></span>
          {{ confirmLabel ?? $t('common.action.confirm') }}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop" @click="$emit('cancel')">
      <button @click="$emit('cancel')">{{ $t('common.action.close') }}</button>
    </form>
  </dialog>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    open: boolean
    title: string
    message?: string
    confirmLabel?: string
    cancelLabel?: string
    danger?: boolean
    loading?: boolean
    hideCancel?: boolean
    hideConfirm?: boolean
  }>(),
  {
    message: '',
    // 缺省时模板里取当前语言的「确认」；withDefaults 在模块求值时就定死，不能在这里调 t()
    confirmLabel: undefined,
    danger: false,
    loading: false,
    hideCancel: false,
    hideConfirm: false,
  },
)

defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()
</script>

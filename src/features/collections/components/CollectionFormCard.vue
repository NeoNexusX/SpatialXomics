<template>
  <!-- Step 3 表单卡片：无状态——form 由父级持有，v-model:name / v-model:description
       两路绑定。Create Collection 与 overview 内嵌 Edit 共用（集合均为公开，
       无可见性开关）。 -->
  <section
    class="bg-base-100 dark:bg-slate-800 rounded-xl shadow-sm border border-base-300 p-4 sm:p-6"
  >
    <h2 class="kawaru-text-125 font-bold text-base-content mb-4">{{ $t('collections.form.step3') }}</h2>

    <div class="flex flex-col gap-4">
      <!-- 名称 -->
      <label class="flex flex-col gap-1.5">
        <span class="kawaru-text-87 font-medium text-base-content/80">
          {{ $t('common.field.name') }} <span class="text-error">*</span>
        </span>
        <input
          :value="name"
          type="text"
          :maxlength="nameMaxLength"
          class="input input-bordered w-full kawaru-text-95"
:placeholder="$t('collections.form.namePlaceholder')"
          @input="$emit('update:name', ($event.target as HTMLInputElement).value)"
        />
      </label>

      <!-- 简介（可选） -->
      <label class="flex flex-col gap-1.5">
        <span class="kawaru-text-87 font-medium text-base-content/80">
          {{ $t('collections.meta.description') }}
          <span class="font-normal text-base-content/50">{{ $t('collections.form.optional') }}</span>
        </span>
        <textarea
          :value="description"
          rows="3"
          :maxlength="descriptionMaxLength"
          class="textarea textarea-bordered w-full kawaru-text-95 resize-none"
:placeholder="$t('collections.form.descriptionPlaceholder')"
          @input="$emit('update:description', ($event.target as HTMLTextAreaElement).value)"
        ></textarea>
        <span class="text-right kawaru-text-75 text-base-content/50">
          {{ description.length }}/{{ descriptionMaxLength }}
        </span>
      </label>
    </div>
  </section>
</template>

<script setup lang="ts">
import { metadataMaxLength } from '../constants/metadataFields'

defineProps<{
  name: string
  description: string
}>()

/** 名称 / 简介的上限与编辑表单、保存前校验同源（字段定义表的 maxLength，即后端写入校验的上限） */
const nameMaxLength = metadataMaxLength('name')
const descriptionMaxLength = metadataMaxLength('description')

defineEmits<{
  (e: 'update:name', value: string): void
  (e: 'update:description', value: string): void
}>()
</script>

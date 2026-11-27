<template>
  <!-- 集合元数据编辑表单：由 metadataFields 定义表驱动（与只读面板同一张表，
       单一事实来源）。list 字段用 TagInput（带词表的字段同时有下拉建议），long 字段用 textarea，其余 input。
       草稿由父级（CollectionOverviewView / CreateCollectionView）持有并传入，
       本组件只做字段绑定与「自动推导」提示，不做提交。
       excludeKeys：创建页把 name/description 交给专门的卡片，这里不重复渲染；
       autoKeys/editedKeys：可从选中数据集推导的字段，及其中与识别值不一致（用户手改）的字段。 -->
  <div class="flex flex-col gap-5">
    <section v-for="group in METADATA_GROUPS" :key="group.id">
      <h4
        v-if="fieldsOf(group.id).length"
        class="kawaru-text-87 font-semibold uppercase tracking-wide text-base-content/50 border-b border-base-200 dark:border-slate-700 pb-1 mb-3"
      >
        {{ group.label() }}
      </h4>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        <div
          v-for="field in fieldsOf(group.id)"
          :key="field.key"
          class="flex flex-col gap-1 min-w-0"
          :class="field.type === 'long' ? 'sm:col-span-2' : ''"
        >
          <!-- list 字段不能包在 <label> 里：label 会把点击转发给首个可标注的后代，
               也就是第一个 chip 的 ✕ 按钮，点字段名就会误删标签 -->
          <component
            :is="field.type === 'list' ? 'div' : 'label'"
            class="flex flex-col gap-1 min-w-0"
          >
            <span class="kawaru-text-81 font-medium text-base-content/70">
              {{ field.label() }}
              <span v-if="field.key === 'name' || requiredKeys.includes(field.key)" class="text-error">*</span>
            </span>

            <input
              v-if="field.type === 'text'"
              v-model="d[field.key]"
              type="text"
              class="input input-bordered w-full kawaru-text-95"
              :maxlength="field.maxLength"
              :placeholder="placeholderOf(field)"
            />
            <!-- date 档位：原生日期选择器（点选录入，杜绝手输格式问题）。空值格式提示
                 跟随浏览器语言、无法定制，属可接受代价；值/草稿均为 YYYY-MM-DD（ISO 8601），
                 清空即显式置空，PATCH 会发送 null（后端对日期只认 null，空串会 422） -->
            <input
              v-else-if="field.type === 'date'"
              v-model="d[field.key]"
              type="date"
              class="input input-bordered w-full kawaru-text-95"
            />
            <!-- 长文本上限按字段取（字段定义表的 maxLength）：description 512、
                 abstract / cite_information 16000，与后端写入校验一致。
                 高度随内容增长（field-sizing-content，同 agent 的输入框），到上限后在框内滚动；
                 不支持该属性的浏览器保持 rows=2 的固定高度 -->
            <textarea
              v-else-if="field.type === 'long'"
              v-model="d[field.key]"
              rows="2"
              :maxlength="field.maxLength"
              class="textarea textarea-bordered w-full kawaru-text-95 field-sizing-content max-h-80 overflow-y-auto resize-none"
              :placeholder="placeholderOf(field)"
            ></textarea>
            <TagInput
              v-else
              v-model="d[field.key]"
              :name="field.label()"
              :options="field.options"
              :label-of="collectionVocabLabel"
              :pattern="field.pattern"
              :pattern-message="field.patternMessage?.()"
              :placeholder="placeholderOf(field)"
            />
          </component>

          <!-- 有上限的长文本显示字符计数：maxlength 会静默截断超长的粘贴，计数让截断可见。
               放在 label 之外，控件的访问名保持纯字段名 -->
          <span
            v-if="field.type === 'long' && field.maxLength"
            class="text-right kawaru-text-75 text-base-content/50"
          >
            {{ d[field.key].length }}/{{ field.maxLength }}
          </span>

          <!-- 用户接管了自动推导的字段后，给一个回到「按数据集识别」的入口 -->
          <div
            v-if="autoKeys.includes(field.key) && editedKeys.includes(field.key)"
            class="flex items-center gap-1.5 kawaru-text-75 text-base-content/50"
          >
            <span>{{ $t('collections.metaForm.editedByHand') }}</span>
            <button
              type="button"
              class="text-primary hover:underline"
              @click="emit('reset-field', field.key)"
            >
              {{ $t('collections.metaForm.resetToDetected') }}
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import TagInput from '@/shared/components/TagInput.vue'
import { collectionVocabLabel } from '../constants/collectionVocab'
import {
  METADATA_FIELDS,
  METADATA_GROUPS,
  type MetadataFieldDef,
  type MetadataGroupId,
} from '../constants/metadataFields'
import type { CollectionMetadataDraft } from '../types/collection'

interface Props {
  /** 父级持有的草稿（reactive），本组件直接绑定其字段 */
  draft: CollectionMetadataDraft
  /** 由父级另行渲染、本表单跳过的字段键 */
  excludeKeys?: readonly string[]
  /** 当前由选中数据集自动推导（预填）的字段键 */
  autoKeys?: readonly string[]
  /** 与识别值不一致（用户手改）的字段键：显示「已手动修改 / 恢复为自动识别值」 */
  editedKeys?: readonly string[]
  /** 前端必填的字段键（红 * 标注）。仅创建流程传入；编辑流程不传，维持 PATCH 全可选语义 */
  requiredKeys?: readonly string[]
}

const props = withDefaults(defineProps<Props>(), {
  excludeKeys: () => [],
  autoKeys: () => [],
  editedKeys: () => [],
  requiredKeys: () => [],
})

const emit = defineEmits<{
  (e: 'reset-field', key: string): void
}>()

// 字段定义的联合键在模板中按控件分支使用；此处只在边界统一索引类型，
// 对外 API 仍由 CollectionMetadataDraft 约束。
const d = computed(() => props.draft as Record<string, any>)

function fieldsOf(group: MetadataGroupId) {
  return METADATA_FIELDS.filter(
    (f) => f.group === group && !props.excludeKeys.includes(f.key as string),
  )
}

function placeholderOf(field: MetadataFieldDef): string | undefined {
  return field.placeholder?.()
}
</script>

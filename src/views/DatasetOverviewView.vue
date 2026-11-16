<script setup lang="ts">
import { computed } from 'vue'
import { I18nT } from 'vue-i18n'
import { t } from '@/i18n'
import { vocabLabel } from '@/features/datasets/constants/vocabLabels'
import { useDatasetDetail } from '@/features/datasets/composables/useDatasetDetail'
import ConfirmDialog from '@/shared/components/ConfirmDialog.vue'
import InfoField from '@/features/datasets/components/InfoField.vue'

const {
  source,
  isShareView,
  isStale,
  requiresAuth,
  goLogin,
  goRegister,
  dataset,
  loading,
  isShareCopied,
  ticImageUrl,
  ticImageError,
  placeholderSvg,
  formatSize,
  formatString,
  shareCurrent,
  goBack,
  downloadCurrent,
  isPacking,
  makingPublic,
  showPublicConfirm,
  openPublicConfirm,
  cancelPublicConfirm,
  confirmSetPublic,
} = useDatasetDetail()

// 下载打包中：publicId 已是字符串，dataset 为空时按空串（isPacking 恒 false）
const packing = computed(() => isPacking(dataset.value?.publicId ?? ''))

// 元信息编辑已移到 My Datasets 卡片的 Edit（Overview 只读展示）

// 状态徽章的样式与文案（completed/uploading/failed -> success/info/error，其余中性）
// key 是后端状态值；label 是 getter，在 computed 里按当前语言取
const STATUS_BADGE: Record<string, { class: string; label: () => string }> = {
  completed: {
    class: 'badge-success bg-success/10 text-success',
    label: () => t('datasets.card.uploaded'),
  },
  uploading: {
    class: 'badge-info bg-info/10 text-info',
    label: () => t('common.status.processing'),
  },
  failed: { class: 'badge-error bg-error/10 text-error', label: () => t('common.status.failed') },
}
const statusBadge = computed(() => {
  const s = dataset.value?.status ?? ''
  const entry = STATUS_BADGE[s]
  return entry
    ? { class: entry.class, label: entry.label() }
    : { class: 'badge-neutral bg-base-200 text-base-content/70', label: s || '—' }
})
</script>

<template>
  <div class="min-h-screen bg-base-200 p-4 md:p-8 font-sans kawaru-text-100">
    <div class="max-w-4xl mx-auto flex flex-col gap-6">
      <!-- 1. Top Navigation Area -->
      <div class="flex flex-col gap-2 mb-2">
        <button
          @click="goBack"
          class="btn btn-ghost btn-md sm:btn-lg kawaru-text-100 text-base-content/70 hover:bg-base-300 rounded-lg shrink-0 self-start"
        >
          <SvgIcon type="back" class="w-4 h-4 mr-1" />
          {{
            source === 'public'
              ? $t('datasets.overview.backToPublic')
              : $t('datasets.overview.backToMy')
          }}
        </button>
        <h1
          class="kawaru-text-page-title leading-[1.15] font-bold text-base-content tracking-tight"
        >
          {{ $t('datasets.overview.title') }}
        </h1>
      </div>

      <!-- Skeleton Loading State -->
      <template v-if="loading">
        <div class="space-y-6">
          <!-- Primary Card Skeleton -->
          <div
            class="card bg-base-100 rounded-2xl shadow-sm border border-base-200 p-6 flex flex-col md:flex-row gap-6"
          >
            <div class="skeleton w-24 h-24 rounded-xl shrink-0"></div>
            <div class="flex-1 space-y-4">
              <div class="skeleton h-8 w-3/4"></div>
              <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                <div class="skeleton h-10 w-full"></div>
                <div class="skeleton h-10 w-full"></div>
                <div class="skeleton h-10 w-full"></div>
                <div class="skeleton h-10 w-full"></div>
              </div>
            </div>
          </div>
          <!-- Metadata Cards Skeleton -->
          <div
            class="card bg-base-100 rounded-2xl shadow-sm border border-base-200 p-6 space-y-4"
            v-for="i in 3"
            :key="i"
          >
            <div class="skeleton h-6 w-1/4 mb-4"></div>
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
              <div class="skeleton h-10 w-full md:w-32 lg:w-48"></div>
              <div class="skeleton h-10 w-full md:w-32 lg:w-48"></div>
              <div class="skeleton h-10 w-full md:w-32 lg:w-48"></div>
            </div>
          </div>
        </div>
      </template>

      <!-- Empty Data State：匿名被 401（分享链接 / 公开列表进入）→ 登录/注册引导；其余为无效链接/无数据 -->
      <template v-else-if="!dataset">
        <div class="card bg-base-100 rounded-2xl shadow-sm border border-base-200 p-12 text-center">
          <SvgIcon
            :type="requiresAuth ? 'password' : 'duplicate'"
            class="h-12 w-12 mx-auto text-base-content/30 mb-4"
          />
          <h3 class="kawaru-text-112 font-bold text-base-content">
            {{
              requiresAuth
                ? $t('datasets.overview.loginRequired')
                : isShareView && isStale
                  ? $t('datasets.overview.invalidShare')
                  : isStale
                    ? $t('common.state.sessionLost')
                    : $t('datasets.overview.noData')
            }}
          </h3>
          <p class="text-base-content/60 mt-1">
            {{
              requiresAuth
                ? $t('datasets.overview.loginRequiredDesc')
                : isShareView && isStale
                  ? $t('datasets.overview.invalidShareDesc')
                  : isStale
                    ? $t('datasets.overview.sessionLostDesc')
                    : $t('datasets.overview.noDataDesc')
            }}
          </p>
          <!-- 登录/注册后经 redirect 回来（分享原链接，或 /s/{public_id} 永久链接） -->
          <div v-if="requiresAuth" class="mt-6 flex justify-center gap-3">
            <button class="btn btn-primary kawaru-text-95" @click="goLogin">
              {{ $t('common.action.signIn') }}
            </button>
            <button class="btn btn-outline border-base-300 kawaru-text-95" @click="goRegister">
              {{ $t('common.action.register') }}
            </button>
          </div>
        </div>
      </template>

      <!-- Content State -->
      <template v-else>
        <!-- 2. Primary Info Card -->
        <div
          class="card bg-base-100 rounded-2xl shadow-sm border border-base-200/60 p-6 flex flex-col md:flex-row gap-6"
        >
          <div
            class="w-28 h-28 md:w-36 md:h-36 bg-base-200/60 rounded-2xl flex items-center justify-center flex-shrink-0 text-base-content/50 border border-base-200 overflow-hidden"
          >
            <img
              v-if="ticImageUrl && !ticImageError"
              :src="ticImageUrl"
              :alt="dataset.filename"
              class="w-full h-full object-contain"
              @error="ticImageError = true"
            />
            <div
              v-if="!ticImageUrl || ticImageError"
              class="w-full h-full"
              v-html="placeholderSvg"
            ></div>
          </div>

          <div class="flex-1 w-full min-w-0 flex flex-col justify-center gap-2">
            <h2
              class="kawaru-text-125 md:kawaru-text-150 font-bold text-base-content truncate"
              :title="dataset.filename"
            >
              {{ dataset.filename }}
            </h2>
            <!-- 按钮行：Download / Share 恒定在左；Share 公开/私有都直接复制链接
                 （接收端需登录浏览），私有文件的 Make Public 用 ml-auto 推到行右、
                 状态徽章之前 -->
            <div class="flex flex-wrap items-center gap-2">
              <button
                @click="downloadCurrent"
                class="btn btn-sm h-8 min-h-8 btn-primary kawaru-text-75"
                :disabled="packing"
              >
                <span v-if="packing" class="loading loading-spinner loading-xs"></span>
                <SvgIcon v-else type="download" class="w-4 h-4" />
                {{ packing ? $t('datasets.card.packing') : $t('common.action.download') }}
              </button>
              <button
                @click="shareCurrent"
                class="btn btn-sm h-8 min-h-8 border shadow-sm transition-shadow hover:shadow-md kawaru-text-75"
                :class="
                  isShareCopied
                    ? 'border-success/30 bg-success/10 text-success hover:border-success/40 hover:bg-success/20'
                    : 'border-info/30 bg-info/10 text-info hover:border-info/50 hover:bg-info/20'
                "
              >
                <SvgIcon :type="isShareCopied ? 'check' : 'share'" class="w-4 h-4" />
                {{ isShareCopied ? $t('datasets.overview.linkCopied') : $t('common.action.share') }}
              </button>
              <button
                v-if="source === 'my' && !dataset.isPublic"
                @click="openPublicConfirm"
                class="btn btn-sm h-8 min-h-8 btn-outline btn-warning kawaru-text-75 ml-auto"
              >
                <SvgIcon type="region" class="w-4 h-4" />
                {{ $t('datasets.overview.makePublic') }}
              </button>
              <div
                class="badge badge-soft h-8 min-h-8 shrink-0 inline-flex items-center justify-center border-0 px-3 py-0 font-medium kawaru-text-87"
                :class="[
                  statusBadge.class,
                  !(source === 'my' && !dataset.isPublic) ? 'ml-auto' : '',
                ]"
              >
                {{ statusBadge.label }}
              </div>
            </div>
          </div>
        </div>

        <!-- 3. Biological & Sample Info -->
        <div class="card bg-base-100 rounded-2xl shadow-sm border border-base-200/60 p-6">
          <h3 class="kawaru-text-112 font-bold text-base-content mb-4 flex items-center gap-2">
            {{ $t('datasets.overview.sampleInfo') }}
          </h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
            <InfoField :label="$t('common.meta.organism')">{{
              formatString(dataset?.organism)
            }}</InfoField>
            <InfoField :label="$t('common.meta.organismPart')">{{
              formatString(dataset?.organismPart)
            }}</InfoField>
            <InfoField :label="$t('common.meta.condition')">{{
              formatString(dataset?.condition)
            }}</InfoField>
            <InfoField :label="$t('common.meta.growthConditions')">{{
              formatString(dataset?.sampleGrowthConditions)
            }}</InfoField>
            <InfoField :label="$t('datasets.field.stabilization')">{{
              formatString(dataset?.sampleStabilization)
            }}</InfoField>
            <InfoField :label="$t('common.meta.tissueModification')">{{
              formatString(dataset?.tissueModification)
            }}</InfoField>
          </div>
        </div>

        <!-- 5. MSI Analysis Settings -->
        <div class="card bg-base-100 rounded-2xl shadow-sm border border-base-200/60 p-6">
          <h3 class="kawaru-text-112 font-bold text-base-content mb-4 flex items-center gap-2">
            {{ $t('datasets.overview.msiSettings') }}
          </h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
            <InfoField :label="$t('common.meta.polarity')">{{
              vocabLabel(dataset?.polarity) || '—'
            }}</InfoField>
            <InfoField :label="$t('common.meta.ionisationSource')">{{
              vocabLabel(dataset?.ionSource) || '—'
            }}</InfoField>
            <InfoField :label="$t('common.meta.analyzer')">{{
              vocabLabel(dataset?.analyzer) || '—'
            }}</InfoField>
            <InfoField :label="$t('common.meta.pixelSize')">
              <template
                v-if="dataset?.pixelSizeHorizontal != null || dataset?.pixelSizeVertical != null"
              >
                {{ dataset?.pixelSizeHorizontal ?? '—' }} ×
                {{ dataset?.pixelSizeVertical ?? '—' }} μm
              </template>
              <template v-else>—</template>
            </InfoField>
            <InfoField :label="$t('common.meta.resolvingPower')">
              <I18nT
                v-if="dataset?.mz != null || dataset?.resolvingPower != null"
                keypath="datasets.overview.resolvingPowerAt"
                scope="global"
              >
                <template #mzLabel><i>m/z</i></template>
                <template #mz>{{ dataset?.mz ?? '—' }}</template>
                <template #rp>{{ dataset?.resolvingPower ?? '—' }}</template>
              </I18nT>
              <template v-else>—</template>
            </InfoField>
            <InfoField :label="$t('datasets.field.matrix')">{{
              formatString(dataset?.maldiMatrix)
            }}</InfoField>
            <InfoField :label="$t('datasets.field.matrixApplication')">{{
              formatString(dataset?.maldiMatrixApplication)
            }}</InfoField>
            <InfoField :label="$t('common.meta.solvent')">{{
              formatString(dataset?.solvent)
            }}</InfoField>
          </div>
        </div>

        <!-- 6. File Information -->
        <div class="card bg-base-100 rounded-2xl shadow-sm border border-base-200/60 p-6">
          <h3 class="kawaru-text-112 font-bold text-base-content mb-4 flex items-center gap-2">
            {{ $t('datasets.overview.fileInfo') }}
          </h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
            <InfoField :label="$t('datasets.field.fileType')">{{
              dataset?.fileType || '—'
            }}</InfoField>
            <InfoField :label="$t('datasets.field.experimentType')">{{
              vocabLabel(dataset?.experimentType) || '—'
            }}</InfoField>
            <InfoField :label="$t('datasets.field.size')">{{
              formatSize(dataset?.sizeBytes)
            }}</InfoField>
            <InfoField :label="$t('common.meta.spectrumMode')">{{
              dataset?.spectrumMode || '—'
            }}</InfoField>
            <InfoField :label="$t('common.meta.storageMode')">{{
              dataset?.storageMode || '—'
            }}</InfoField>
            <InfoField :label="$t('datasets.field.submittedBy')">{{
              dataset?.submitter || dataset?.raw?.first_uploaded_by || '—'
            }}</InfoField>
          </div>
        </div>
      </template>

      <!-- Make Public Confirmation Dialog -->
      <ConfirmDialog
        :open="showPublicConfirm"
        :title="$t('datasets.overview.publicTitle')"
        :message="$t('datasets.overview.publicMessage')"
        :confirm-label="$t('datasets.overview.makePublic')"
        :danger="true"
        :loading="makingPublic"
        @confirm="confirmSetPublic"
        @cancel="cancelPublicConfirm"
      />
    </div>
  </div>
</template>

<style scoped>
/* Hidden inputs logic & drawer animations handled automatically by daisyUI */
</style>

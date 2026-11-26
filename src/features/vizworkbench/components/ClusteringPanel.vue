<script setup lang="ts">
/**
 * UMAP / KMeans clustering: the opt-in task switch, the UMAP and KMeans
 * overlays with their opacity and PNG export, and the local KMeans run (k and
 * an optional ROI scope) with its cluster picker.
 */
import { computed, ref, shallowRef, watch } from 'vue'
import SvgIcon from '@/shared/components/SvgIcon.vue'
import ConfirmDialog from '@/shared/components/ConfirmDialog.vue'
import SectionHelp from '@/features/vizworkbench/components/SectionHelp.vue'
import type { ClusteringState } from '@/features/vizworkbench/composables/useOverlayData'
import type { ConfirmedROI } from '@/features/vizworkbench/composables/useROI'

const props = defineProps<{
  /** UMAP task status, overlays and local KMeans. */
  clustering: ClusteringState
  /** Saved ROIs a KMeans run can be restricted to. */
  rois: ConfirmedROI[]
}>()

// UMAP/KMeans overlays are opt-in: buttons stay grayed out until the user
// flips this switch. First-time enabling asks for confirmation (it starts a
// backend clustering task); re-enabling an existing task does not.
const computationEnabled = ref(false)
const showConfirm = ref(false)
const toggleRef = ref<HTMLInputElement | null>(null)

// KMeans is computed locally with the k from the inline stepper: the KMeans
// button computes on first use and toggles the cached result afterwards;
// choosing another k goes through the stepper's Compute button.
const K_MIN = 2
const K_MAX = 20
const K_DEFAULT = 5

/** Raw stepper value; '' while the number field is cleared. */
const kDraft = shallowRef<number | ''>(K_DEFAULT)

function clampK(k: number): number {
  return Math.min(K_MAX, Math.max(K_MIN, Math.round(k)))
}

/** The k a run would use: the draft snapped into range, or the applied k
 *  while the field is empty. */
const kTarget = computed(() => {
  const raw = kDraft.value
  return raw === '' || !Number.isFinite(raw) ? (props.clustering.kmeansK ?? K_DEFAULT) : clampK(raw)
})

/** ROI that the next run clusters inside; null (the default) clusters every pixel. */
const kmeansScopeId = shallowRef<string | null>(null)
const kmeansScopeRoi = computed(
  () => props.rois.find((roi) => roi.id === kmeansScopeId.value) ?? null,
)
// ROI ids restart after "Clear all", so drop the choice once its ROI object is gone.
watch(
  () => props.rois,
  (rois, previous) => {
    const chosen = previous.find((roi) => roi.id === kmeansScopeId.value)
    if (chosen && !rois.includes(chosen)) kmeansScopeId.value = null
  },
)

// Re-running the applied k and scope is disabled: the seed is fixed, so it
// would only reset the region comparison and the cluster selection.
const canRunKmeans = computed(
  () =>
    (kTarget.value !== props.clustering.kmeansK ||
      (kmeansScopeRoi.value?.mask ?? null) !== (props.clustering.kmeansScope?.mask ?? null)) &&
    !props.clustering.kmeansComputing &&
    !props.clustering.overlayLoading,
)

const kmeansRunClass = computed(() => {
  if (props.clustering.kmeansComputing) return 'bg-rose-400 text-white border-rose-400'
  return canRunKmeans.value
    ? 'bg-rose-500 hover:bg-rose-600 text-white border-rose-500 hover:border-rose-600'
    : 'bg-transparent text-rose-900/40 dark:text-rose-100/40 border-transparent'
})

const K_STEP_CLASS =
  'btn btn-xs btn-square join-item shadow-none bg-base-100 border-rose-200 text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:text-rose-200 dark:hover:bg-rose-900/50 disabled:opacity-40'

function stepK(delta: number) {
  kDraft.value = clampK(kTarget.value + delta)
}

/** Blur / Enter: show the k that would actually run. */
function commitK() {
  kDraft.value = kTarget.value
}

function runKmeans() {
  commitK()
  if (canRunKmeans.value) props.clustering.runKmeans(kTarget.value, kmeansScopeRoi.value)
}

function onKmeansClick() {
  if (props.clustering.kmeansVisible || props.clustering.kmeansK !== null) {
    // A result already exists (or is showing) - plain toggle.
    props.clustering.toggleOverlay('kmeans')
    return
  }
  runKmeans()
}

// Recover the enable state when the task turns out ready - either from the
// page-entry probe (a finished task already existed) or from a Refresh that
// found completion. No confirmation needed: no new compute is triggered.
watch(
  () => props.clustering.clusteringReady,
  (ready) => {
    if (ready) computationEnabled.value = true
  },
)

function isClusterSelected(id: number): boolean {
  return props.clustering.selectedKmeansIds === null || props.clustering.selectedKmeansIds.has(id)
}

const selectedClusterCount = computed(() =>
  props.clustering.selectedKmeansIds === null
    ? props.clustering.kmeansClusters.length
    : props.clustering.selectedKmeansIds.size,
)

function onToggleComputation(e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  if (checked) {
    if (props.clustering.clusteringReady || props.clustering.clusteringComputing) {
      // The task already exists - enabling only reads data/status, so skip
      // the compute-cost confirmation.
      computationEnabled.value = true
    } else {
      // First-time creation: warn before starting the backend task.
      showConfirm.value = true
    }
  } else {
    computationEnabled.value = false
    // Clear any active overlays when the user opts out.
    if (props.clustering.umapVisible) props.clustering.toggleOverlay('umap')
    if (props.clustering.kmeansVisible) props.clustering.toggleOverlay('kmeans')
  }
}

function confirmEnable() {
  computationEnabled.value = true
  showConfirm.value = false
  // Kick off task creation immediately on confirm; the toast + status rows
  // are driven by the composable in response to this.
  void props.clustering.createClusteringTask()
}

function cancelEnable() {
  computationEnabled.value = false
  showConfirm.value = false
  // The toggle was never committed, so revert its visual state manually —
  // :checked won't re-apply because computationEnabled is unchanged.
  if (toggleRef.value) toggleRef.value.checked = false
}
</script>

<template>
  <div>
    <!-- The task status and the KMeans k row share the slot under the buttons,
         so a finished UMAP task swaps one strip for the other without shifting
         the panel. -->
    <div class="mt-1 flex flex-col gap-2">
      <label
        class="flex items-center justify-between cursor-pointer select-none kawaru-text-75"
        :class="{ 'opacity-60 pointer-events-none': clustering.clusteringCreating }"
      >
        <span class="text-base-content">{{ $t('vizworkbench.overlay.enable') }}</span>
        <input
          ref="toggleRef"
          type="checkbox"
          class="toggle toggle-sm toggle-primary"
          :checked="computationEnabled"
          :disabled="clustering.clusteringCreating"
          @change="onToggleComputation"
        />
      </label>

      <div class="flex gap-2">
        <button
          class="btn btn-sm flex-1 kawaru-text-68 rounded-lg transition-colors"
          :class="
            !computationEnabled || !clustering.clusteringReady
              ? 'bg-base-200 dark:bg-base-300 text-base-content/40 border-base-300 dark:border-base-400 cursor-not-allowed'
              : clustering.umapVisible
                ? 'bg-teal-500 text-white border-teal-500'
                : 'bg-teal-100 dark:bg-teal-950 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800 hover:bg-teal-200 dark:hover:bg-teal-900'
          "
          :disabled="
            !computationEnabled ||
            !clustering.clusteringReady ||
            clustering.overlayLoading ||
            clustering.clusteringCreating
          "
          @click="clustering.toggleOverlay('umap')"
        >
          UMAP
        </button>
        <button
          class="btn btn-sm flex-1 kawaru-text-68 rounded-lg transition-colors"
          :class="
            !computationEnabled || !clustering.clusteringReady
              ? 'bg-base-200 dark:bg-base-300 text-base-content/40 border-base-300 dark:border-base-400 cursor-not-allowed'
              : clustering.kmeansVisible
                ? 'bg-rose-500 text-white border-rose-500'
                : 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800 hover:bg-rose-200 dark:hover:bg-rose-900'
          "
          :disabled="
            !computationEnabled ||
            !clustering.clusteringReady ||
            clustering.overlayLoading ||
            clustering.clusteringCreating ||
            clustering.kmeansComputing
          "
          @click="onKmeansClick"
        >
          KMeans
        </button>
      </div>

      <!-- UMAP task status: teal like the UMAP button -->
      <div
        v-if="
          clustering.clusteringCreating ||
          (clustering.clusteringComputing && !clustering.clusteringReady)
        "
        class="flex items-center gap-2 rounded-lg px-2.5 py-1.5 bg-teal-50 text-teal-800 dark:bg-teal-950/50 dark:text-teal-200"
      >
        <span class="loading loading-spinner loading-xs shrink-0"></span>
        <span class="flex-1 min-w-0 truncate">{{
          clustering.clusteringCreating
            ? $t('vizworkbench.overlay.creating')
            : $t('vizworkbench.overlay.computing')
        }}</span>
        <button
          v-if="!clustering.clusteringCreating"
          type="button"
          class="btn btn-ghost btn-xs gap-1 shrink-0 kawaru-text-62 text-teal-700 hover:bg-teal-100 hover:border-transparent dark:text-teal-200 dark:hover:bg-teal-900/60"
          :disabled="clustering.clusteringRefreshing"
          @click="clustering.refreshClusteringStatus()"
        >
          <span
            v-if="clustering.clusteringRefreshing"
            class="loading loading-spinner loading-xs"
          ></span>
          <SvgIcon v-else type="refresh" />
          {{ $t('common.action.refresh') }}
        </button>
      </div>
      <!-- KMeans k and scope: rose like the KMeans button -->
      <div
        v-else-if="computationEnabled && clustering.clusteringReady"
        class="flex flex-col gap-1.5 rounded-lg px-2.5 py-1.5 bg-rose-50 dark:bg-rose-950/40"
      >
        <div class="flex items-center gap-2">
          <div class="flex flex-1 min-w-0 items-center gap-1">
            <span class="truncate text-rose-900/80 dark:text-rose-100/80">
              {{ $t('vizworkbench.overlay.kLabel') }}
            </span>
            <SectionHelp :label="$t('vizworkbench.overlay.kLabel')">
              {{ $t('vizworkbench.overlay.kHint', { min: K_MIN, max: K_MAX }) }}
            </SectionHelp>
          </div>
          <div class="join shrink-0">
            <button
              type="button"
              :class="K_STEP_CLASS"
              :aria-label="$t('vizworkbench.overlay.kDecrease')"
              :disabled="clustering.kmeansComputing || kTarget <= K_MIN"
              @click="stepK(-1)"
            >
              <SvgIcon type="minus" />
            </button>
            <!-- daisyUI 的 .input-xs 给隐藏的微调箭头留了 -0.75rem 右外边距，px-0 时会把
                 数字挤偏右，所以箭头的外边距要清零 -->
            <input
              v-model.number="kDraft"
              type="number"
              inputmode="numeric"
              :min="K_MIN"
              :max="K_MAX"
              step="1"
              class="input input-xs join-item w-10 px-0 text-center font-mono kawaru-text-68 border-rose-200 dark:border-rose-800 focus:outline-rose-400 focus:outline-offset-0 [appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              :aria-label="$t('vizworkbench.overlay.kLabel')"
              :disabled="clustering.kmeansComputing"
              @change="commitK"
              @keydown.enter.prevent="runKmeans"
            />
            <button
              type="button"
              :class="K_STEP_CLASS"
              :aria-label="$t('vizworkbench.overlay.kIncrease')"
              :disabled="clustering.kmeansComputing || kTarget >= K_MAX"
              @click="stepK(1)"
            >
              <SvgIcon type="plus" />
            </button>
          </div>
          <button
            type="button"
            class="btn btn-xs shrink-0 shadow-none kawaru-text-62"
            :class="kmeansRunClass"
            :disabled="!canRunKmeans"
            @click="runKmeans"
          >
            <span
              v-if="clustering.kmeansComputing"
              class="loading loading-spinner loading-xs"
            ></span>
            {{ $t('vizworkbench.overlay.compute') }}
          </button>
        </div>
        <div v-if="rois.length" class="flex items-center gap-2">
          <div class="flex flex-1 min-w-0 items-center gap-1">
            <span class="truncate text-rose-900/80 dark:text-rose-100/80">
              {{ $t('vizworkbench.overlay.kmeansScope') }}
            </span>
            <SectionHelp :label="$t('vizworkbench.overlay.kmeansScope')">
              {{ $t('vizworkbench.overlay.kmeansScopeHint') }}
            </SectionHelp>
          </div>
          <select
            v-model="kmeansScopeId"
            class="select select-xs w-34 shrink-0 kawaru-text-62 border-rose-200 dark:border-rose-800 focus:outline-rose-400 focus:outline-offset-0"
            :aria-label="$t('vizworkbench.overlay.kmeansScope')"
            :disabled="clustering.kmeansComputing"
          >
            <option :value="null">{{ $t('vizworkbench.overlay.kmeansScopeAll') }}</option>
            <option v-for="roi in rois" :key="roi.id" :value="roi.id">
              {{ roi.label }}
            </option>
          </select>
        </div>
      </div>

      <div
        v-if="clustering.overlayLoading && computationEnabled"
        class="text-base-content/60 flex items-center gap-1"
      >
        <span class="loading loading-spinner loading-xs"></span>
        {{ $t('vizworkbench.overlay.loading') }}
      </div>

      <div v-if="clustering.overlayError" class="text-error flex items-center gap-2">
        <span class="flex-1">{{ $t('vizworkbench.overlay.unavailable') }}</span>
        <button
          class="btn btn-ghost btn-sm text-error kawaru-text-62"
          @click="clustering.retryClustering()"
        >
          {{ $t('common.action.retry') }}
        </button>
      </div>
    </div>

    <!-- Overlay opacity: one slider per active overlay -->
    <div v-if="clustering.umapVisible" class="mt-3">
      <div class="flex items-center justify-between font-semibold text-base-content mb-1">
        <span>{{ $t('vizworkbench.overlay.umapOpacity') }}</span>
        <span class="font-mono font-normal">{{ Math.round(clustering.umapAlpha / 2.55) }}%</span>
      </div>
      <input
        type="range"
        :min="0"
        :max="255"
        :value="clustering.umapAlpha"
        class="range range-sm w-full [--range-fill:0] [--range-thumb:bg-teal-400] [--range-bg:theme(colors.teal.100)] dark:[--range-bg:theme(colors.teal.900)]"
        @input="clustering.setOverlayAlpha('umap', +($event.target as HTMLInputElement).value)"
      />
      <button
        class="btn btn-sm btn-ghost gap-1 mt-1.5 w-full kawaru-text-62"
        :title="$t('vizworkbench.overlay.exportUmapHint')"
        @click="clustering.exportUmapPng()"
      >
        <SvgIcon type="download" />
        {{ $t('vizworkbench.overlay.exportUmap') }}
      </button>
    </div>
    <div v-if="clustering.kmeansVisible" class="mt-3">
      <div class="flex items-center justify-between font-semibold text-base-content mb-1">
        <span>
          {{ $t('vizworkbench.overlay.kmeansOpacity') }}
          <span
            v-if="clustering.kmeansK !== null"
            class="ml-1.5 font-mono font-normal text-base-content/60"
            >(k={{ clustering.kmeansK }})</span
          >
        </span>
        <span class="font-mono font-normal">{{ Math.round(clustering.kmeansAlpha / 2.55) }}%</span>
      </div>
      <p
        v-if="clustering.kmeansScope"
        data-testid="kmeans-scope"
        class="-mt-0.5 mb-1 truncate text-base-content/60"
        :title="clustering.kmeansScope.label"
      >
        {{ $t('vizworkbench.overlay.kmeansScope') }} · {{ clustering.kmeansScope.label }}
      </p>
      <input
        type="range"
        :min="0"
        :max="255"
        :value="clustering.kmeansAlpha"
        class="range range-sm w-full [--range-fill:0] [--range-thumb:bg-rose-400] [--range-bg:theme(colors.rose.100)] dark:[--range-bg:theme(colors.rose.900)]"
        @input="clustering.setOverlayAlpha('kmeans', +($event.target as HTMLInputElement).value)"
      />
      <button
        class="btn btn-sm btn-ghost gap-1 mt-1.5 w-full kawaru-text-62"
        :title="$t('vizworkbench.overlay.exportKmeansHint')"
        @click="clustering.exportKmeansPng()"
      >
        <SvgIcon type="download" />
        {{ $t('vizworkbench.overlay.exportKmeans') }}
      </button>

      <!-- Cluster picker: also drives the export mask -->
      <div
        v-if="clustering.kmeansClusters.length"
        class="mt-2 pt-2 border-t border-base-content/15"
      >
        <h3 class="kawaru-text-75 font-semibold text-base-content mb-1">
          {{ $t('vizworkbench.overlay.clusters') }}
          <span class="font-mono font-normal text-base-content/60">
            {{ selectedClusterCount }}/{{ clustering.kmeansClusters.length }}
          </span>
        </h3>
        <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 max-h-48 overflow-y-auto">
          <label
            v-for="c in clustering.kmeansClusters"
            :key="c.id"
            class="flex items-center gap-1.5 py-1 cursor-pointer select-none kawaru-text-75"
          >
            <input
              type="checkbox"
              class="checkbox checkbox-xs checkbox-primary"
              :checked="isClusterSelected(c.id)"
              @change="clustering.toggleKmeansCluster(c.id)"
            />
            <span
              class="w-3 h-3 rounded-sm border border-base-content/30 shrink-0"
              :style="{ backgroundColor: `rgb(${c.color[0]},${c.color[1]},${c.color[2]})` }"
            ></span>
            <span class="text-base-content truncate">{{
              $t('vizworkbench.kmeans.cluster', { id: c.id })
            }}</span>
          </label>
        </div>
        <div class="flex gap-2 mt-2">
          <button
            class="btn btn-ghost btn-sm flex-1 kawaru-text-62"
            @click="clustering.selectAllKmeansClusters()"
          >
            {{ $t('vizworkbench.mask.all') }}
          </button>
          <button
            class="btn btn-ghost btn-sm flex-1 kawaru-text-62"
            @click="clustering.clearKmeansClusters()"
          >
            {{ $t('common.action.clear') }}
          </button>
        </div>
      </div>
      <div
        v-else-if="!clustering.kmeansLabelsAvailable"
        class="mt-2 pt-2 border-t border-base-content/15 text-base-content/50"
      >
        {{ $t('vizworkbench.overlay.runHint') }}
      </div>
    </div>

    <!-- Opt-in confirmation: first-time enable starts a backend clustering task -->
    <Teleport to="body">
      <ConfirmDialog
        v-if="showConfirm"
        open
        :title="$t('vizworkbench.overlay.umapTitle')"
        :message="$t('vizworkbench.overlay.umapMessage')"
        :confirm-label="$t('vizworkbench.overlay.continue')"
        @confirm="confirmEnable"
        @cancel="cancelEnable"
      />
    </Teleport>
  </div>
</template>

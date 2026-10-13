<script setup lang="ts">
/**
 * Modal dialog showing PubChem compound lookup results.
 *
 * Triggered from the annotation table's "PubChem" button or from the tooltip.
 * Displays the 2D structure image, CID, name, molecular formula, weight,
 * IUPAC name, SMILES, InChIKey, InChI, and a link to the full PubChem page.
 *
 * Results are cached per compound name in the API client, so repeated clicks
 * on the same name are instant and rate-limit-friendly.
 */
import { ref, watch } from 'vue'
import SvgIcon from '@/shared/components/SvgIcon.vue'
import { searchPubChemByName } from '@/services/pubchem/api/pubchemApi'
import { PubChemNotFoundError, type PubChemCompound } from '@/services/pubchem/types/pubchem'
import { t } from '@/i18n'

const props = defineProps<{
  open: boolean
  /** Compound name to look up (typically the annotation row's first candidate). */
  query: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const loading = ref(false)
const error = ref<string | null>(null)
const result = ref<PubChemCompound | null>(null)
const imageError = ref(false)

async function runQuery() {
  const query = props.query.trim()
  if (!query) return
  loading.value = true
  error.value = null
  result.value = null
  imageError.value = false
  try {
    result.value = await searchPubChemByName(query)
  } catch (e) {
    if (e instanceof PubChemNotFoundError) {
      // If the name has parenthetical content (e.g. "Glutathione (GSH)"),
      // retry with the parentheses stripped ("Glutathione") before giving up.
      const stripped = query.replace(/\s*\([^)]*\)/g, '').trim()
      if (stripped && stripped !== query) {
        try {
          result.value = await searchPubChemByName(stripped)
          return
        } catch {
          // Both original and stripped failed - fall through to show error.
        }
      }
      // 服务层抛的是英文报错，未命中是可预期的业务结果，在界面层换成当前语言
      error.value = t('vizworkbench.pubchem.notFound', { query })
    } else {
      error.value = e instanceof Error ? e.message : String(e)
    }
  } finally {
    loading.value = false
  }
}

// Fetch whenever the dialog opens with a query.
watch(
  () => props.open,
  (open) => {
    if (open && props.query.trim()) {
      void runQuery()
    }
    if (!open) {
      // Reset image error state when closing so a re-open gets a fresh attempt.
      imageError.value = false
    }
  },
  { immediate: true },
)

/** Copy text to clipboard with a fallback for non-secure contexts. */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Fallback: select-and-copy via a temporary textarea
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
    } catch {
      /* ignore */
    }
    document.body.removeChild(ta)
  }
}
</script>

<template>
  <dialog class="modal" :class="{ 'modal-open': open }">
    <div class="modal-box max-w-2xl">
      <!-- Header -->
      <div class="flex items-start justify-between gap-2 mb-3">
        <div class="min-w-0">
          <h3 class="kawaru-text-95 font-bold flex items-center gap-2">
            <SvgIcon type="search" class="w-6 h-6 text-primary" />
            {{ $t('vizworkbench.pubchem.title') }}
          </h3>
        </div>
        <button class="btn btn-ghost btn-sm btn-square kawaru-text-75" @click="emit('close')">
          <SvgIcon type="close" class="w-6 h-6" />
        </button>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="py-12 flex flex-col items-center gap-3">
        <span class="loading loading-spinner loading-lg text-primary"></span>
        <p class="kawaru-text-81 text-base-content/60">
          {{ $t('vizworkbench.pubchem.searching') }}
        </p>
      </div>

      <!-- Error / no results -->
      <div v-else-if="error" class="py-8 text-center">
        <SvgIcon type="warning" class="w-10 h-10 text-warning mx-auto mb-2" />
        <p class="kawaru-text-81 text-base-content/70">{{ error }}</p>
      </div>

      <!-- Result -->
      <div v-else-if="result" class="space-y-4">
        <!-- Structure image + basic info：手机端上下堆叠，避免 240px 固定宽的图挤爆信息列 -->
        <div class="flex flex-col sm:flex-row gap-5">
          <!-- 2D structure -->
          <div
            class="w-full h-52 sm:shrink-0 sm:w-72 sm:h-72 rounded-lg border border-base-300 bg-white flex items-center justify-center overflow-hidden"
          >
            <img
              v-if="!imageError"
              :src="result.structureImageUrl"
              :alt="result.title"
              class="w-full h-full object-contain"
              @error="imageError = true"
            />
            <div v-else class="kawaru-text-95 text-base-content/40 text-center px-2">
              {{ $t('vizworkbench.pubchem.imageUnavailable') }}
            </div>
          </div>

          <!-- Name + formula + weight + CID + link -->
          <div class="flex-1 min-w-0 space-y-3">
            <!-- CID + PubChem link on their own row above the name; name then gets
                 the full column width (one line, truncate with hover title instead
                 of being squeezed into a narrow wrap column) -->
            <div class="flex items-center justify-between gap-2">
              <span class="badge badge-primary kawaru-text-75">CID {{ result.cid }}</span>
              <a
                :href="result.pubchemUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-ghost btn-sm gap-1 text-primary kawaru-text-75"
              >
                <SvgIcon type="share" />
                PubChem
              </a>
            </div>
            <div class="min-w-0">
              <p class="kawaru-text-81 text-base-content/60">{{ $t('common.field.name') }}</p>
              <p
                class="font-semibold kawaru-text-95 text-base-content truncate"
                :title="result.title"
              >
                {{ result.title || '-' }}
              </p>
            </div>
            <div>
              <p class="kawaru-text-81 text-base-content/60">
                {{ $t('vizworkbench.pubchem.formula') }}
              </p>
              <p class="font-mono kawaru-text-95 break-words">
                {{ result.molecularFormula || '-' }}
              </p>
            </div>
            <div>
              <p class="kawaru-text-95 text-base-content/60">
                {{ $t('vizworkbench.pubchem.weight') }}
              </p>
              <p class="font-mono kawaru-text-95">
                {{ result.molecularWeight ? result.molecularWeight.toFixed(2) : '-' }}
              </p>
            </div>
            <div>
              <p class="kawaru-text-95 text-base-content/60">
                {{ $t('vizworkbench.pubchem.query') }}
              </p>
              <p class="font-mono font-semibold kawaru-text-95 text-base-content break-words">
                {{ query }}
              </p>
            </div>
          </div>
        </div>

        <!-- Property table -->
        <div class="rounded-lg border border-base-300 overflow-hidden">
          <table class="table table-sm">
            <tbody>
              <tr>
                <td class="font-medium kawaru-text-81 text-base-content/70 w-32 align-top">
                  {{ $t('vizworkbench.pubchem.iupacName') }}
                </td>
                <td class="kawaru-text-81 break-words">{{ result.iupacName || '-' }}</td>
                <td class="text-right">
                  <button
                    v-if="result.iupacName"
                    class="btn btn-ghost btn-xs btn-square kawaru-text-68"
                    :title="$t('vizworkbench.pubchem.copy')"
                    @click="copyText(result.iupacName)"
                  >
                    <SvgIcon type="duplicate" />
                  </button>
                </td>
              </tr>
              <tr>
                <td class="font-medium kawaru-text-81 text-base-content/70 align-top">SMILES</td>
                <td class="kawaru-text-81 break-all select-text">{{ result.smiles || '-' }}</td>
                <td class="text-right">
                  <button
                    v-if="result.smiles"
                    class="btn btn-ghost btn-xs btn-square kawaru-text-68"
                    :title="$t('vizworkbench.pubchem.copy')"
                    @click="copyText(result.smiles)"
                  >
                    <SvgIcon type="duplicate" />
                  </button>
                </td>
              </tr>
              <tr>
                <td class="font-medium kawaru-text-81 text-base-content/70 align-top">InChIKey</td>
                <td class="kawaru-text-81 break-all select-text">{{ result.inchiKey || '-' }}</td>
                <td class="text-right">
                  <button
                    v-if="result.inchiKey"
                    class="btn btn-ghost btn-xs btn-square kawaru-text-68"
                    :title="$t('vizworkbench.pubchem.copy')"
                    @click="copyText(result.inchiKey)"
                  >
                    <SvgIcon type="duplicate" />
                  </button>
                </td>
              </tr>
              <tr>
                <td class="font-medium kawaru-text-81 text-base-content/70 align-top">InChI</td>
                <td class="kawaru-text-81 break-all select-text">{{ result.inchi || '-' }}</td>
                <td class="text-right">
                  <button
                    v-if="result.inchi"
                    class="btn btn-ghost btn-xs btn-square kawaru-text-68"
                    :title="$t('vizworkbench.pubchem.copy')"
                    @click="copyText(result.inchi)"
                  >
                    <SvgIcon type="duplicate" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Empty (shouldn't normally happen) -->
      <div v-else class="py-8 text-center text-base-content/50">
        {{ $t('vizworkbench.pubchem.noResults') }}
      </div>

      <!-- Footer -->
      <div class="modal-action">
        <button class="btn btn-sm kawaru-text-75" @click="emit('close')">
          {{ $t('common.action.close') }}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop" @click="emit('close')">
      <button>{{ $t('common.action.close') }}</button>
    </form>
  </dialog>
</template>

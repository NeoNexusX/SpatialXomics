import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { listFiles } from '@/features/datasets/api/datasetApi'
import { useDatasetList } from '@/features/datasets/composables/useDatasetList'
import type { File } from '@/features/datasets/types/dataset'
import { useToast } from '@/shared/composables/useToast'
import { collectionErrorMessage, createCollection } from '../api/collectionApi'
import { DERIVED_METADATA_KEYS } from '../utils/deriveCollectionMetadata'
import { METADATA_FIELDS, hasMetadataValue } from '../constants/metadataFields'
import { buildCollectionCreatePayload, toMetadataDraft } from '../utils/metadataPatch'
import type { CollectionMetadataDraft } from '../types/collection'
import { useDerivedMetadataSync } from './useDerivedMetadataSync'
import { useOrderedSelection } from './useOrderedSelection'
import { t } from '@/i18n'

/**
 * Create Collection 页装配（/collections/new）。
 *
 * 三个来源的状态：
 * 1. 选择器 —— useDatasetList 直连公开列表（listFiles(..., true) 免登录 client），
 *    固定过滤 experiment_type=imzML + status=completed（集合成员资格的服务端前置校验，
 *    规避保存时 409 invalid collection members），300ms 防抖搜索（filename 键）；
 * 2. 已选列表 —— useOrderedSelection，独立于分页/搜索的 datasets ref，
 *    跨页选择天然持久；reorder 就是移动这个数组；
 * 3. 表单 —— name/description（集合均为公开，无可见性开关）。
 *
 * 保存调 POST /collections（file_public_ids 顺序 = position 1..n），成功后跳转新集合的
 * overview 页。脏态离开时弹 ConfirmDialog——promise 式 onBeforeRouteLeave 守卫：
 * 确认 resolve(true) 放行，取消 resolve(false) 留在页面。
 */
export function useCreateCollection() {
  const router = useRouter()
  const { showToast } = useToast()

  // ---- 1) 选择器：可加入集合的公开 imzML 数据集（已完成上传）----
  // applyFilters 是 Object.assign 合并语义，搜索只改 filename，固定键不会被冲掉
  const {
    datasets: rawDatasets,
    loading,
    error,
    meta,
    size,
    pagination,
    fetchFiles,
    applyFilters,
    goToPage,
    changeSize,
  } = useDatasetList((filters, page, size) => listFiles(filters, page, size, true), {
    defaultFilters: {
      filename: '',
      experiment_type: 'imzML',
    },
  })

  // 后端 list_files 的筛选参数不含 status（已确认），completed 只能前端兜底过滤，
  // 避免把 uploading/failed 的文件选进集合后在保存时撞 409。
  // 注意 meta 仍是后端未过滤的总数，极端情况下分页条与实际行数会略有出入。
  const datasets = computed(() => rawDatasets.value.filter((d) => d.status === 'completed'))

  const datasetQuery = ref('')

  // 防抖服务器端搜索。过滤键与数据集列表页一致用 filename（不是 name）。
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const runSearch = (query: string) => {
    applyFilters({ filename: query.trim() })
    fetchFiles({ page: 1, size: size.value }).catch(() => {})
  }
  watch(datasetQuery, (query) => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => runSearch(query), 300)
  })

  // 卸载时清掉 pending 的防抖搜索，避免在已销毁页面上发请求
  onBeforeUnmount(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  })

  // ---- 2) 已选列表（选择序 = 显示序）----
  const { selected, isSelected, toggle, move, moveUp, moveDown, removeById, clear } =
    useOrderedSelection<File>()

  const selectedCount = computed(() => selected.value.length)
  const selectedOrganisms = computed(() =>
    Array.from(new Set(selected.value.map((d) => d.organism).filter(Boolean))),
  )

  // ---- 3) 元数据草稿：name/description 与 18 个学术字段同一份 draft ----
  const metadata = reactive<CollectionMetadataDraft>(toMetadataDraft({ name: '' }))

  // 可从选中数据集推导的 8 个 list 字段：自动预填，用户手改后该字段被接管。
  // 取去重并集，成员取值不同就多个值——集合元数据的语义是「涵盖的取值集合」。
  const derivedDraft = metadata as unknown as Record<string, string[]>
  const { editedKeys, resetDerivedField } = useDerivedMetadataSync(selected, derivedDraft)

  const isDirty = computed(
    () =>
      selectedCount.value > 0 ||
      Object.values(metadata).some((v) =>
        Array.isArray(v) ? v.length > 0 : String(v).trim() !== '',
      ),
  )
  // 前端必填：name + 选中数据集 + 字段表标记 required 的学术字段（member_type /
  // collection_type、sample 组与 acquisition 组；Growth Conditions / Tissue
  // Modification 除外）。后端不变。
  const requiredFields = METADATA_FIELDS.filter((f) => f.required)
  const canCreate = computed(
    () =>
      metadata.name.trim() !== '' &&
      selectedCount.value > 0 &&
      requiredFields.every((f) => hasMetadataValue(metadata, f)),
  )

  // ---- 4) 保存：file_public_ids 数组顺序 = position 1..n，成功跳转 overview ----
  const saving = ref(false)
  // 提交后的返回跳转不再触发离开确认（isDirty 此刻仍为 true）
  const saved = ref(false)

  async function submit() {
    if (!canCreate.value || saving.value) return
    saving.value = true
    try {
      // 元数据随创建一起提交（POST /collections 与 PATCH 同字段集），空值不发
      const detail = await createCollection(
        buildCollectionCreatePayload(
          metadata,
          selected.value.map((d) => d.publicId),
        ),
      )
      showToast(t('common.feedback.created'), 'success')
      saved.value = true
      // 详情页 public_id 进路径（/collections/overview/{public_id}）。列表页点击是
      // 新标签页打开（handleView），但创建流程是本页延续：原地 replace 过渡到
      // overview，避免给用户多开一个页签。创建响应即 CollectionDetail，publicId 必有
      router.replace({
        name: 'CollectionOverview',
        params: { publicId: detail.publicId },
      })
    } catch (err: any) {
      // 409 invalid collection members 等：CollectionApiError.message 是后端 detail 原文
      showToast(collectionErrorMessage(err, t('common.feedback.createFailed')), 'error')
    } finally {
      saving.value = false
    }
  }

  // ---- 5) 脏态离开守卫：ConfirmDialog + promise 式 onBeforeRouteLeave ----
  const showLeaveConfirm = ref(false)
  let resolveLeave: ((ok: boolean) => void) | null = null

  onBeforeRouteLeave(async () => {
    if (saved.value || !isDirty.value) return true
    showLeaveConfirm.value = true
    return new Promise<boolean>((resolve) => {
      resolveLeave = resolve
    })
  })

  function confirmLeave() {
    showLeaveConfirm.value = false
    resolveLeave?.(true)
    resolveLeave = null
  }

  function cancelLeave() {
    showLeaveConfirm.value = false
    resolveLeave?.(false)
    resolveLeave = null
  }

  onMounted(() => {
    fetchFiles().catch(() => {})
  })

  return {
    // 选择器
    datasets,
    loading,
    error,
    meta,
    size,
    pagination,
    datasetQuery,
    goToPage,
    changeSize,
    // 已选列表
    selected,
    selectedCount,
    selectedOrganisms,
    isSelected,
    toggle,
    move,
    moveUp,
    moveDown,
    removeById,
    clear,
    // 元数据表单
    metadata,
    /** 当前由选中数据集自动推导的字段键 */
    derivedKeys: DERIVED_METADATA_KEYS,
    /** 与识别值不一致（用户手改）的字段键，驱动「恢复为自动识别值」提示 */
    editedKeys,
    resetDerivedField,
    canCreate,
    // 动作
    submit,
    saving,
    // 离开守卫
    showLeaveConfirm,
    confirmLeave,
    cancelLeave,
  }
}

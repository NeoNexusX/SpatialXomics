/** Vue bridge. Durable state comes exclusively from the active session projection. */
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentSnapshot } from '../plugins/agent'
import { whenAgentReady } from '../bootstrap'
import { buildPageState } from '../bridge/analysisContext'

/** UI transcript page size. The durable log retains all turns. */
const MAX_UI_MESSAGES = 100

const snapshot = shallowRef<AgentSnapshot>({
  sessionId: '',
  phase: 'restoring',
  mode: 'temporary',
  messages: [],
  error: null,
})
const visibleCount = shallowRef(MAX_UI_MESSAGES)
const hasContext = shallowRef(false)
const skillButtons = shallowRef<{ name: string; text: string }[]>([])
let bound = false

function bind(): void {
  if (bound) return
  bound = true
  void whenAgentReady()
    .then(async (ctx) => {
      ctx.agent.subscribe((next) => {
        if (next.sessionId !== snapshot.value.sessionId) visibleCount.value = MAX_UI_MESSAGES
        snapshot.value = next
      })
      skillButtons.value = ['annotation-review', 'msi-analysis']
        .filter((name) => ctx.skills.catalog().some((skill) => skill.name === name))
        .map((name) => ({
          name,
          text: `Load the "${name}" skill with the skill tool first, then follow its workflow and output template to analyze the current data with explicit judgment criteria.`,
        }))
      await ctx.agent.ready()
    })
    .catch((error) => {
      snapshot.value = { ...snapshot.value, phase: 'storage-error', error: String(error) }
    })
}

export function useAgent() {
  bind()
  const { t } = useI18n()
  const streaming = computed(
    () => !['idle', 'storage-error', 'disposed'].includes(snapshot.value.phase),
  )
  const messages = computed(() => {
    const items = snapshot.value.messages
      .slice(-visibleCount.value)
      .map((item) =>
        item.compacted
          ? {
              ...item,
              content: item.error
                ? t('common.agent.compactionFailed', { reason: item.error })
                : t('common.agent.compacted'),
            }
          : item,
      )
    if (snapshot.value.phase !== 'compacting' || items.length === 0) return items
    // 和压缩完成后的分界线在同一个位置：进行中的回复之前，没有回复时在末尾
    const active = items.findIndex((item) => item.pending)
    items.splice(active < 0 ? items.length : active, 0, {
      id: 'compacting',
      role: 'assistant',
      content: t('common.agent.compacting'),
      compacted: true,
      pending: true,
    })
    return items
  })
  const skillLabels = computed<Record<string, string>>(() => ({
    'annotation-review': t('common.agent.skillBtns.annotationReview'),
    'msi-analysis': t('common.agent.skillBtns.msiAnalysis'),
  }))

  function refreshContext(): void {
    const state = buildPageState()
    hasContext.value = !!(
      state.dataset ||
      state.selectedIon ||
      state.kmeans ||
      state.annotationCount ||
      state.meanSpectrumAvailable
    )
  }

  async function send(text: string, images?: string[]): Promise<boolean> {
    refreshContext()
    const ctx = await whenAgentReady()
    return ctx.agent.send(text, images)
  }

  async function stop(): Promise<void> {
    ;(await whenAgentReady()).agent.stop()
  }
  async function retry(): Promise<void> {
    await (await whenAgentReady()).agent.regenerate()
  }
  async function compact(): Promise<void> {
    await (await whenAgentReady()).agent.compact()
  }
  async function retrySave(): Promise<void> {
    await (await whenAgentReady()).agent.retrySave()
  }
  async function loadEarlier(): Promise<void> {
    visibleCount.value += 50
  }

  return {
    messages,
    streaming,
    hasContext,
    skillButtons,
    skillLabels,
    sessionId: computed(() => snapshot.value.sessionId),
    error: computed(() => snapshot.value.error),
    mode: computed(() => snapshot.value.mode),
    phase: computed(() => snapshot.value.phase),
    pressure: computed(() => snapshot.value.pressure),
    tokenUsage: computed(() => snapshot.value.tokenUsage),
    earlierAvailable: computed(() => snapshot.value.messages.length > visibleCount.value),
    send,
    stop,
    retry,
    compact,
    retrySave,
    loadEarlier,
    refreshContext,
  }
}

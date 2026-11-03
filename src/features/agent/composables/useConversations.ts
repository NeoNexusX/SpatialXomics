/** Vue bridge for the conversation list. The list is read from storage, never kept as a second source. */
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { downloadBlob } from '@/shared/utils/download'
import { whenAgentReady } from '../bootstrap'
import { InvalidSessionArchiveError } from '../plugins/session-archive'
import {
  MAX_SESSIONS,
  SessionBusyError,
  SessionLimitError,
  type StoredSessionInfo,
} from '../plugins/session-persistence'
import { useAgent } from './useAgent'

const conversations = shallowRef<StoredSessionInfo[]>([])
const menuOpen = shallowRef(false)
const failure = shallowRef('')
const working = shallowRef(false)

export function useConversations() {
  const { t } = useI18n()
  const { messages, mode, phase, sessionId, streaming } = useAgent()

  /** 临时存储没有目录。没打开对话时 mode 也是 temporary，那时要能切走或删掉打不开的对话 */
  const available = computed(() => mode.value !== 'temporary' || !sessionId.value)
  const atLimit = computed(() => conversations.value.length >= MAX_SESSIONS)
  /** 运行中只能导出。切换进行时 streaming 也为真，那时不算运行中 */
  const running = computed(() => streaming.value && phase.value !== 'restoring')
  const locked = computed(() => streaming.value || working.value)
  const notice = computed(() => {
    if (failure.value) return failure.value
    if (running.value) return t('common.agent.conversations.running')
    return atLimit.value ? t('common.agent.conversations.limit') : ''
  })
  const currentTitle = computed(() => {
    if (messages.value.length === 0) return t('common.agent.newChat')
    const current = conversations.value.find((item) => item.id === sessionId.value)
    return current?.title || messages.value[0]?.content || t('common.agent.conversations.untitled')
  })

  function describe(error: unknown): string {
    if (error instanceof SessionLimitError) return t('common.agent.conversations.limit')
    if (error instanceof SessionBusyError) return t('common.agent.conversations.inOtherTab')
    if (error instanceof InvalidSessionArchiveError) {
      console.warn(error)
      return t('common.agent.conversations.invalidFile')
    }
    return error instanceof Error ? error.message : String(error)
  }

  async function refresh(): Promise<void> {
    try {
      conversations.value = await (await whenAgentReady()).agent.conversations()
    } catch (error) {
      failure.value = describe(error)
    }
  }

  function dismissFailure(): void {
    failure.value = ''
  }

  /** 操作失败时打开面板，把原因显示在列表上方 */
  async function perform(action: () => Promise<void>): Promise<boolean> {
    if (working.value) return false
    failure.value = ''
    working.value = true
    try {
      await action()
      return true
    } catch (error) {
      failure.value = describe(error)
      menuOpen.value = true
      return false
    } finally {
      await refresh()
      working.value = false
    }
  }

  async function startNew(): Promise<void> {
    const done = await perform(async () => (await whenAgentReady()).agent.newConversation())
    if (done) menuOpen.value = false
  }

  async function open(id: string): Promise<void> {
    const done = await perform(async () => (await whenAgentReady()).agent.openConversation(id))
    if (done) menuOpen.value = false
  }

  /** 给确认弹窗用：失败时抛出可以直接显示的文案 */
  async function remove(id: string): Promise<void> {
    working.value = true
    failure.value = ''
    try {
      await (await whenAgentReady()).agent.deleteConversation(id)
    } catch (error) {
      throw new Error(describe(error))
    } finally {
      await refresh()
      working.value = false
    }
  }

  async function exportOne(id: string): Promise<void> {
    await perform(async () => {
      const { blob, filename } = await (await whenAgentReady()).sessionArchive.pack(id)
      downloadBlob(blob, filename)
    })
  }

  async function importFile(file: File): Promise<void> {
    const done = await perform(async () => {
      const ctx = await whenAgentReady()
      await ctx.agent.importConversation(await ctx.sessionArchive.unpack(file))
    })
    if (done) menuOpen.value = false
  }

  return {
    conversations,
    menuOpen,
    notice,
    locked,
    working,
    atLimit,
    available,
    sessionId,
    streaming,
    currentTitle,
    maxConversations: MAX_SESSIONS,
    refresh,
    dismissFailure,
    startNew,
    open,
    remove,
    exportOne,
    importFile,
  }
}

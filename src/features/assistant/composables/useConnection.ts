/**
 * useConnection：ctx.connection 的 Vue 桥（模块级单例）。
 *
 * form 是连接设置的草稿，放在模块级：切走视图再回来，填到一半的内容还在。
 */

import { computed, reactive, ref } from 'vue'
import type { ResolvedConnection, ResolvedEndpoint } from '../agenttypes/assistant'
import {
  loadConnectionConfig,
  resolveConnection,
  resolveEndpoint,
  type ConnectionConfig,
} from '../agentconfig/connectionConfig'
import { whenAssistantReady } from '../plugins'

const settings = ref<ConnectionConfig>(loadConnectionConfig())
const form = reactive<ConnectionConfig>({ ...settings.value })

const active = computed<ResolvedConnection | null>(() => resolveConnection(settings.value))
const formEndpoint = computed<ResolvedEndpoint | null>(() => resolveEndpoint(form))

let bound = false
function bindEvents(): void {
  if (bound) return
  bound = true
  void whenAssistantReady().then((ctx) => {
    ctx.on('connection/changed', () => {
      settings.value = ctx.connection.settings()
    })
  })
}

export function useConnection() {
  bindEvents()

  async function save(next: ConnectionConfig): Promise<void> {
    const { connection } = await whenAssistantReady()
    connection.save(next)
  }

  /** 保存当前草稿 */
  function saveForm(): Promise<void> {
    return save({ ...form })
  }

  /** 只换模型（聊天里的模型选择器用），草稿同步 */
  function selectModel(model: string): Promise<void> {
    form.model = model
    return save({ ...settings.value, model })
  }

  async function clear(): Promise<void> {
    const { connection } = await whenAssistantReady()
    connection.clear()
    Object.assign(form, connection.settings())
  }

  return { settings, form, active, formEndpoint, saveForm, selectModel, clear }
}

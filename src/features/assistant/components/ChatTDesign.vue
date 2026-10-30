<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- 上下文徽标 + 清空（放在消息区顶部，归属异步 chat 体） -->
    <ChatToolbar :has-context="hasContext" :message-count="messages.length" @clear="clear" />

    <!-- OPFS 里有更早的完整历史（UI 上限裁掉的部分）→ 手动取回 -->
    <div v-if="earlierAvailable && messages.length > 0" class="shrink-0 px-3 py-1">
      <button
        class="btn btn-ghost btn-xs kawaru-text-68 text-base-content/50 hover:text-primary w-full"
        :disabled="loadingEarlier"
        @click="onLoadEarlier"
      >
        <span v-if="loadingEarlier" class="loading loading-dots loading-xs"></span>
        {{ $t('common.assistant.loadEarlier') }}
      </button>
    </div>

    <!-- Messages：ChatList（layout=both 让 user 右对齐 / assistant 左对齐；
         auto-scroll + 滚动到底按钮由 ChatList 内部处理，滚动交给它） -->
    <div class="flex-1 min-h-0 overflow-hidden">
      <ChatList
        class="h-full"
        layout="both"
        :clear-history="false"
        :show-scroll-button="true"
        :auto-scroll="true"
        default-scroll-to="bottom"
      >
        <template #default>
          <!-- AI Welcome（正文走 #content 槽 + kawaru-text-87，与对话消息同档字号） -->
          <div class="px-2 pt-2">
            <ChatItem role="assistant" variant="base">
              <template #avatar>
                <AssistantAvatar />
              </template>
              <template #content>
                <div class="kawaru-text-87">{{ $t('common.assistant.welcome') }}</div>
              </template>
            </ChatItem>
          </div>

          <!-- Skill buttons -->
          <QuickPrompts
            v-if="messages.length === 0"
            class="pt-1 pl-11 pb-1"
            :skills="skillButtons"
            :skill-labels="skillLabels"
            @skill="askQuick"
          />

          <!-- 对话消息（group 供消息内 hover 复制按钮显隐）。
               compacted 条目（自动压缩系统提示）不进气泡——渲染为居中分隔行，
               与 user/assistant 对话流在视觉上区分 -->
          <template v-for="m in messages" :key="m.id">
            <div v-if="m.compacted" class="px-2 py-1 flex items-center gap-2 select-none">
              <div class="flex-1 h-px bg-base-300/60"></div>
              <span class="kawaru-text-62 text-base-content/40 whitespace-nowrap">
                {{ m.content }}
              </span>
              <div class="flex-1 h-px bg-base-300/60"></div>
            </div>

            <ChatItem
              v-else
              class="group"
              :role="m.role === 'user' ? 'user' : 'assistant'"
              variant="base"
              animation="moving"
              :status="m.error ? 'error' : ''"
              :text-loading="isAssistantTyping(m)"
              :reasoning="m.reasoning ? reasoningPanel(m) : undefined"
              :reasoning-loading="m.reasoningActive"
            >
              <template v-if="m.role === 'assistant'" #avatar>
                <AssistantAvatar />
              </template>

              <template v-if="m.role === 'assistant'" #content>
                <ToolCallCards :message="m" />

                <!-- 正文：ChatContent 指定 engine:'marked'（marked + sanitize + hljs
                     代码高亮/复制，纯 light-DOM 输出）。缺省 engine 是 'cherry-markdown'
                     ——那是一个 shadow-DOM omi 组件（t-chat-md-content），内部自带
                     Helvetica/Arial 字体系统，外层任何 CSS（kawaru 档位/字体栈/
                     .assistant-markdown 规则）都进不去，正文与全站字体对不上即由此来。
                     外层套 kawaru-text-87 让 markdown 正文与 user 消息同档字号。 -->
                <div v-if="m.content" class="assistant-markdown kawaru-text-87">
                  <ChatContent
                    role="assistant"
                    :content="m.content"
                    :markdown-props="{ engine: 'marked', options: {} }"
                  />
                </div>
                <span
                  v-if="m.pending && m.content"
                  class="inline-block w-1.5 h-3.5 bg-primary align-middle animate-pulse ml-0.5"
                ></span>
                <MessageStatus :message="m" @retry="retry" />

                <!-- 思考中但还没开始出正文：显式提示（reasoning 面板头部由 TDesign 渲染） -->
                <div
                  v-if="m.reasoningActive && !m.content"
                  class="text-base-content/50 kawaru-text-75 flex items-center gap-1"
                >
                  <span class="loading loading-dots loading-xs"></span>
                  {{ $t('common.assistant.thinking') }}
                </div>
              </template>

              <template v-else #content>
                <!-- user 附带的图片（多模态输入）。object-contain 不裁剪：用户
                     发的是完整截图，预览被切掉一角会误导 -->
                <div v-if="m.images && m.images.length > 0" class="flex flex-wrap gap-1.5 mb-1">
                  <img
                    v-for="(img, i) in m.images"
                    :key="i"
                    :src="img"
                    class="max-w-40 max-h-40 rounded-lg border border-base-300 object-contain"
                    :alt="$t('common.assistant.imageAlt')"
                  />
                </div>
                <div class="kawaru-text-87 whitespace-pre-wrap">{{ m.content }}</div>
                <div v-if="m.content" class="flex justify-end pt-0.5">
                  <MessageCopyButton :text="m.content" />
                </div>
              </template>

              <!-- 整条消息复制（actions 区只对 assistant 角色渲染；user 消息的
                   复制按钮在上方 content 槽尾部，见 v-else 分支） -->
              <template v-if="m.role === 'assistant'" #actions>
                <MessageCopyButton v-if="m.content" :text="m.content" />
              </template>
            </ChatItem>
          </template>
        </template>
      </ChatList>
    </div>

    <!-- Input area：TDesign ChatSender（textarea 自适应 + 发送/停止切换） -->
    <div class="chat-input-area shrink-0 px-3 pb-2 pt-1 border-t border-base-300">
      <!-- 待发送图片缩略预览（多模态）：可单独移除 -->
      <div v-if="pendingImages.length > 0" class="flex flex-wrap gap-1.5 pb-1.5">
        <div
          v-for="(img, i) in pendingImages"
          :key="i"
          class="relative group/thumb w-14 h-14 rounded-lg overflow-hidden border border-base-300"
        >
          <img :src="img" class="w-full h-full object-cover" :alt="$t('common.assistant.imageAlt')" />
          <button
            type="button"
            class="absolute top-0 right-0 btn btn-xs btn-ghost btn-square bg-base-100/70 opacity-0 group-hover/thumb:opacity-100 transition-opacity"
            :title="$t('common.action.close')"
            @click="removeImage(i)"
          >
            <svg-icon type="close" class="w-3 h-3" />
          </button>
        </div>
      </div>
      <div class="flex items-end gap-1.5">
        <!-- 图片附件按钮：打开文件选择（也可直接 Ctrl+V 粘贴截图，见 onPaste）。
             有待发图片且正文为空时兼任发送（TDesign 的发送按钮内部强制要求
             文本非空，纯图消息点它没反应） -->
        <button
          v-if="!imageOnlyPending"
          type="button"
          class="btn btn-sm btn-ghost btn-square shrink-0"
          :title="$t('common.assistant.attachImage')"
          :disabled="streaming"
          @click="imageInputRef?.click()"
        >
          <svg-icon type="photo" class="w-4 h-4" />
        </button>
        <button
          v-else
          type="button"
          class="btn btn-sm btn-primary btn-square shrink-0"
          :title="$t('common.assistant.send')"
          :disabled="streaming"
          @click="onSend(inputValue)"
        >
          <svg-icon type="upload" class="w-4 h-4" />
        </button>
        <input
          ref="imageInputRef"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          class="hidden"
          @change="onPickImages"
        />
        <div class="flex-1 min-w-0" @paste="onPaste">
          <!-- 捕获阶段的 Enter 接管：TDesign ChatSender 内部强制要求文本非空
               （isSendDisabled = … || !textValue），纯图片消息（正文空）按
               Enter 会被它静默拦下。捕获阶段先于 textarea 目标触发，正文为空
               且有待发图片时自行发送并阻断事件（TDesign 的 keydown 对空文本
               无操作，正文非空的正常路径不受影响、照常冒泡）。 -->
          <div @keydown.capture.enter.exact="onEnterCapture">
            <ChatSender
              v-model="inputValue"
              :placeholder="$t('common.assistant.placeholder')"
              :loading="streaming"
              :send-btn-disabled="!canSend"
              @send="onSend"
              @stop="stop"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, h, watch, onMounted, onUnmounted } from 'vue'
// 按需从子路径导入（避免整包引入 chat-engine/chatbot 等未用模块）
import ChatList from '@tdesign-vue-next/chat/es/chat-list'
import ChatItem from '@tdesign-vue-next/chat/es/chat-item'
import ChatContent from '@tdesign-vue-next/chat/es/chat-content'
import ChatSender from '@tdesign-vue-next/chat/es/chat-sender'
import '@tdesign-vue-next/chat/es/style/index.css'
import 'tdesign-web-components/lib/style/index.css'
import type { TdChatReasoning } from '@tdesign-vue-next/chat/es/type'
import { useI18n } from 'vue-i18n'
import ToolCallCards from './ToolCallCards.vue'
import AssistantAvatar from './shared/AssistantAvatar.vue'
import ChatToolbar from './shared/ChatToolbar.vue'
import QuickPrompts from './shared/QuickPrompts.vue'
import MessageStatus from './shared/MessageStatus.vue'
import MessageCopyButton from './shared/MessageCopyButton.vue'
import { useAssistant } from '../composables/useAssistant'
import { isAssistantTyping } from '../utils/chatItem'
import { useChatThemeMode } from '../composables/useChatThemeMode'
import type { UiChatItem } from '../agenttypes/assistant'

const { t } = useI18n()

const {
  messages,
  streaming,
  hasContext,
  skillButtons,
  skillLabels,
  earlierAvailable,
  loadEarlier,
  send: sendMessage,
  stop,
  clear,
  retry,
} = useAssistant()

const loadingEarlier = ref(false)

async function onLoadEarlier() {
  if (loadingEarlier.value) return
  loadingEarlier.value = true
  try {
    await loadEarlier()
  } finally {
    loadingEarlier.value = false
  }
}

const inputValue = ref('')

// ---- 多模态图片输入 ----
/** 待发送的图片（base64 dataURL），发送后清空 */
const pendingImages = ref<string[]>([])
const imageInputRef = ref<HTMLInputElement | null>(null)

/** 单条消息图片数上限（dataURL 直接进请求体与 localStorage，几张就够用了） */
const MAX_IMAGES_PER_MESSAGE = 4

/** 有正文或有图片即可发送 */
const canSend = computed(() => inputValue.value.trim() !== '' || pendingImages.value.length > 0)

/** 纯图片待发（正文为空）：此时 TDesign 发送按钮被其内部空文本闸门禁用，
 *  附件按钮切换成发送按钮（见模板） */
const imageOnlyPending = computed(
  () => inputValue.value.trim() === '' && pendingImages.value.length > 0,
)

/** File → base64 dataURL；过大图片先等比压缩（dataURL 直接进 LLM 请求体） */
const MAX_IMAGE_DIM = 1568
async function fileToDataUrl(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
  // 仅位图且超边才压缩；svg/小图原样
  if (!/^data:image\/(png|jpe?g|webp)/i.test(dataUrl)) return dataUrl
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('image decode failed'))
    el.src = dataUrl
  })
  const longest = Math.max(img.width, img.height)
  if (longest <= MAX_IMAGE_DIM) return dataUrl
  const scale = MAX_IMAGE_DIM / longest
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  const ctx = canvas.getContext('2d')!
  // 先铺白底再画：canvas 默认全透明，PNG 透明区域经 JPEG 编码会变纯黑，
  // 截图带透明底时 vision 模型收到的会是一张黑卡
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.85)
}

function onPickImages(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = '' // 允许重选同一文件
  void addFiles(files)
}

/** 粘贴截图：优先保留剪贴板里的文字（Excel 单元格/Word 图文混排会同时带
 *  text 与 image 两种 flavor，一律 preventDefault 会把文字吞掉），无文字
 *  或文字已在输入框时才只取图片。 */
function onPaste(e: ClipboardEvent) {
  const items = Array.from(e.clipboardData?.items ?? [])
  const imageFiles = items
    .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
    .map((it) => it.getAsFile())
    .filter((f): f is File => !!f)
  const text = e.clipboardData?.getData('text/plain') ?? ''
  if (imageFiles.length === 0) return // 纯文字粘贴走 textarea 默认行为
  if (text.trim()) {
    // 图文混排：文字并入输入框（不交给 textarea 默认插入——preventDefault 后
    // 由我们统一管理），图片进待发列表
    e.preventDefault()
    inputValue.value = inputValue.value ? `${inputValue.value}${text}` : text
  } else {
    e.preventDefault()
  }
  void addFiles(imageFiles)
}

/** 捕获阶段接管 Enter（见模板注释）：正文为空但有待发图片时直接发送，
 *  阻断 TDesign 内部对空文本的无操作 keydown。正文非空不干预。 */
function onEnterCapture(e: KeyboardEvent) {
  if (streaming.value) return
  if (inputValue.value.trim() !== '' || pendingImages.value.length === 0) return
  e.preventDefault()
  e.stopPropagation()
  onSend(inputValue.value)
}

async function addFiles(files: File[]) {
  for (const f of files) {
    if (pendingImages.value.length >= MAX_IMAGES_PER_MESSAGE) break
    // 只收 vision API 普遍接受的位图格式；gif/bmp/tiff 压缩链路不认、直传
    // 又几乎必被端点拒
    if (!/^image\/(png|jpe?g|webp)$/i.test(f.type)) continue
    try {
      pendingImages.value.push(await fileToDataUrl(f))
    } catch {
      // 单个图片读取失败不阻塞其余
    }
  }
}

function removeImage(i: number) {
  pendingImages.value.splice(i, 1)
}

/**
 * 思考面板（TDesign ChatItem 的 object 形态 reasoning）：
 * header 标题随思考态切换；content 为思考全文（纯文本、灰显）。
 */
function reasoningPanel(m: UiChatItem): TdChatReasoning {
  return {
    expandIconPlacement: 'right',
    collapsePanelProps: {
      header: m.reasoningActive
        ? t('common.assistant.thinking')
        : t('common.assistant.thought'),
      content: h(
        'div',
        {
          class:
            'kawaru-text-75 text-base-content/70 whitespace-pre-wrap break-words max-h-40 overflow-y-auto',
        },
        m.reasoning,
      ),
    },
  }
}

// ---- TDesign 暗色模式同步：其变量挂在 html[theme-mode] 上（引用计数管理） ----
useChatThemeMode()

function askQuick(promptText: string) {
  if (streaming.value) return
  sendMessage(promptText)
}

function onSend(value: string) {
  const text = (value ?? inputValue.value).trim()
  const images = pendingImages.value
  if ((!text && images.length === 0) || streaming.value) return
  inputValue.value = ''
  pendingImages.value = []
  sendMessage(text, images.length > 0 ? images : undefined)
}
</script>

<style scoped>
/* ----------------------------------------------------------------------------
   assistant markdown 正文排版：让 TDesign ChatContent 的产出跟随全局
   kawaru-text 体系（外层已套 kawaru-text-87），并收紧标题/列表/代码块的
   默认外边距——否则 marked 输出的 h1/h2、p、ul 会用 UA/TDesign 的大字号与
   大间距，在窄气泡里显得"渲染很奇怪"。

   ⚠ .t-chat__text 在 ChatContent 根上写了 `font: var(--td-font-body-large)`
   简写（直接声明 > 继承），单靠外层 kawaru-text-87 管不住它——这里必须
   就地重设 font-size（继承回外层档位 87）与行高（TDesign 默认 line-height:2
   的 2 倍行距在窄气泡里过松，收成档位自身的 1.5）。word-break:break-all
   会把英文单词拦腰截断，改 break-word（同 chat 内长 URL 不断行的问题）。
   ---------------------------------------------------------------------------- */
.assistant-markdown :deep(.t-chat__text) {
  font-size: inherit;
  line-height: 1.5;
  word-break: break-word;
  font-family: inherit;
}
/* ChatContent 内层（结构 __text > __text__assistant > __text__content）：
   __text__assistant 自带 line-height:2，且其 p/ul/ol 又写死 1.5——一律
   继承外层 kawaru-text-87 档位的行高，别让两层各说各话 */
.assistant-markdown :deep(.t-chat__text__assistant),
.assistant-markdown :deep(.t-chat__text__assistant p),
.assistant-markdown :deep(.t-chat__text__assistant ul),
.assistant-markdown :deep(.t-chat__text__assistant ol) {
  line-height: inherit;
}
.assistant-markdown :deep(p),
.assistant-markdown :deep(ul),
.assistant-markdown :deep(ol),
.assistant-markdown :deep(li),
.assistant-markdown :deep(blockquote),
.assistant-markdown :deep(table) {
  font-size: inherit;
  line-height: inherit;
}

.assistant-markdown :deep(h1),
.assistant-markdown :deep(h2),
.assistant-markdown :deep(h3),
.assistant-markdown :deep(h4),
.assistant-markdown :deep(h5),
.assistant-markdown :deep(h6) {
  font-size: 1.1em;
  font-weight: 600;
  line-height: 1.4;
  margin: 0.6em 0 0.3em;
}
.assistant-markdown :deep(h1:first-child),
.assistant-markdown :deep(h2:first-child),
.assistant-markdown :deep(h3:first-child),
.assistant-markdown :deep(p:first-child),
.assistant-markdown :deep(ul:first-child),
.assistant-markdown :deep(ol:first-child) {
  margin-top: 0;
}

.assistant-markdown :deep(p) {
  margin: 0.4em 0;
}
.assistant-markdown :deep(ul),
.assistant-markdown :deep(ol) {
  margin: 0.4em 0;
  padding-left: 1.4em;
}
.assistant-markdown :deep(li) {
  margin: 0.15em 0;
}

/* 行内代码 / 代码块字号随正文走，只缩一档 */
.assistant-markdown :deep(code),
.assistant-markdown :deep(pre) {
  font-size: 0.9em;
}
.assistant-markdown :deep(pre) {
  margin: 0.5em 0;
}

/* GFM 表格：TDesign chat 样式对 table 零规则（无此块时是无边框的散排文字，
   SKILL 模板的输出大量用表）。display:block + overflow-x:auto 让宽表在窄
   气泡里横向滚动而不是撑破布局；width:max-content 让列按内容定宽——
   不加则块宽被气泡压扁、数字在数值中间折行（760.5856 → 760.585/6）。
   单元格 nowrap：数据表列名/m/z 值折行比横滚更伤可读性。 */
.assistant-markdown :deep(table) {
  display: block;
  overflow-x: auto;
  width: max-content;
  max-width: 100%;
  border-collapse: collapse;
  margin: 0.5em 0;
  font-size: 0.9em;
}
.assistant-markdown :deep(th),
.assistant-markdown :deep(td) {
  border: 1px solid var(--td-border-level-2-color, var(--td-gray-color-3, #e7e7e7));
  padding: 0.2em 0.5em;
  text-align: left;
  vertical-align: top;
  white-space: nowrap;
}
.assistant-markdown :deep(th) {
  font-weight: 600;
  background: var(--td-bg-color-secondarycontainer, rgba(0, 0, 0, 0.03));
}
</style>

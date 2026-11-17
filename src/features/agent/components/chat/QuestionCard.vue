<script setup lang="ts">
/**
 * 等待中的提问，占住输入框的位置，外壳也和输入框一样。推荐项预选；用鼠标点单选项就进入下一题，
 * 最后一题要点提交。每次改动都存回服务：面板关了再打开能接着答，到点时服务按这份草稿和推荐项自动提交。
 * 选项是无边框的行，和模型列表一致；进度是一排取自离子图 viridis 色标的像素，顶边的色标随剩余时间缩短。
 */
import { computed, shallowRef, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIntervalFn } from '@vueuse/core'
import { ChevronDownIcon, ChevronUpIcon, PencilIcon, SquareIcon, TimerIcon } from '@lucide/vue'
import { buildLUT, colormapGradient } from '@/shared/viz/colormapLut'
import {
  draftAnswer,
  parseRecommendedLabel,
  type PendingQuestion,
  type QuestionAnswer,
  type QuestionDraft,
} from '../../plugins/user-questions'
import { useQuestion } from '../../composables/useQuestion'
import ChoiceMark from '../ai-elements/ChoiceMark.vue'
import IconButton from '../ai-elements/IconButton.vue'
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from '../ui/questionnaire'

const props = defineProps<{ pending: PendingQuestion }>()
const emit = defineEmits<{ stop: [] }>()

const GRADIENT = colormapGradient('viridis')
const VIRIDIS = buildLUT('viridis')
/** 剩下不到一分钟时倒计时变红 */
const URGENT_MS = 60_000

/** 选项行和「其他答案」行共用：无边框，悬停换底色，选中是淡淡的强调色；左右悬出去，标记和题目左边对齐 */
const ROW =
  '-mx-2.5 min-h-11 gap-2.5 rounded-[10px] px-2.5 leading-snug transition-colors hover:bg-accent data-checked:bg-(--sxo-accent)/8 sm:min-h-9 dark:data-checked:bg-(--sxo-accent)/15'

type PixelState = 'open' | 'answered' | 'skipped'
const PIXEL: Record<PixelState, string> = {
  open: 'bg-muted-foreground/20',
  answered: '',
  skipped: 'border border-muted-foreground/50',
}

const { t } = useI18n()
const { saveDrafts, submit } = useQuestion()

const questions = computed(() => props.pending.questions)
const drafts = shallowRef<QuestionDraft[]>(
  props.pending.drafts.map((draft) => ({ ...draft, selected: [...draft.selected] })),
)
const isAnswered = (index: number) => !!draftAnswer(questions.value[index]!, drafts.value[index]!)
const hasCustom = (index: number) => drafts.value[index]!.custom.trim() !== ''
/** 重新打开时停在第一道用户还没答完的题；预选的推荐项不算用户答过 */
const active = shallowRef(
  questions.value[drafts.value.findIndex((draft, index) => !draft.touched || !isAnswered(index))]
    ?.id ?? questions.value[0]!.id,
)
const activeIndex = computed(() =>
  questions.value.findIndex((question) => question.id === active.value),
)
const heading = computed(
  () => questions.value[activeIndex.value]?.header || t('common.agent.question.waiting'),
)
const progress = computed(() =>
  t('common.agent.question.progress', {
    current: activeIndex.value + 1,
    total: questions.value.length,
  }),
)
const collapsed = shallowRef(false)
const contentId = useId()
const failure = shallowRef('')

const items = computed(() =>
  questions.value.map((question) => ({
    name: question.id,
    choices: (question.options ?? []).map((option) => ({ value: option.label })),
  })),
)

const now = shallowRef(Date.now())
useIntervalFn(() => (now.value = Date.now()), 1000)
const remaining = computed(() => Math.max(0, props.pending.deadline - now.value))
const clock = computed(() => {
  const seconds = Math.ceil(remaining.value / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
})
const autoSubmit = computed(() => t('common.agent.question.autoSubmit', { time: clock.value }))

/**
 * 进度像素：用户答过的题按色标着色，跳过的空心，没动过的灰色。
 * 只有预选推荐项、用户没碰过的题也算没动过，到点时这些题按推荐自动提交
 */
const pixels = computed(() =>
  questions.value.map((question, index) => {
    const draft = drafts.value[index]!
    let state: PixelState = 'open'
    if (draft.touched && draft.skipped) state = 'skipped'
    else if (draft.touched && isAnswered(index)) state = 'answered'
    return { id: question.id, state, color: state === 'answered' ? pixelColor(index) : undefined }
  }),
)

/** 第 index 道题的像素颜色：取色标中段（蓝绿到黄绿），亮暗背景下都看得清 */
function pixelColor(index: number): string {
  const count = questions.value.length
  const position = 0.4 + 0.45 * (count === 1 ? 1 : index / (count - 1))
  return `rgb(${VIRIDIS[Math.round(position * 255)]!.join(' ')})`
}

function update(index: number, patch: Partial<QuestionDraft>): void {
  drafts.value = drafts.value.map((draft, i) =>
    i === index ? { ...draft, ...patch, touched: true } : draft,
  )
  failure.value = ''
  saveDrafts(drafts.value)
}

const isChecked = (index: number, label: string) =>
  !drafts.value[index]!.skipped && drafts.value[index]!.selected.includes(label)

function choose(index: number, label: string, checked: boolean): void {
  const selected = drafts.value[index]!.selected.filter((item) => item !== label)
  if (questions.value[index]!.multiSelect) {
    update(index, { selected: checked ? [...selected, label] : selected, skipped: false })
  } else if (checked) {
    // 单选时选项和自由文本互斥
    update(index, { selected: [label], custom: '', skipped: false })
  }
}

function write(index: number, custom: string): void {
  const keep = questions.value[index]!.multiSelect ? {} : { selected: [] }
  update(index, { custom, skipped: false, ...keep })
}

/** 鼠标点单选项后进入下一题。键盘和数字键的选择（detail 为 0）不跳 */
function advanceAfterClick(event: MouseEvent, index: number): void {
  if (event.detail === 0 || questions.value[index]!.multiSelect) return
  const next = questions.value[index + 1]
  if (!next) return
  // change 事件在 click 之后才派发，等选中状态写进草稿再跳
  setTimeout(() => {
    if (isAnswered(index)) active.value = next.id
  })
}

/** 跳过按钮先于组件自己的跳过逻辑触发，在这里把草稿记成跳过 */
function skipActive(): void {
  update(activeIndex.value, { selected: [], custom: '', skipped: true })
}

function onSubmit(event: Event): void {
  event.preventDefault()
  const answers = questions.value.map((question, index) =>
    draftAnswer(question, drafts.value[index]!),
  )
  const missing = answers.findIndex((answer) => !answer)
  if (missing >= 0) {
    active.value = questions.value[missing]!.id
    return
  }
  try {
    submit({ answers: answers as QuestionAnswer[] })
  } catch (error) {
    failure.value = t('common.agent.question.submitFailed', {
      reason: error instanceof Error ? error.message : String(error),
    })
  }
}
</script>

<template>
  <div class="relative overflow-hidden rounded-[20px] border border-input bg-base-100 shadow-sm">
    <div
      class="h-0.5 origin-left transition-transform duration-1000 ease-linear motion-reduce:transition-none"
      :style="{ background: GRADIENT, transform: `scaleX(${remaining / pending.timeoutMs})` }"
      aria-hidden="true"
    ></div>
    <Questionnaire
      v-model:item="active"
      :items="items"
      shortcuts="numbers"
      class="gap-0"
      @submit="onSubmit"
    >
      <div class="flex min-w-0 items-center gap-2 py-1.5 pr-1.5 pl-4">
        <QuestionnaireProgress
          class="flex min-h-0 w-auto min-w-0 shrink-0 items-center gap-1"
          :aria-label="progress"
          :aria-valuetext="progress"
        >
          <span
            v-for="(pixel, index) in pixels"
            :key="pixel.id"
            class="size-2 rounded-[2px] transition-colors motion-reduce:transition-none"
            :class="[
              PIXEL[pixel.state],
              index === activeIndex &&
                'ring-1 ring-foreground/45 ring-offset-1 ring-offset-base-100',
            ]"
            :style="pixel.color ? { background: pixel.color } : undefined"
            aria-hidden="true"
          ></span>
        </QuestionnaireProgress>
        <span class="kawaru-text-62 min-w-0 truncate font-medium text-(--sxo-label-2)">
          {{ heading }}
        </span>
        <span
          role="timer"
          class="kawaru-text-62 ml-auto inline-flex shrink-0 items-center gap-1 tabular-nums"
          :class="remaining <= URGENT_MS ? 'text-error' : 'text-(--sxo-label-3)'"
          :title="autoSubmit"
          :aria-label="autoSubmit"
        >
          <TimerIcon class="size-3" aria-hidden="true" />
          {{ clock }}
        </span>
        <IconButton
          type="button"
          :label="
            collapsed ? t('common.agent.question.expand') : t('common.agent.question.collapse')
          "
          :aria-expanded="!collapsed"
          :aria-controls="contentId"
          @click="collapsed = !collapsed"
        >
          <ChevronUpIcon v-if="collapsed" />
          <ChevronDownIcon v-else />
        </IconButton>
        <IconButton type="button" :label="t('common.agent.stop')" @click="emit('stop')">
          <SquareIcon class="size-2.5 fill-current" />
        </IconButton>
      </div>

      <div v-show="!collapsed" :id="contentId">
        <div class="max-h-[min(50dvh,26rem)] overflow-y-auto overscroll-contain px-4 pt-1 pb-2">
          <QuestionnaireItem
            v-for="(question, index) in questions"
            :key="question.id"
            :name="question.id"
            :multiple="question.multiSelect"
            :default-skipped="drafts[index]!.skipped"
            class="gap-2.5"
          >
            <QuestionnaireTitle class="mb-0! leading-snug font-medium wrap-anywhere">
              <span class="whitespace-pre-wrap">{{ question.question }}</span>
              <span
                v-if="question.multiSelect"
                class="kawaru-text-62 ml-1.5 font-normal whitespace-nowrap text-(--sxo-label-3)"
              >
                {{ t('common.agent.question.multipleHint') }}
              </span>
            </QuestionnaireTitle>
            <QuestionnaireChoices class="gap-0.5">
              <QuestionnaireChoice
                v-for="option in question.options ?? []"
                :key="option.label"
                :value="option.label"
                :checked="isChecked(index, option.label)"
                :class="[
                  ROW,
                  'border-0 bg-transparent py-2 shadow-none has-[>input:focus-visible]:ring-2 dark:bg-transparent',
                  // 只有一行时在行高里居中（小屏行高至少 44px）；带说明时标记对齐第一行
                  !option.description && 'items-center',
                ]"
                @update:checked="(checked: boolean) => choose(index, option.label, checked)"
                @click="(event: MouseEvent) => advanceAfterClick(event, index)"
              >
                <template #indicator="{ checked, shortcut, type }">
                  <ChoiceMark :checked="checked" :multiple="type === 'checkbox'">
                    {{ shortcut }}
                  </ChoiceMark>
                </template>
                <span class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 wrap-anywhere">
                  {{ parseRecommendedLabel(option.label).label }}
                  <span
                    v-if="parseRecommendedLabel(option.label).recommended"
                    class="kawaru-text-56 rounded-full bg-viridis-ink/12 px-1.5 py-px font-medium text-viridis-ink"
                  >
                    {{ t('common.agent.question.recommended') }}
                  </span>
                </span>
                <QuestionnaireChoiceDescription
                  v-if="option.description"
                  class="kawaru-text-62 wrap-anywhere"
                >
                  {{ option.description }}
                </QuestionnaireChoiceDescription>
              </QuestionnaireChoice>
              <!-- 自由文本也是一行：单选时它和选项互斥，多选时是补充；没有选项时它是唯一的答法，平时就带底色 -->
              <label
                :class="[
                  ROW,
                  'kawaru-text-75 flex cursor-text items-center py-1 has-[input:focus]:bg-accent',
                  !question.options?.length && 'bg-muted',
                ]"
                :data-checked="hasCustom(index) ? '' : undefined"
              >
                <ChoiceMark :checked="hasCustom(index)" :multiple="question.multiSelect">
                  <PencilIcon class="size-2.5" />
                </ChoiceMark>
                <QuestionnaireInput
                  :model-value="drafts[index]!.custom"
                  :placeholder="
                    question.options?.length
                      ? t('common.agent.question.other')
                      : t('common.agent.question.custom')
                  "
                  :aria-label="
                    question.options?.length
                      ? t('common.agent.question.other')
                      : t('common.agent.question.custom')
                  "
                  maxlength="2000"
                  class="h-7 min-h-0 rounded-none border-0 bg-transparent p-0 shadow-none caret-(--sxo-accent) placeholder:text-(--sxo-label-3) focus-visible:ring-0 aria-invalid:ring-0 sm:min-h-0 dark:bg-transparent"
                  @update:model-value="(value: string) => write(index, value)"
                />
              </label>
            </QuestionnaireChoices>
            <QuestionnaireError>
              <span class="kawaru-text-62">{{ t('common.agent.question.incomplete') }}</span>
            </QuestionnaireError>
          </QuestionnaireItem>
        </div>
        <p v-if="failure" role="alert" class="kawaru-text-62 px-4 pb-1 text-error">
          {{ failure }}
        </p>
        <!-- 下一题 / 提交落在发送按钮的位置 -->
        <QuestionnaireActions class="min-h-0 gap-1 px-2.5 pt-1 pb-2.5 sm:min-h-0">
          <QuestionnairePrevious
            size="sm"
            variant="ghost"
            class="h-8 rounded-full px-3 font-normal text-(--sxo-label-2)"
          >
            {{ t('common.agent.question.previous') }}
          </QuestionnairePrevious>
          <QuestionnaireSkip
            size="sm"
            variant="ghost"
            class="h-8 rounded-full px-3 font-normal text-(--sxo-label-2)"
            @click="skipActive"
          >
            {{ t('common.agent.question.skip') }}
          </QuestionnaireSkip>
          <QuestionnaireNext size="sm" class="h-8 rounded-full px-4">
            {{ t('common.agent.question.next') }}
          </QuestionnaireNext>
          <QuestionnaireSubmit size="sm" class="h-8 rounded-full px-4">
            {{ t('common.agent.question.submit') }}
          </QuestionnaireSubmit>
        </QuestionnaireActions>
      </div>
    </Questionnaire>
  </div>
</template>

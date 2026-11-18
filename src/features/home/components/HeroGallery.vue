<script setup lang="ts">
/** Two registered views share the same projection. The lens reveals view 02
 * at the original scale; it never magnifies or moves the foreground text. */
import { computed, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import { useElementVisibility, usePreferredReducedMotion } from '@vueuse/core'
import { gsap } from '../motion/gsap'

const props = defineProps<{ images: string[] }>()
const base = computed(() => props.images[0])
const alternate = computed(() => props.images[1])
const background = computed(() => alternate.value ?? base.value)
const loaded = shallowRef<Set<string>>(new Set())
const failed = shallowRef<Set<string>>(new Set())
const sourceWidth = shallowRef<number>()
const frame = useTemplateRef<HTMLElement>('frame')
const visible = useElementVisibility(frame, { threshold: 0.25 })
const reducedMotion = usePreferredReducedMotion()
const showLens = computed(
  () =>
    !!base.value &&
    !!alternate.value &&
    loaded.value.has(base.value) &&
    loaded.value.has(alternate.value),
)
let context: gsap.Context | undefined
let moveX: ReturnType<typeof gsap.quickTo> | undefined
let moveY: ReturnType<typeof gsap.quickTo> | undefined
let sweep: gsap.core.Timeline | undefined
let introPlayed = false
let pointerFrame = 0
let pointerPosition: { x: number; y: number } | undefined

function cancelPointer() {
  cancelAnimationFrame(pointerFrame)
  pointerFrame = 0
  pointerPosition = undefined
}

function stopSweep() {
  sweep?.kill()
  sweep = undefined
}

function playIntro() {
  if (
    !context ||
    !frame.value ||
    !showLens.value ||
    !visible.value ||
    reducedMotion.value === 'reduce' ||
    introPlayed
  )
    return

  introPlayed = true
  moveX?.tween.pause()
  moveY?.tween.pause()
  // Keep asynchronous image-load animations in the component's cleanup scope.
  context.add(() => {
    sweep = gsap
      .timeline({
        delay: 0.35,
        onComplete: () => {
          sweep = undefined
        },
      })
      .fromTo(
        frame.value,
        { '--lens-x': 12, '--lens-y': 52 },
        { '--lens-x': 88, '--lens-y': 52, duration: 1.8, ease: 'power2.inOut' },
      )
      .to(frame.value, { '--lens-x': 62, '--lens-y': 52, duration: 0.7, ease: 'power2.inOut' })
  })
}

function move(x: number, y: number) {
  cancelPointer()
  if (!frame.value) return
  const wasSweeping = !!sweep
  stopSweep()
  if (reducedMotion.value === 'reduce') {
    moveX?.tween.pause()
    moveY?.tween.pause()
    gsap.set(frame.value, { '--lens-x': x, '--lens-y': y })
  } else {
    // quickTo otherwise resumes its own cached start, which predates the sweep.
    moveX?.(x, wasSweeping ? Number(gsap.getProperty(frame.value, '--lens-x')) : undefined)
    moveY?.(y, wasSweeping ? Number(gsap.getProperty(frame.value, '--lens-y')) : undefined)
  }
}
function inspect(event: PointerEvent) {
  if (!frame.value || event.pointerType === 'touch') return
  // Direct interaction takes priority, including before the images finish loading.
  introPlayed = true
  pointerPosition = { x: event.clientX, y: event.clientY }
  if (!pointerFrame) pointerFrame = requestAnimationFrame(inspectFrame)
}
function inspectFrame() {
  pointerFrame = 0
  const position = pointerPosition
  if (!frame.value || !position) return
  // The interaction frame stays flat. Only the two image planes are projected,
  // so pointer coordinates remain accurate throughout the perspective effect.
  const bounds = frame.value.getBoundingClientRect()
  move(
    Math.max(12, Math.min(88, ((position.x - bounds.left) / bounds.width) * 100)),
    Math.max(18, Math.min(82, ((position.y - bounds.top) / bounds.height) * 100)),
  )
}
function imageLoaded(event: Event, src: string) {
  const image = event.target as HTMLImageElement
  sourceWidth.value = Math.min(sourceWidth.value ?? Infinity, image.naturalWidth)
  loaded.value = new Set([...loaded.value, src])
}
function imageFailed(src: string) {
  failed.value = new Set([...failed.value, src])
  loaded.value = new Set([...loaded.value].filter((image) => image !== src))
}
watch(
  () => props.images.join('\n'),
  () => {
    introPlayed = false
    move(62, 52)
    loaded.value = new Set()
    failed.value = new Set()
    sourceWidth.value = undefined
  },
)
watch(
  [showLens, visible, reducedMotion],
  ([ready, inView, preference]) => {
    if (preference === 'reduce') {
      move(62, 52)
      return
    }
    if (!ready || !inView) {
      cancelPointer()
      stopSweep()
      moveX?.tween.pause()
      moveY?.tween.pause()
      return
    }
    playIntro()
  },
  { flush: 'post' },
)
onMounted(() => {
  if (!frame.value) return
  context = gsap.context(() => {
    moveX = gsap.quickTo(frame.value, '--lens-x', { duration: 0.3, ease: 'power2.out' })
    moveY = gsap.quickTo(frame.value, '--lens-y', { duration: 0.3, ease: 'power2.out' })
  })
  playIntro()
})
onBeforeUnmount(() => {
  cancelPointer()
  stopSweep()
  context?.revert()
})
</script>

<template>
  <figure
    class="hero-media"
    :aria-label="$t('home.hero.galleryTitle')"
    :style="{
      '--source-width': sourceWidth ? `${sourceWidth}px` : undefined,
      '--tissue-image': background && !failed.has(background) ? `url('${background}')` : undefined,
    }"
  >
    <div
      ref="frame"
      class="hero-media__frame"
      :class="{ 'is-ready': showLens }"
      @pointermove="inspect"
      @pointerleave="move(62, 52)"
    >
      <div class="hero-media__base">
        <div class="hero-media__plane">
          <img
            v-if="base && !failed.has(base)"
            :key="base"
            :src="base"
            :alt="$t('home.hero.viewAlt', { index: 1 })"
            decoding="async"
            fetchpriority="high"
            draggable="false"
            @load="imageLoaded($event, base)"
            @error="imageFailed(base)"
          />
        </div>
      </div>
      <div
        v-if="alternate && !failed.has(alternate)"
        class="hero-media__lens"
        :class="{ 'is-ready': showLens }"
        aria-hidden="true"
      >
        <div class="hero-media__plane">
          <img
            :key="alternate"
            :src="alternate"
            alt=""
            decoding="async"
            fetchpriority="low"
            draggable="false"
            @load="imageLoaded($event, alternate)"
            @error="imageFailed(alternate)"
          />
        </div>
      </div>
      <span v-if="showLens" class="hero-media__rim" aria-hidden="true" />
      <p v-if="base && failed.has(base)" class="hero-media__fallback">
        {{ $t('home.hero.imageUnavailable') }}
      </p>
    </div>
  </figure>
</template>

<style scoped>
.hero-media {
  position: absolute;
  inset: 0;
  min-width: 0;
  isolation: isolate;
}
.hero-media::before {
  /* View 02 fills the Hero's colour field and is reused inside the lens;
     the default view 01 keeps its natural resolution. */
  content: '';
  position: absolute;
  inset: -6%;
  z-index: -1;
  background: var(--tissue-image) center / cover no-repeat;
  filter: blur(40px) saturate(0.65);
  opacity: 0.2;
  pointer-events: none;
}
.hero-media__frame {
  --lens-x: 62;
  --lens-y: 52;
  --lens-size: clamp(6rem, 14vw, 11rem);
  position: absolute;
  inset: 12% 0 6%;
  width: min(94%, var(--source-width, 72rem), 72rem);
  margin: auto;
  isolation: isolate;
}
.hero-media__base,
.hero-media__plane,
.hero-media__lens {
  position: absolute;
  inset: 0;
}
.hero-media__plane {
  /* Scale down to leave room for the projected corners, keeping all tissue visible. */
  transform: perspective(1400px) rotateX(22deg) scale(0.8);
}
.hero-media__plane img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
}
.hero-media__base {
  opacity: 0.72;
}
.is-ready > .hero-media__base {
  /* Cut the first view out beneath the lens, so neither image needs an opaque disc. */
  mask-image: radial-gradient(
    circle at calc(var(--lens-x) * 1%) calc(var(--lens-y) * 1%),
    transparent calc(var(--lens-size) / 2 - 0.5px),
    black calc(var(--lens-size) / 2 + 0.5px)
  );
}
.hero-media__lens {
  clip-path: circle(
    calc(var(--lens-size) / 2) at calc(var(--lens-x) * 1%) calc(var(--lens-y) * 1%)
  );
  opacity: 0;
  pointer-events: none;
}
.hero-media__lens.is-ready {
  opacity: 1;
}
.hero-media__rim {
  position: absolute;
  left: calc(var(--lens-x) * 1%);
  top: calc(var(--lens-y) * 1%);
  width: var(--lens-size);
  height: var(--lens-size);
  transform: translate(-50%, -50%);
  border: 1px solid color-mix(in oklab, var(--color-base-content) 18%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--color-base-100) 55%, transparent);
  border-radius: 50%;
  pointer-events: none;
}
.hero-media__fallback {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 0.875rem;
  color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
}
</style>

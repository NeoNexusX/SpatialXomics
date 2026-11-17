import type { InjectionKey, Ref } from 'vue'

/** The scene owns sticky positioning and flow space; the stack owns its travel. */
export interface HomeSectionContext {
  panel: Readonly<Ref<HTMLElement | null>>
  anchor: Readonly<Ref<HTMLElement | null>>
  /** Content that enters before the first stacked card. */
  introElements?: () => readonly HTMLElement[]
  setDwell: (distance: number) => void
}

export const homeSectionKey: InjectionKey<HomeSectionContext> = Symbol('home-section')

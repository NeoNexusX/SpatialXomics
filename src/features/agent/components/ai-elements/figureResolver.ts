import type { InjectionKey } from 'vue'

export type FigureResolver = (handle: string) => Promise<string | undefined>

export const FIGURE_RESOLVER: InjectionKey<FigureResolver> = Symbol('agent-figure-resolver')

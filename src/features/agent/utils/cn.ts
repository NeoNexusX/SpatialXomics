/**
 * 合并 Tailwind 类名：clsx 处理条件写法，tailwind-merge 让后写的类覆盖冲突的先写类。
 * components/ui 与 components/ai-elements 下的组件都经它接收外部传入的 class。
 */
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

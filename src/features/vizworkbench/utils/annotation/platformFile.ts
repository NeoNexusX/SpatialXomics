/**
 * File System Access API 封装（Chromium 86+；Firefox/Safari 不支持）。
 *
 * 平台库导入用它把整库 CSV 以**文件**形式保存到用户选定的位置（默认下载文件夹），
 * 句柄存进 IndexedDB；再次导入时直接读该文件复用、不再下载——文件被删/改名/移动
 * 或大小与后端探测值不一致时才重新拉取。
 *
 * 注意两个「必须发生在用户点击手势内」的调用：showSaveFilePicker 与
 * requestPermission（浏览器只认 transient activation）。调用方应在点击后的第一时间
 * 调用 {@link prepare} 一类的入口，不要先 await 网络。
 *
 * TS 的 lib.dom 只声明了 handle/createWritable，picker 与权限方法在此补声明。
 */

/** 「另存为」对话框的起始位置：系统常见目录的知名名称（Chromium 支持） */
export type SaveStartIn = 'downloads' | 'desktop' | 'documents' | 'pictures'

interface SaveFilePickerOptions {
  suggestedName?: string
  /** 对话框默认定位到的目录；不填则用浏览器上次记住的位置 */
  startIn?: SaveStartIn
  types?: { description?: string; accept: Record<string, string[]> }[]
}

type FsPermissionMode = 'read' | 'readwrite'
interface FsPermissionDescriptor {
  mode?: FsPermissionMode
}

declare global {
  interface Window {
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>
  }
  interface FileSystemHandle {
    queryPermission?(descriptor?: FsPermissionDescriptor): Promise<PermissionState>
    requestPermission?(descriptor?: FsPermissionDescriptor): Promise<PermissionState>
  }
}

/** 当前浏览器是否支持「保存文件句柄 + 复用」的完整流程 */
export function supportsFileHandles(): boolean {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function'
}

/** 用户取消对话框时的异常（各浏览器可能抛 DOMException 或普通对象） */
function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === 'AbortError') ||
    (e as { name?: string })?.name === 'AbortError'
  )
}

/**
 * 弹「另存为」对话框拿文件句柄；用户取消返回 null。
 * 必须在点击手势内调用（浏览器要求 transient activation）。
 *
 * startIn 默认 'downloads'：对话框直接定位到系统下载文件夹，用户点一次「保存」
 * 即可。浏览器不允许网页静默写入下载目录，这一步确认无法绕过（确认过一次后
 * 句柄被记住，后续复用文件时不再弹）。
 *
 * 旧版 Chromium 不认识 startIn 的目录名字符串（会在弹窗前抛 TypeError），
 * 此时去掉 startIn 重试一次，保证对话框照常弹出（只是回到浏览器默认位置）。
 */
export async function pickSaveHandle(
  suggestedName: string,
  startIn: SaveStartIn = 'downloads',
): Promise<FileSystemFileHandle | null> {
  if (!supportsFileHandles()) return null
  const types = [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }]
  try {
    return await window.showSaveFilePicker!({ suggestedName, startIn, types })
  } catch (e) {
    if (isAbortError(e)) return null
    console.warn('showSaveFilePicker with startIn failed, retrying without it:', e)
    try {
      return await window.showSaveFilePicker!({ suggestedName, types })
    } catch (e2) {
      if (isAbortError(e2)) return null
      throw e2
    }
  }
}

/**
 * 句柄是否具备指定权限；'prompt' 时尝试申请（同样需要用户手势）。
 * 没有 queryPermission 的实现（旧浏览器/测试桩）按已授权处理。
 */
export async function hasPermission(
  handle: FileSystemFileHandle,
  mode: FsPermissionMode,
): Promise<boolean> {
  if (typeof handle.queryPermission !== 'function') return true
  try {
    const state = await handle.queryPermission({ mode })
    if (state === 'granted') return true
    if (state === 'prompt' && typeof handle.requestPermission === 'function') {
      return (await handle.requestPermission({ mode })) === 'granted'
    }
    return false
  } catch {
    return false
  }
}

/** 读取句柄指向的文件；文件被删/移动/改名或不可读时返回 null */
export async function readHandleFile(handle: FileSystemFileHandle): Promise<File | null> {
  try {
    return await handle.getFile()
  } catch {
    return null
  }
}

/** 把字节写回句柄（覆盖原文件）；失败返回 false，不抛——写盘失败不应阻断导入 */
export async function writeHandleBytes(
  handle: FileSystemFileHandle,
  bytes: Uint8Array,
): Promise<boolean> {
  try {
    const writable = await handle.createWritable()
    // 传精确范围的 ArrayBuffer（FileSystemWriteChunkType 对 typed array 的泛型要求较严）
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    await writable.write(buf as ArrayBuffer)
    await writable.close()
    return true
  } catch (e) {
    console.error('Failed to write the platform database file:', e)
    return false
  }
}

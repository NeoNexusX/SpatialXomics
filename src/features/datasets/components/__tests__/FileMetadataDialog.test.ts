import { beforeAll, describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'

const { showToast, patchFileMetadata } = vi.hoisted(() => ({
  showToast: vi.fn(),
  patchFileMetadata: vi.fn(),
}))

vi.mock('@/shared/composables/useToast', () => ({
  useToast: () => ({ showToast }),
}))

vi.mock('@/features/datasets/api/datasetApi', () => ({
  patchFileMetadata,
}))

import FileMetadataDialog from '../FileMetadataDialog.vue'
import SolventPicker from '@/features/upload/components/SolventPicker.vue'
import type { File } from '@/features/datasets/types/dataset'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'

const PUBLIC_ID = 'qW3rT5yU7iO9pA1s'

const dataset = {
  publicId: PUBLIC_ID,
  imagePath: 'images/file_7/',
  name: 'kidney',
  submitTime: '2026-09-10T00:00:00',
  submitter: 'u',
  status: 'completed',
  isPublic: true,
  organism: 'Mouse',
  spectrumMode: 'profile',
} as File

const mountDialog = (open = false) =>
  mount(FileMetadataDialog, { props: { open, dataset }, global: { plugins: [i18n], stubs: { SvgIcon: true } } })


// 组件模板用 $t：挂载时装上 i18n 实例，并预先加载英文语言包（断言保持英文原文）
beforeAll(() => Promise.all([loadCoreMessages('en'), loadFeatureMessages('datasets'), loadFeatureMessages('upload')]))

describe('FileMetadataDialog', () => {
  beforeEach(() => {
    showToast.mockClear()
    patchFileMetadata.mockReset()
  })

  // 回归：dialog 常驻 DOM，关闭态也会渲染模板；draft 未初始化时字段绑定
  // 访问 null 曾导致整个 Dataset Overview 页面崩溃
  it('renders without crashing when closed (draft not initialized)', () => {
    const wrapper = mountDialog(false)

    expect(wrapper.find('dialog.modal').exists()).toBe(true)
    // 守卫生效：关闭态不渲染字段绑定
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.find('select').exists()).toBe(false)
  })

  it('populates the draft when opened (SelectWithOther falls back to Other input)', async () => {
    const wrapper = mountDialog(false)

    await wrapper.setProps({ open: true })
    await nextTick()

    // 'Mouse' 不在 ORGANISMS 词表内 → 组件自动落到 Other 自定义输入回显
    // （该 input 无显式 type 属性，不能用 input[type=text] 选择器）
    const otherInput = wrapper.find('input')
    expect((otherInput.element as HTMLInputElement).value).toBe('Mouse')

    // 'profile' 在枚举内 → 对应下拉直接选中
    const selectValues = wrapper.findAll('select').map((s) => s.element.value)
    expect(selectValues).toContain('profile')

    // Spectrum/Storage Mode 的下拉只有真实取值，不再有 “—” 占位项
    expect(wrapper.findAll('option').map((o) => o.text())).not.toContain('—')
  })

  // 回归：solvent 曾被漏出弹窗（其余样本属性都能改，只有它没有对应控件）
  it('renders the solvent editor when opened', async () => {
    const wrapper = mountDialog(false)

    await wrapper.setProps({ open: true })
    await nextTick()

    expect(wrapper.findComponent(SolventPicker).exists()).toBe(true)
  })

  // 非持有者保存时后端 403 / "permission denied"，原文对用户没有信息量
  it('turns a permission-denied save failure into a readable message', async () => {
    patchFileMetadata.mockRejectedValueOnce({
      response: { status: 403, data: { detail: 'Permission denied' } },
    })
    const wrapper = mountDialog(false)
    await wrapper.setProps({ open: true })
    await nextTick()

    // 第一个 input 是 organism 的 Other 输入框（'Mouse' 不在 ORGANISMS 内）
    await wrapper.find('input').setValue('Rat')
    await nextTick()

    const saveButton = wrapper
      .findAll('button')
      .find((b) => b.text().includes('Save Changes'))!
    await saveButton.trigger('click')
    await flushPromises()

    expect(patchFileMetadata).toHaveBeenCalledWith(PUBLIC_ID, { organism: 'Rat' })
    expect(showToast).toHaveBeenCalledWith(
      'You do not own this dataset, so you cannot modify it.',
      'error',
    )
  })
})

import { beforeAll, describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
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
import SelectWithOther from '@/shared/components/SelectWithOther.vue'
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
  polarity: 'Positive',
  ionSource: 'MALDI',
  analyzer: 'TOF',
  pixelSizeHorizontal: 50,
  pixelSizeVertical: 50,
  resolvingPower: 140000,
  mz: 200,
  spectrumMode: 'profile',
  storageMode: 'processed',
} as File

const savedFile = {
  public_id: PUBLIC_ID,
  filename: 'kidney.imzML',
  status: 'completed',
  uploaded_at: '2026-09-10T00:00:00',
  is_public: true,
}

const mountDialog = (open = false) =>
  mount(FileMetadataDialog, {
    props: { open, dataset },
    global: { plugins: [i18n], stubs: { SvgIcon: true } },
  })

async function openDialog(): Promise<VueWrapper> {
  const wrapper = mountDialog(false)
  await wrapper.setProps({ open: true })
  await nextTick()
  return wrapper
}

function findSaveButton(wrapper: VueWrapper) {
  return wrapper.findAll('button').find((b) => b.text().includes('Save Changes'))!
}

async function save(wrapper: VueWrapper) {
  await findSaveButton(wrapper).trigger('click')
  await flushPromises()
}

// 组件模板用 $t：挂载时装上 i18n 实例，并预先加载英文语言包（断言保持英文原文）
beforeAll(() =>
  Promise.all([
    loadCoreMessages('en'),
    loadFeatureMessages('datasets'),
    loadFeatureMessages('upload'),
  ]),
)

describe('FileMetadataDialog', () => {
  beforeEach(() => {
    showToast.mockClear()
    patchFileMetadata.mockReset()
    patchFileMetadata.mockResolvedValue(savedFile)
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

  it('populates the draft and instrument controls when opened', async () => {
    const wrapper = await openDialog()

    // 'Mouse' 不在 ORGANISMS 词表内 → SelectWithOther 自动落到 Other 自定义输入回显
    expect((wrapper.find('[data-field="organism"] input').element as HTMLInputElement).value).toBe(
      'Mouse',
    )

    expect(
      (wrapper.find('[data-field="polarity"] select').element as HTMLSelectElement).value,
    ).toBe('Positive')
    expect(
      (wrapper.find('[data-field="ionisation_source"] select').element as HTMLSelectElement).value,
    ).toBe('MALDI')
    expect(
      (wrapper.find('[data-field="analyzer"] select').element as HTMLSelectElement).value,
    ).toBe('TOF')
    expect(
      (wrapper.find('[data-field="pixel_size_horizontal"] input').element as HTMLInputElement)
        .value,
    ).toBe('50')
    expect(
      (wrapper.find('[data-field="pixel_size_vertical"] input').element as HTMLInputElement).value,
    ).toBe('50')
    expect(
      (wrapper.find('[data-field="resolving_power"] input').element as HTMLInputElement).value,
    ).toBe('140000')
    expect((wrapper.find('[data-field="mz"] input').element as HTMLInputElement).value).toBe('200')

    // 未改动：差量提交无内容可发 → Save 禁用
    expect(findSaveButton(wrapper).attributes('disabled')).toBeDefined()
  })

  it('initializes when mounted open and when the dataset arrives after opening', async () => {
    const wrapper = mountDialog(true)
    expect((wrapper.get('[data-field="mz"] input').element as HTMLInputElement).value).toBe('200')

    await wrapper.setProps({ dataset: null })
    expect(wrapper.find('[data-field="mz"]').exists()).toBe(false)
    await wrapper.setProps({ dataset })
    expect((wrapper.get('[data-field="mz"] input').element as HTMLInputElement).value).toBe('200')
    expect(findSaveButton(wrapper).attributes('disabled')).toBeDefined()
  })

  it('preserves scientific casing, Unicode, spaces and symbols when custom text loses focus', async () => {
    const wrapper = await openDialog()
    const value = '小鼠 α-组织 / pH 7.4; MALDI-2 + timsTOF fleX'
    const input = wrapper.get('[data-field="organism"] input')
    await input.setValue(value)
    await input.trigger('blur')
    expect(wrapper.get('[data-field="organism"] select').element).toHaveProperty('value', 'Other')
    await save(wrapper)
    expect(patchFileMetadata).toHaveBeenCalledWith(PUBLIC_ID, { organism: value })
  })

  it('accepts 128 Unicode code points after blur without the old 50-character limit', async () => {
    const wrapper = await openDialog()
    const input = wrapper.get('[data-field="organism"] input')
    await input.setValue('😀'.repeat(128))
    await input.trigger('blur')
    expect(findSaveButton(wrapper).attributes('disabled')).toBeUndefined()
    await save(wrapper)
    expect(patchFileMetadata).toHaveBeenCalledWith(PUBLIC_ID, { organism: '😀'.repeat(128) })
  })

  it('clears custom text and selected vocabulary fields without submitting the Other placeholder', async () => {
    const wrapper = await openDialog()
    await wrapper.get('[data-field="organism"] input').setValue('')
    expect(wrapper.get('[data-field="organism"] input').element).toHaveProperty('value', '')
    await wrapper.get('[data-field="polarity"] select').setValue('')
    await wrapper.get('[data-field="analyzer"] select').setValue('Other')
    await wrapper.get('[data-field="analyzer"] input').setValue('custom FTICR + 中文')
    await save(wrapper)
    expect(patchFileMetadata).toHaveBeenCalledWith(PUBLIC_ID, {
      organism: '',
      polarity: '',
      analyzer: 'custom FTICR + 中文',
    })
  })

  it('shows the number of changed values and resets both valid and invalid edits', async () => {
    const wrapper = await openDialog()
    await wrapper.get('[data-field="mz"] input').setValue('400')
    await wrapper.get('[data-field="organism"] input').setValue('Rat')
    expect(wrapper.get('[role="status"]').text()).toBe('Fields changed: 2')
    await wrapper.get('[data-field="pixel_size_horizontal"] input').setValue('-5')
    const reset = wrapper.findAll('button').find((button) => button.text() === 'Reset')!
    await reset.trigger('click')
    expect(wrapper.get('[data-field="mz"] input').element).toHaveProperty('value', '200')
    expect(wrapper.get('[data-field="organism"] input').element).toHaveProperty('value', 'Mouse')
    expect(wrapper.get('[data-field="pixel_size_horizontal"] input').element).toHaveProperty(
      'value',
      '50',
    )
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('[role="status"]').text()).toBe('Fields changed: 0')
    expect(findSaveButton(wrapper).attributes('disabled')).toBeDefined()
    expect(patchFileMetadata).not.toHaveBeenCalled()
  })

  it('keeps the editing baseline during a background refresh and resets it for another file', async () => {
    const wrapper = await openDialog()
    await wrapper.get('[data-field="mz"] input').setValue('400')
    await wrapper.setProps({ dataset: { ...dataset, organism: 'Background update' } })
    await save(wrapper)
    expect(patchFileMetadata).toHaveBeenCalledWith(PUBLIC_ID, { mz: 400 })

    await wrapper.setProps({ dataset: { ...dataset, publicId: 'AnotherDataset01', mz: 600 } })
    expect(wrapper.get('[data-field="mz"] input').element).toHaveProperty('value', '600')
    expect(findSaveButton(wrapper).attributes('disabled')).toBeDefined()
  })

  it('locks inputs and closing while saving, then emits the mapped server result', async () => {
    let resolveSave!: (value: typeof savedFile) => void
    patchFileMetadata.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    )
    const wrapper = await openDialog()
    await wrapper.get('[data-field="mz"] input').setValue('400')
    await findSaveButton(wrapper).trigger('click')
    expect(wrapper.get('[data-field="mz"] input').element.matches(':disabled')).toBe(true)
    expect(wrapper.get('[data-field="polarity"] select').element.matches(':disabled')).toBe(true)
    await findSaveButton(wrapper).trigger('click')
    await wrapper.get('dialog').trigger('keydown', { key: 'Escape' })
    await wrapper.get('.modal-backdrop').trigger('click')
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(patchFileMetadata).toHaveBeenCalledTimes(1)

    resolveSave({ ...savedFile, mz: 400 } as typeof savedFile)
    await flushPromises()
    expect(wrapper.emitted('saved')?.[0]?.[0]).toMatchObject({ publicId: PUBLIC_ID, mz: 400 })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('omits read-only file-format fields from the metadata editor', async () => {
    const wrapper = await openDialog()

    expect(wrapper.find('[data-field="spectrum_mode"]').exists()).toBe(false)
    expect(wrapper.find('[data-field="storage_mode"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Read-only')
  })

  // 回归：solvent 曾被漏出弹窗（其余样本属性都能改，只有它没有对应控件）
  it('renders the solvent editor when opened', async () => {
    const wrapper = await openDialog()

    expect(wrapper.findComponent(SolventPicker).exists()).toBe(true)
  })

  it('preserves custom solvent names when adding a mixture entry', async () => {
    const wrapper = await openDialog()
    const picker = wrapper.getComponent(SolventPicker)
    const solventName = picker.getComponent(SelectWithOther)
    await picker.get('input[inputmode="decimal"]').setValue('50')
    await solventName.get('select').setValue('Other')
    const customName = solventName.get('input')
    await customName.setValue('α solvent / pH=7.4')
    await customName.trigger('blur')
    await picker.get('button[title="Add solvent"]').trigger('click')
    await save(wrapper)
    expect(patchFileMetadata).toHaveBeenCalledWith(PUBLIC_ID, {
      solvent: '50% α solvent / pH=7.4',
    })
  })

  it('sends only the one instrument field the user changed', async () => {
    const wrapper = await openDialog()

    await wrapper.find('[data-field="mz"] input').setValue('500')
    await nextTick()
    expect(findSaveButton(wrapper).attributes('disabled')).toBeUndefined()

    await save(wrapper)

    expect(patchFileMetadata).toHaveBeenCalledTimes(1)
    expect(patchFileMetadata).toHaveBeenCalledWith(PUBLIC_ID, { mz: 500 })
    expect(Object.keys(patchFileMetadata.mock.calls[0]![1])).toEqual(['mz'])
  })

  it('sends 0, not null, when a numeric field is cleared', async () => {
    const wrapper = await openDialog()

    await wrapper.find('[data-field="pixel_size_horizontal"] input').setValue('')
    await nextTick()

    await save(wrapper)

    expect(patchFileMetadata).toHaveBeenCalledWith(PUBLIC_ID, { pixel_size_horizontal: 0 })
    expect(patchFileMetadata.mock.calls[0]![1]).not.toHaveProperty('pixel_size_horizontal', null)
  })

  it('shows the real stored value and keeps the dialog open when the server changes numeric precision', async () => {
    patchFileMetadata.mockResolvedValueOnce({ ...savedFile, resolving_power: 140000 })
    const wrapper = await openDialog()
    await wrapper.get('[data-field="resolving_power"] input').setValue('140000.5')
    await save(wrapper)

    expect(patchFileMetadata).toHaveBeenCalledWith(PUBLIC_ID, { resolving_power: 140000.5 })
    expect(wrapper.emitted('saved')?.[0]?.[0]).toMatchObject({ resolvingPower: 140000 })
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toContain('140000.5 → 140000')
    expect(wrapper.get('[data-field="resolving_power"] input').element).toHaveProperty(
      'value',
      '140000',
    )
    expect(findSaveButton(wrapper).attributes('disabled')).toBeDefined()
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('server adjusted'), 'warning')

    await wrapper.get('[data-field="resolving_power"] input').setValue('140001')
    patchFileMetadata.mockResolvedValueOnce({ ...savedFile, resolving_power: 140001 })
    await save(wrapper)
    expect(patchFileMetadata).toHaveBeenLastCalledWith(PUBLIC_ID, { resolving_power: 140001 })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('blocks saving a negative number and shows the error on that field', async () => {
    const wrapper = await openDialog()

    await wrapper.find('[data-field="mz"] input').setValue('-1')
    await nextTick()

    expect(wrapper.find('[data-field="mz"]').text()).toContain(
      'Must be a number greater than or equal to 0.',
    )
    expect(findSaveButton(wrapper).attributes('disabled')).toBeDefined()

    await save(wrapper)
    expect(patchFileMetadata).not.toHaveBeenCalled()
  })

  it('blocks saving a string longer than 128 characters and shows the error on that field', async () => {
    const wrapper = await openDialog()

    await wrapper.find('[data-field="organism"] input').setValue('A'.repeat(129))
    await nextTick()

    expect(wrapper.find('[data-field="organism"]').text()).toContain(
      'Must be at most 128 characters.',
    )
    expect(findSaveButton(wrapper).attributes('disabled')).toBeDefined()

    await save(wrapper)
    expect(patchFileMetadata).not.toHaveBeenCalled()
  })

  it('maps a backend 422 detail loc onto the corresponding field', async () => {
    patchFileMetadata.mockRejectedValueOnce({
      response: {
        status: 422,
        data: {
          detail: [
            {
              loc: ['body', 'mz'],
              msg: 'Input should be greater than or equal to 0',
              type: 'greater_than_equal',
            },
          ],
        },
      },
    })
    const wrapper = await openDialog()

    await wrapper.find('[data-field="mz"] input').setValue('5')
    await nextTick()
    await save(wrapper)

    expect(patchFileMetadata).toHaveBeenCalledWith(PUBLIC_ID, { mz: 5 })
    expect(wrapper.find('[data-field="mz"]').text()).toContain(
      'Must be a number greater than or equal to 0.',
    )
    expect(showToast).toHaveBeenCalledWith(
      'Some fields are invalid. Please check the highlighted fields.',
      'error',
    )

    await wrapper.get('[data-field="organism"] input').setValue('Rat')
    expect(wrapper.get('[data-field="mz"] input').attributes('aria-invalid')).toBe('true')
    expect(findSaveButton(wrapper).attributes('disabled')).toBeDefined()
    expect(wrapper.emitted('close')).toBeUndefined()

    await wrapper.get('[data-field="mz"] input').setValue('500')
    expect(wrapper.get('[data-field="mz"] input').attributes('aria-invalid')).toBe('false')
    await save(wrapper)
    expect(patchFileMetadata).toHaveBeenLastCalledWith(PUBLIC_ID, { organism: 'Rat', mz: 500 })
  })

  it('does not close a newly opened dataset when an earlier save finishes', async () => {
    let resolveSave!: (value: typeof savedFile) => void
    patchFileMetadata.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    )
    const wrapper = await openDialog()
    await wrapper.get('[data-field="mz"] input').setValue('400')
    await findSaveButton(wrapper).trigger('click')
    await wrapper.setProps({ dataset: { ...dataset, publicId: 'AnotherDataset01', mz: 600 } })
    resolveSave(savedFile)
    await flushPromises()
    expect(wrapper.emitted('saved')?.[0]?.[0]).toMatchObject({ publicId: PUBLIC_ID })
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.get('[data-field="mz"] input').element).toHaveProperty('value', '600')
  })

  // 非持有者保存时后端 403 / "permission denied"，原文对用户没有信息量
  it('turns a permission-denied save failure into a readable message', async () => {
    patchFileMetadata.mockRejectedValueOnce({
      response: { status: 403, data: { detail: 'Permission denied' } },
    })
    const wrapper = await openDialog()

    await wrapper.find('[data-field="organism"] input').setValue('Rat')
    await nextTick()

    await save(wrapper)

    expect(patchFileMetadata).toHaveBeenCalledWith(PUBLIC_ID, { organism: 'Rat' })
    expect(showToast).toHaveBeenCalledWith(
      'You do not own this dataset, so you cannot modify it.',
      'error',
    )
  })
})

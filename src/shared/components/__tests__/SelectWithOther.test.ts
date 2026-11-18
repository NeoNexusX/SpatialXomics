import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import RegisterProfileForm from '@/features/auth/components/RegisterProfileForm.vue'
import SelectWithOther from '../SelectWithOther.vue'

describe('SelectWithOther blur', () => {
  it('forwards blur from the select', async () => {
    const wrapper = mount(SelectWithOther, {
      props: { modelValue: '', options: ['a', 'b'] },
      global: { stubs: { SvgIcon: true } },
    })

    await wrapper.find('select').trigger('blur')

    expect(wrapper.emitted('blur')).toHaveLength(1)
  })

  // 元数据编辑弹窗需要与后端 128 字符上限对齐；默认仍是上传/注册表单的 50
  it('honors a custom maxLength for the free-text input', () => {
    const wrapper = mount(SelectWithOther, {
      props: { modelValue: 'Custom value', options: ['a', 'b'], maxLength: 128 },
      global: { stubs: { SvgIcon: true } },
    })

    expect(wrapper.find('input').attributes('maxlength')).toBe('128')
  })

  // 回归：表单监听了 @blur 做校验，但事件一直没有发出，离开未选的研究领域不会提示
  it('validates the research field when the register form select loses focus', async () => {
    const validateField = vi.fn()
    const wrapper = mount(RegisterProfileForm, {
      props: {
        form: reactive({
          position: '',
          region: '',
          research_field: '',
          organization: '',
          orcid: '',
          homepage: '',
          verification_code: '',
          first_name: '',
          last_name: '',
        }),
        errors: reactive({}),
        patterns: {},
        loading: { register: false, sendCode: false },
        positionOptions: [],
        regionOptions: {},
        researchFieldOptions: ['Metabolomics'],
        validateField,
        clearError: vi.fn(),
      } as never,
      global: { mocks: { $t: (key: string) => key }, stubs: { SvgIcon: true } },
    })

    await wrapper.findComponent(SelectWithOther).find('select').trigger('blur')

    expect(validateField).toHaveBeenCalledWith('research_field')
  })
})

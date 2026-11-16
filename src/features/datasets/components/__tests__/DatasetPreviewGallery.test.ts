import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import DatasetPreviewGallery from '../DatasetPreviewGallery.vue'
import { buildPreviewImageUrls } from '@/features/datasets/utils/imageUtils'
import { loadFeatureMessages } from '@/i18n'

// imageUtils 的 base 运行时经 getConfig() 读 config.json 的 oss 块；单测不走
// 启动链，mock 掉并返回测试环境域名（与 imageUtils.test.ts 的 mock 一致）。
vi.mock('@/shared/config/runtimeConfig', () => ({
  getConfig: () => ({
    oss: { previewImageBase: 'https://kawaru-oss.oss-cn-hangzhou.aliyuncs.com' },
  }),
}))

beforeAll(() => loadFeatureMessages('datasets'))

const urls = buildPreviewImageUrls('images/file_42/')

const mountGallery = (props: Record<string, unknown> = {}) =>
  mount(DatasetPreviewGallery, { props: { imagePath: 'images/file_42/', ...props } })

describe('DatasetPreviewGallery', () => {
  it('always renders three slots so the hover-gallery keeps its columns', () => {
    expect(mountGallery().findAll('figure.hover-gallery > div')).toHaveLength(3)
  })

  it('requests only the visible image before the first hover', () => {
    const wrapper = mountGallery()

    const imgs = wrapper.findAll('img')
    expect(imgs).toHaveLength(1)
    expect(imgs[0]!.attributes('src')).toBe(urls[0])
  })

  it('fills in the remaining slots on first hover', async () => {
    const wrapper = mountGallery()

    await wrapper.find('figure').trigger('pointerenter')

    expect(wrapper.findAll('img').map((img) => img.attributes('src'))).toEqual(urls)
  })

  it('builds its slots from the imagePath prop', async () => {
    const wrapper = mount(DatasetPreviewGallery, { props: { imagePath: 'images/file_7/' } })

    await wrapper.find('figure').trigger('pointerenter')

    expect(wrapper.findAll('img').map((img) => img.attributes('src'))).toEqual(
      buildPreviewImageUrls('images/file_7/'),
    )
  })

  it('renders the placeholder for every slot when image_path is empty', () => {
    // image_path 为空（预览未生成）：三槽位直接占位图，不发起任何图片请求
    const wrapper = mount(DatasetPreviewGallery, { props: { imagePath: null } })

    expect(wrapper.findAll('img')).toHaveLength(0)
    for (const slot of wrapper.findAll('figure.hover-gallery > div')) {
      expect(slot.html()).toContain('<svg')
    }
  })

  it('degrades only the failing slot to the placeholder svg', async () => {
    const wrapper = mountGallery()

    await wrapper.find('img').trigger('error')
    await wrapper.find('figure').trigger('pointerenter')

    const slots = wrapper.findAll('figure.hover-gallery > div')
    expect(slots[0]!.html()).toContain('<svg')
    expect(slots[0]!.find('img').exists()).toBe(false)
    expect(slots[1]!.find('img').attributes('src')).toBe(urls[1])
    expect(slots[2]!.find('img').attributes('src')).toBe(urls[2])
  })

  it('shows only the TIC preview for processed data', () => {
    const wrapper = mount(DatasetPreviewGallery, {
      props: { imagePath: 'images/file_42/', storageMode: 'processed' },
    })

    // No hover-gallery, just one slot
    expect(wrapper.findAll('figure.hover-gallery').length).toBe(0)
    const imgs = wrapper.findAll('img')
    expect(imgs).toHaveLength(1)
    expect(imgs[0]!.attributes('src')).toBe(urls[0])
  })

  it('resets slot states when imagePath changes', async () => {
    const wrapper = mountGallery()

    // 先让第 1 槽位进入失败态，再换目录：失败态应被清掉，新 URL 正常渲染
    await wrapper.find('img').trigger('error')
    await wrapper.setProps({ imagePath: 'images/file_7/' })
    await wrapper.find('figure').trigger('pointerenter')

    expect(wrapper.findAll('img').map((img) => img.attributes('src'))).toEqual(
      buildPreviewImageUrls('images/file_7/'),
    )
  })
})

import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AssistantMarkdown from '../components/ai-elements/AssistantMarkdown.vue'

async function render(text: string) {
  const wrapper = mount(AssistantMarkdown, { props: { text } })
  await flushPromises()
  await flushPromises()
  return wrapper
}

describe('AssistantMarkdown rendering', () => {
  it('renders the structures reports rely on', async () => {
    const wrapper = await render(
      [
        '## Top annotations',
        '',
        '| m/z | name |',
        '|---|---|',
        '| 760.5856 | PC 34:1 |',
        '',
        '- **high** confidence',
        '',
        '`inline`',
      ].join('\n'),
    )
    expect(wrapper.get('h2').text()).toBe('Top annotations')
    expect(wrapper.get('td').text()).toBe('760.5856')
    expect(wrapper.get('strong').text()).toBe('high')
    expect(wrapper.get('code').text()).toBe('inline')
  })

  it('routes fenced code to the code block with its language', async () => {
    const wrapper = await render('```python\nprint(1)\n```')
    expect(wrapper.find('[data-slot="code-block"]').exists()).toBe(true)
    expect(wrapper.get('[data-slot="code-block-title"]').text()).toBe('python')
    expect(wrapper.get('[data-slot="code-block-content"]').text()).toContain('print(1)')
  })

  it('closes unfinished syntax while streaming', async () => {
    const wrapper = mount(AssistantMarkdown, {
      props: { text: 'Unfinished **bold', streaming: true },
    })
    await flushPromises()
    await flushPromises()
    expect(wrapper.get('strong').text()).toBe('bold')
  })

  it('does not change a finished message', async () => {
    const wrapper = await render('未闭合 **粗体')
    expect(wrapper.find('strong').exists()).toBe(false)
    expect(wrapper.text()).toBe('未闭合 **粗体')
  })

  it('updates as the text grows', async () => {
    const wrapper = await render('Hello')
    await wrapper.setProps({ text: 'Hello **world**' })
    await flushPromises()
    await flushPromises()
    expect(wrapper.get('strong').text()).toBe('world')
  })
})

describe('AssistantMarkdown syntax', () => {
  it.each([
    ['**判断标准（明示）：**质量误差', 'strong', '判断标准（明示）：'],
    ['**结论。**后面紧跟中文', 'strong', '结论。'],
    ['文字**（括号）**文字', 'strong', '（括号）'],
    ['**"引号"**文字', 'strong', '"引号"'],
    ['*斜体：*文字', 'em', '斜体：'],
  ])('closes emphasis next to full-width punctuation: %s', async (text, tag, content) => {
    const wrapper = await render(text)
    expect(wrapper.get(tag).text()).toBe(content)
    expect(wrapper.text()).not.toContain('*')
  })

  it('closes that emphasis inside tables and quotes too', async () => {
    const wrapper = await render('| 注释 |\n|---|\n| **棕榈酸：**C16 |\n\n> **注意：**引用')
    expect(wrapper.get('td strong').text()).toBe('棕榈酸：')
    expect(wrapper.get('blockquote strong').text()).toBe('注意：')
  })

  it('leaves asterisks in code and lone asterisks alone', async () => {
    const wrapper = await render('`**x**` 与 * p<0.05，** p<0.01')
    expect(wrapper.get('code').text()).toBe('**x**')
    expect(wrapper.find('strong').exists()).toBe(false)
    expect(wrapper.text()).toContain('* p<0.05，** p<0.01')
  })

  // 这些是打开 Comark 全部默认插件时会丢内容的写法，见 markdownSyntax.ts
  it.each([
    ['[M+H]+ 和 [M-H]- 是离子', '[M+H]+ 和 [M-H]- 是离子'],
    ['集合 {x, y} 与 {a=1}', '集合 {x, y} 与 {a=1}'],
    ['[M+H]: 257.2', '[M+H]: 257.2'],
    ['棕榈酸[^1]\n\n[^1]: 见文献 A', '[^1]: 见文献 A'],
  ])('keeps the text of %s', async (text, kept) => {
    const wrapper = await render(text)
    expect(wrapper.text()).toContain(kept)
  })

  it('keeps ion names in tables without touching the next cell', async () => {
    const wrapper = await render(
      '| 离子 | 注释 |\n|---|---|\n| [M-H]- | 棕榈酸 |\n| [M+Cl]- | 油酸 |',
    )
    expect(wrapper.findAll('td').map((cell) => cell.text())).toEqual([
      '[M-H]-',
      '棕榈酸',
      '[M+Cl]-',
      '油酸',
    ])
  })

  it('does not take an answer that opens with a rule for metadata', async () => {
    const wrapper = await render('---\n\n## 结论\n\n内容\n\n---\n\n更多')
    expect(wrapper.get('h2').text()).toBe('结论')
    expect(wrapper.text()).toContain('内容')
    expect(wrapper.findAll('hr')).toHaveLength(2)
  })

  it('keeps a single newline as a line break', async () => {
    const wrapper = await render('第一行\n第二行')
    expect(wrapper.find('p br').exists()).toBe(true)
  })

  it('renders task lists', async () => {
    const wrapper = await render('- [x] 已完成\n- [ ] 未完成')
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(2)
    expect(wrapper.text()).not.toContain('[x]')
  })

  it('renders HTML from the model', async () => {
    const wrapper = await render(
      '| 列 |\n|---|\n| 一<br>二<br/>三 |\n\nC<sub>16</sub> [M+H]<sup>+</sup> <b>粗</b>\n\n<pre>abc</pre>',
    )
    expect(wrapper.findAll('td br')).toHaveLength(2)
    expect(wrapper.get('sub').text()).toBe('16')
    expect(wrapper.get('sup').text()).toBe('+')
    expect(wrapper.get('b').text()).toBe('粗')
    expect(wrapper.get('[data-slot="code-block-content"]').text()).toBe('abc')
  })

  it('opens links in a new tab', async () => {
    const wrapper = await render('[paper](https://pubmed.ncbi.nlm.nih.gov/1 "标题")')
    const link = wrapper.get('a')
    expect(link.attributes('href')).toBe('https://pubmed.ncbi.nlm.nih.gov/1')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('title')).toBe('标题')
  })

  it('shows images', async () => {
    const wrapper = await render('![图](https://example.org/a.png)')
    expect(wrapper.get('img').attributes('src')).toBe('https://example.org/a.png')
  })
})

describe('AssistantMarkdown math', () => {
  async function renderMath(text: string) {
    const wrapper = mount(AssistantMarkdown, { props: { text } })
    // 第一次要加载 KaTeX
    await vi.waitFor(() => expect(wrapper.find('.katex').exists()).toBe(true), { timeout: 10_000 })
    return wrapper
  }

  it('renders \\[...\\] as a display formula, also inside a list', async () => {
    const wrapper = await renderMath('1. 公式：\n   \\[\n   \\frac{a}{b}\n   \\]\n2. 下一项')
    expect(wrapper.find('li .katex-display').exists()).toBe(true)
    expect(wrapper.findAll('li')).toHaveLength(2)
  })

  it('renders \\(...\\) inline, also when it starts with a digit', async () => {
    const wrapper = await renderMath('实测 \\(m/z\\) 偏高 \\(2.35\\ \\text{ppm}\\)')
    expect(wrapper.findAll('p .katex')).toHaveLength(2)
    expect(wrapper.find('.katex-display').exists()).toBe(false)
  })

  it('renders $ and $$ delimiters, with Chinese in \\text', async () => {
    const wrapper = await renderMath('$x^2$\n\n$$\n\\text{误差}=1\n$$')
    expect(wrapper.find('p .katex').exists()).toBe(true)
    expect(wrapper.find('.katex-display').exists()).toBe(true)
  })

  it('renders chemical formulas', async () => {
    const wrapper = await renderMath('$\\ce{C16H32O2}$')
    expect(wrapper.find('.katex .katex-html').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('...')
  })

  it('does not take escaped ion brackets or prices for formulas', async () => {
    const wrapper = await render('\\[M+H\\]+ 与 \\[M-H\\]-，费用 $5 和 $10')
    expect(wrapper.find('.katex').exists()).toBe(false)
    expect(wrapper.text()).toContain('[M+H]+ 与 [M-H]-，费用 $5 和 $10')
  })

  it('leaves delimiters in code alone', async () => {
    const wrapper = await render('`\\(x\\)`\n\n```\n\\[ y \\]\n```')
    expect(wrapper.find('.katex').exists()).toBe(false)
    expect(wrapper.get('p code').text()).toBe('\\(x\\)')
    expect(wrapper.get('[data-slot="code-block-content"]').text()).toContain('\\[ y \\]')
  })

  it('renders a formula once it closes while streaming', async () => {
    const partial = '结果：\n\n\\[\n\\frac{a}{'
    const wrapper = mount(AssistantMarkdown, { props: { text: partial, streaming: true } })
    await flushPromises()
    await flushPromises()
    await wrapper.setProps({ text: `${partial}b}\n\\]` })
    await vi.waitFor(() => expect(wrapper.find('.katex-display').exists()).toBe(true), {
      timeout: 10_000,
    })
  })
})

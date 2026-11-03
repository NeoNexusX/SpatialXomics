/**
 * ctx.analysisBinding 服务：把会话和轮次绑定到当前分析的数据。
 *
 * 会话跟着数据集走，问题提交时捕获选中的离子、聚类、像素和注释权重，
 * 之后页面变了就不能继续用这轮的工具结果。页面状态经 bridge 读取。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { buildAnalysisSelection, buildPageState } from '../../bridge/analysisContext'
import { datasetBinding, onAgentDatasetChange } from '../../bridge/datasetBinding'
import { renderDataset } from '../../bridge/renderDataset'
import type { AnalysisBinding } from '../session'

declare module '@deepseek-ai/cordis' {
  interface Context {
    analysisBinding: AnalysisBindingService
  }
  interface Events {
    /** 换了数据集或重新加载，当前轮次和会话都作废 */
    'analysis-binding/changed'(): void
  }
}

export class AnalysisBindingService extends Service {
  static inject = ['systemPrompt']

  constructor(ctx: Context) {
    super(ctx, 'analysisBinding')
    let generation = datasetBinding().generation
    ctx.effect(() =>
      onAgentDatasetChange((binding) => {
        if (binding.generation === generation) return
        generation = binding.generation
        ctx.emit('analysis-binding/changed')
      }),
    )
    ctx.on('agent/guard', (binding, toolName) => this.assert(binding, toolName))
    ctx.on('agent/pre-turn', ({ plan, turnId }, next) => {
      const events = next()
      const { binding } = plan
      if (!binding.datasetId && !binding.page.selectedIon) return events
      return [
        ...events,
        {
          type: 'message',
          turnId,
          origin: 'context',
          message: {
            role: 'user',
            content: `[Analysis context captured for this question]
${JSON.stringify({ datasetId: binding.datasetId, selectedIon: binding.page.selectedIon, selection: binding.selection })}
Use these identities for analysis. Live page state may have changed.`,
          },
        },
      ]
    })
    ctx.systemPrompt.section({
      key: 'dataset',
      order: 10,
      render: ({ binding }) =>
        binding.page.dataset ? `## Dataset Context\n${renderDataset(binding.page.dataset)}` : '',
    })
  }

  /** 当前数据集，决定打开哪段会话 */
  datasetId(): string {
    return datasetBinding().id
  }

  /** 捕获提问时的数据身份和页面选择 */
  capture(): AnalysisBinding {
    return { ...this.captureDataset(), selection: buildAnalysisSelection() }
  }

  /** 只捕获数据身份，用于和具体选择无关的操作（如压缩） */
  captureDataset(): AnalysisBinding {
    const current = datasetBinding()
    return { datasetId: current.id, generation: current.generation, page: buildPageState() }
  }

  /** 重新生成时沿用原来的选择，换成当前的加载代次。导入的对话可能来自别的数据集，这时重新捕获 */
  rebase(binding: AnalysisBinding): AnalysisBinding {
    const current = datasetBinding()
    if (binding.datasetId !== current.id) return this.capture()
    return { ...binding, generation: current.generation }
  }

  /** 数据或选择已经变了就抛错，toolName 决定要核对哪项选择 */
  assert(binding: AnalysisBinding, toolName?: string): void {
    const current = datasetBinding()
    if (
      current.id !== binding.datasetId ||
      current.generation !== binding.generation ||
      !current.ready
    )
      throw new Error(
        'The analysis dataset changed or is still loading. Submit the question again when ready.',
      )
    if (
      toolName === 'get_ion_image_stats' &&
      JSON.stringify(buildPageState().selectedIon) !== JSON.stringify(binding.page.selectedIon)
    )
      throw new Error(
        'The selected ion changed after this question was submitted. Submit the question again for the new selection.',
      )
    const selection = buildAnalysisSelection()
    if (
      binding.selection &&
      toolName === 'get_kmeans_summary' &&
      JSON.stringify(selection.clusters) !== JSON.stringify(binding.selection.clusters)
    )
      throw new Error('The selected clusters changed. Submit the question again.')
    if (
      binding.selection &&
      toolName === 'get_pixel_spectrum' &&
      JSON.stringify(selection.pixel) !== JSON.stringify(binding.selection.pixel)
    )
      throw new Error('The selected pixel changed. Submit the question again.')
    if (
      binding.selection &&
      toolName?.startsWith('get_annotation') &&
      JSON.stringify(selection.annotationWeights) !==
        JSON.stringify(binding.selection.annotationWeights)
    )
      throw new Error('Annotation scoring settings changed. Submit the question again.')
  }
}

import { z } from 'zod'
import type { SessionEvent } from './types'

const count = z.number().int().nonnegative()
const nodes = z.array(count)
const failure = z.object({
  message: z.string(),
  code: z.string(),
  status: count.optional(),
  providerRetryAfterMs: count.optional(),
  requestId: z.string().optional(),
})
const usage = z.object({
  inputTokens: count,
  outputTokens: count,
  promptTokens: count.optional(),
  totalTokens: count.optional(),
  cacheReadTokens: count.optional(),
  cacheWriteTokens: count.optional(),
  reasoningTokens: count.optional(),
})
const part = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('reasoning'), text: z.string() }),
  z.object({
    type: z.literal('tool-call'),
    id: z.string(),
    name: z.string(),
    arguments: z.string(),
  }),
])
const attachment = z.object({
  id: z.string(),
  mime: z.string(),
  bytes: count,
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  label: z.string().optional(),
})
const user = z.object({
  role: z.literal('user'),
  content: z.string(),
  attachments: z.array(attachment).optional(),
})
const message = z.discriminatedUnion('role', [
  user,
  z.object({
    role: z.literal('assistant'),
    parts: z.array(part),
    source: z
      .object({
        endpoint: z.literal('anthropic'),
        model: z.string(),
        baseUrl: z.string().optional(),
        replayState: z
          .object({ response: z.unknown(), blocks: z.array(z.unknown()).readonly().optional() })
          .optional(),
      })
      .optional(),
  }),
  z.object({
    role: z.literal('tool'),
    toolCallId: z.string(),
    name: z.string(),
    content: z.string(),
    isError: z.boolean().optional(),
    attachments: z.array(attachment).optional(),
  }),
])
const route = z.object({ endpoint: z.literal('anthropic'), baseUrl: z.string(), model: z.string() })
const request = z.object({
  nodes,
  route,
  system: z.string().optional(),
  tools: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        parameters: z.object({
          type: z.literal('object'),
          properties: z.record(z.string(), z.record(z.string(), z.unknown())),
          required: z.array(z.string()).optional(),
        }),
      }),
    )
    .optional(),
  maxTokens: count.optional(),
  contextWindow: count,
  imageMode: z.enum(['image', 'placeholder']),
  purpose: z.enum(['conversation', 'compaction']),
  turnStart: count.optional(),
})
const schemas = [
  z.object({
    type: z.literal('turn/start'),
    turnId: z.string(),
    user,
    binding: z.object({
      datasetId: z.string(),
      generation: count,
      page: z.record(z.string(), z.unknown()),
      selection: z
        .object({
          clusters: z.array(count),
          kmeansK: count.nullable().optional(),
          pixel: z.object({ index: count, x: count, y: count }).optional(),
          annotationWeights: z
            .object({ mass: z.number(), adduct: z.number(), spatial: z.number() })
            .optional(),
        })
        .optional(),
    }),
    baseSurface: nodes,
    retryOf: z.string().optional(),
  }),
  z.object({
    type: z.literal('turn/end'),
    turnId: z.string(),
    reason: z.enum(['completed', 'interrupted', 'failed']),
    error: z.string().optional(),
    failure: failure.optional(),
  }),
  z.object({ type: z.literal('step/start'), turnId: z.string(), step: count }),
  z.object({ type: z.literal('step/end'), turnId: z.string(), step: count }),
  z.object({
    type: z.literal('message'),
    turnId: z.string().optional(),
    message,
    callKey: z.string().optional(),
    archiveId: z.string().optional(),
    origin: z.literal('context').optional(),
    surfaceOp: z
      .union([z.literal('append'), z.object({ op: z.literal('replace'), nodes })])
      .optional(),
    surfaceReason: z.enum(['summary', 'tool-retention', 'image-offload']).optional(),
  }),
  z.object({
    type: z.literal('request/context'),
    turnId: z.string().optional(),
    attemptId: z.string(),
    request,
  }),
  z.object({
    type: z.literal('attempt/start'),
    turnId: z.string(),
    attemptId: z.string(),
    step: count,
    request,
  }),
  z.object({
    type: z.literal('attempt/end'),
    turnId: z.string(),
    attemptId: z.string(),
    status: z.enum(['committed', 'failed', 'interrupted']),
    usage: usage.optional(),
    failure: failure.optional(),
  }),
  z.object({
    type: z.literal('tool/start'),
    turnId: z.string(),
    callKey: z.string(),
    callId: z.string(),
    name: z.string(),
    input: z.unknown(),
  }),
  z.object({ type: z.literal('surface/reset'), nodes }),
  z.object({
    type: z.literal('compaction/request'),
    compactionId: z.string(),
    inputId: z.string(),
    request,
  }),
  z.object({ type: z.literal('compaction/start'), compactionId: z.string(), nodes }),
  z.object({
    type: z.literal('compaction/summary'),
    compactionId: z.string(),
    summary: z.string(),
    route,
    maxTokens: count,
  }),
  z.object({
    type: z.literal('compaction/end'),
    compactionId: z.string(),
    error: z.string().optional(),
    beforeTokens: count.optional(),
    afterTokens: count.optional(),
    usage: usage.optional(),
  }),
  z.object({ type: z.literal('instructions/set'), name: z.string(), text: z.string() }),
  z.object({
    type: z.literal('transport/strategy'),
    attemptId: z.string(),
    strategy: z.object({ replay: z.string(), thinking: z.string() }),
  }),
] as const
const schema = z
  .discriminatedUnion('type', schemas)
  .and(z.object({ seq: count, id: z.string(), time: count }))

export function parseEvent(value: unknown): SessionEvent {
  return schema.parse(value) as SessionEvent
}

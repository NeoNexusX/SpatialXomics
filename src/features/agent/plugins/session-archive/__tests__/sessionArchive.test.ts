import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { setAgentDataset } from '../../../bridge/datasetBinding'
import {
  createLockedAgent,
  text,
  toolCall,
  type LockedAgent,
} from '../../../__tests__/lockedAgent'
import { makeBatch } from '../../session-persistence'
import { InvalidSessionArchiveError } from '../index'

const IMAGE = 'data:image/png;base64,iVBORw0KGgo='

const open: LockedAgent[] = []
async function setup(...args: Parameters<typeof createLockedAgent>) {
  const h = await createLockedAgent(...args)
  await h.agent.ready()
  open.push(h)
  return h
}
async function turn(h: LockedAgent, value = 'question', images?: string[]) {
  await h.agent.send(value, images)
  await h.agent.whenIdle()
}
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())
const asFile = (bytes: Uint8Array) => new Blob([bytes as BlobPart])

/** 打开导出的文件，改完再打包回去 */
async function tampered(h: LockedAgent, change: (files: Zippable, lines: string[]) => void) {
  const { blob } = await h.ctx.sessionArchive.pack(h.agent.snapshot().sessionId)
  const files: Zippable = { ...unzipSync(await bytesOf(blob)) }
  const lines = strFromU8(files['session.jsonl'] as Uint8Array)
    .split('\n')
    .filter(Boolean)
  change(files, lines)
  files['session.jsonl'] = strToU8(lines.map((line) => `${line}\n`).join(''))
  return asFile(zipSync(files))
}

// jsdom 的 Blob 没有 arrayBuffer，浏览器都有
beforeAll(() => {
  Blob.prototype.arrayBuffer ??= function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(this)
    })
  }
})

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(
    'assistant_connection',
    JSON.stringify({ endpoint: 'anthropic', baseUrl: 'https://llm.test', apiKey: 'sk-secret', model: 'm' }),
  )
  setAgentDataset('dataset-a', true)
})

afterEach(async () => {
  for (const h of open.splice(0)) await h.dispose()
})

describe('exporting a conversation', () => {
  it('packs the log and every artifact, and leaves the API key out', async () => {
    const h = await setup([toolCall('lookup'), text('answer')])
    await turn(h, 'look at this', [IMAGE])
    const id = h.agent.snapshot().sessionId
    const { blob, filename } = await h.ctx.sessionArchive.pack(id)
    expect(filename).toBe(`sxo-conversation-${id.slice(0, 8)}.zip`)

    const entries = unzipSync(await bytesOf(blob))
    const log = strFromU8(entries['session.jsonl']!)
    const [header, ...lines] = log.split('\n').filter(Boolean)
    expect(JSON.parse(header!)).toMatchObject({
      format: 'sxo-session',
      version: 1,
      id,
      datasetId: 'dataset-a',
    })
    const storage = h.storages[0]!.storage
    expect(lines).toEqual((await storage.read()).map((batch) => JSON.stringify(batch)))
    const artifacts = await storage.listArtifacts()
    // 一张图片，一个工具结果存档
    expect(artifacts).toHaveLength(2)
    for (const artifact of artifacts)
      expect(entries[`artifacts/${artifact}`]).toEqual(
        await bytesOf(await storage.getArtifact(artifact)),
      )
    expect(log).not.toContain('sk-secret')
  })
})

describe('importing a conversation file', () => {
  it('returns exactly what was exported', async () => {
    const h = await setup([toolCall('lookup'), text('answer')])
    await turn(h, 'look at this', [IMAGE])
    const id = h.agent.snapshot().sessionId
    const { blob } = await h.ctx.sessionArchive.pack(id)
    const archive = await h.ctx.sessionArchive.unpack(blob)
    const storage = h.storages[0]!.storage
    expect(archive.id).toBe(id)
    expect(archive.batches).toEqual(await storage.read())
    expect([...archive.artifacts.keys()].sort()).toEqual((await storage.listArtifacts()).sort())
    for (const [name, value] of archive.artifacts)
      expect(await bytesOf(value)).toEqual(await bytesOf(await storage.getArtifact(name)))
  })

  it('accepts a conversation that was exported mid-turn', async () => {
    const h = await setup([text('answer')])
    await turn(h)
    const file = await tampered(h, (_files, lines) => {
      expect(lines.pop()).toContain('turn/end')
    })
    expect((await h.ctx.sessionArchive.unpack(file)).batches.length).toBeGreaterThan(0)
  })

  it('collapses a batch repeated verbatim, as the writer does on a retried save', async () => {
    const h = await setup([text('answer')])
    await turn(h)
    const file = await tampered(h, (_files, lines) => {
      lines.push(lines[1]!)
    })
    const archive = await h.ctx.sessionArchive.unpack(file)
    expect(archive.batches).toEqual(await h.storages[0]!.storage.read())
  })

  it('ignores files a zip tool added', async () => {
    const h = await setup([text('answer')])
    await turn(h)
    const file = await tampered(h, (files) => {
      files['__MACOSX/session.jsonl'] = strToU8('junk')
      files['artifacts/'] = new Uint8Array()
    })
    expect((await h.ctx.sessionArchive.unpack(file)).artifacts.size).toBe(0)
  })

  const invalid: [string, (files: Zippable, lines: string[]) => void][] = [
    ['a file without a log', (files, lines) => {
      lines.length = 0
      lines.push('{}')
      files['other.txt'] = strToU8('x')
    }],
    ['another format', (_files, lines) => {
      lines[0] = JSON.stringify({ ...JSON.parse(lines[0]!), format: 'other' })
    }],
    ['a newer version', (_files, lines) => {
      lines[0] = JSON.stringify({ ...JSON.parse(lines[0]!), version: 2 })
    }],
    ['an empty conversation', (_files, lines) => {
      lines.length = 1
    }],
    ['a broken line', (_files, lines) => {
      lines[1] = '{broken'
    }],
    ['a batch edited after export', (_files, lines) => {
      lines[1] = lines[1]!.replace('question', 'changed!')
    }],
    ['a missing batch', (_files, lines) => {
      lines.splice(1, 1)
    }],
    ['a batch id used twice for different content', (_files, lines) => {
      lines.push(JSON.stringify({ ...JSON.parse(lines[1]!), events: [] }))
    }],
    ['an event of an unknown type', (_files, lines) => {
      const count = JSON.parse(lines[lines.length - 1]!)
      const next = count.from + count.events.length
      lines.push(JSON.stringify(makeBatch('new', next, [{ type: 'nope', seq: next, id: 'x', time: 1 }])))
    }],
    ['events that break the turn structure', (_files, lines) => {
      const count = JSON.parse(lines[lines.length - 1]!)
      const next = count.from + count.events.length
      const event = { type: 'turn/end', turnId: 'other', reason: 'completed', seq: next, id: 'x', time: 1 }
      lines.push(JSON.stringify(makeBatch('new', next, [event])))
    }],
    ['an artifact name that could escape its directory', (files) => {
      files['artifacts/../../header.json'] = strToU8('x')
    }],
  ]
  it.each(invalid)('rejects %s', async (_name, change) => {
    const h = await setup([text('answer')])
    await turn(h)
    const file = await tampered(h, change)
    await expect(h.ctx.sessionArchive.unpack(file)).rejects.toBeInstanceOf(
      InvalidSessionArchiveError,
    )
  })

  it('rejects a file that lost an image the conversation refers to', async () => {
    const h = await setup([text('answer')])
    await turn(h, 'look', [IMAGE])
    const [image] = await h.storages[0]!.storage.listArtifacts()
    const file = await tampered(h, (files) => {
      delete files[`artifacts/${image}`]
    })
    await expect(h.ctx.sessionArchive.unpack(file)).rejects.toThrow('Missing attachment')
  })

  it('rejects something that is not a zip at all', async () => {
    const h = await setup()
    await expect(h.ctx.sessionArchive.unpack(asFile(strToU8('not a zip')))).rejects.toBeInstanceOf(
      InvalidSessionArchiveError,
    )
  })
})

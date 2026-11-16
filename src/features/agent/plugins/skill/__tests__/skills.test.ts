import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SkillsRegistry } from '../index'
let ctx: Context
beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(SkillsRegistry)
})
afterEach(async () => {
  await ctx.fiber.dispose()
})

it('routes to the advertised provider and preserves load failures', async () => {
  const loadOther = vi.fn(async () => 'unrelated')
  ctx.skills.registerProvider('other', {
    name: 'other',
    list: () => [{ name: 'other', description: 'other' }],
    load: loadOther,
  })
  ctx.skills.registerProvider('broken', {
    name: 'broken',
    list: () => [{ name: 'target', description: 'target' }],
    async load() {
      throw new Error('storage unavailable')
    },
  })
  await expect(ctx.skills.load('target')).rejects.toThrow('storage unavailable')
  expect(loadOther).not.toHaveBeenCalled()
  await expect(ctx.skills.load('missing')).rejects.toThrow('not found')
})

it('unregisters providers on plugin disposal and rejects duplicate registrations', async () => {
  const provider = {
    name: 'p',
    list: () => [{ name: 's', description: 's' }],
    load: async () => 'instructions',
  }
  const fork = ctx.plugin({
    inject: ['skills'],
    apply(child: Context) {
      child.skills.registerProvider('p', provider)
    },
  })
  await fork
  await vi.waitFor(() => expect(ctx.skills.catalog()).toHaveLength(1))
  expect(() => ctx.skills.registerProvider('p', provider)).toThrow('already registered')
  await fork.dispose()
  expect(ctx.skills.catalog()).toEqual([])
})

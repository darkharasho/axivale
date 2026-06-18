import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { evalMode, fixturePath, loadFixture, saveFixture, fixtureModel, fixtureFetch } from './harness'

const GROUP = '__selftest__'
const ID = 'case-a'

afterEach(() => {
  const p = fixturePath(GROUP, ID, 'txt')
  if (existsSync(p)) rmSync(p)
  const fp = fixturePath('__selftest__', 'fetch-a', 'json')
  if (existsSync(fp)) rmSync(fp)
  delete process.env.EVAL_LIVE
  delete process.env.EVAL_RECORD
})

describe('evalMode', () => {
  it('defaults to replay; EVAL_LIVE=live; EVAL_RECORD wins', () => {
    expect(evalMode()).toBe('replay')
    process.env.EVAL_LIVE = '1'
    expect(evalMode()).toBe('live')
    process.env.EVAL_RECORD = '1'
    expect(evalMode()).toBe('record')
  })
})

describe('fixtureFetch', () => {
  it('replays GW2 item/itemstats responses keyed by ids= param', async () => {
    saveFixture('__selftest__', 'fetch-a', 'json', JSON.stringify({
      items: { '10': { name: 'Test Sword', icon: null, type: 'Weapon', details: { type: 'Sword' } } },
      itemstats: { '99': { name: "Minstrel's" } }
    }))
    const f = fixtureFetch('__selftest__', 'fetch-a')
    const items = await (await f('https://api.guildwars2.com/v2/items?ids=10&lang=en')).json()
    expect(items).toEqual([{ id: 10, name: 'Test Sword', icon: null, type: 'Weapon', details: { type: 'Sword' } }])
    const stats = await (await f('https://api.guildwars2.com/v2/itemstats?ids=99&lang=en')).json()
    expect(stats).toEqual([{ id: 99, name: "Minstrel's" }])
  })
})

describe('fixtureModel', () => {
  it('replays a saved fixture and ignores the live model', async () => {
    saveFixture(GROUP, ID, 'txt', 'recorded-output')
    const model = fixtureModel(GROUP, ID, async () => 'LIVE')
    expect(await model('any prompt')).toBe('recorded-output')
  })

  it('throws a helpful error when the fixture is missing in replay mode', async () => {
    const model = fixtureModel(GROUP, ID)
    await expect(model('p')).rejects.toThrow(/missing fixture/i)
  })

  it('record mode calls live and writes the fixture', async () => {
    process.env.EVAL_RECORD = '1'
    const model = fixtureModel(GROUP, ID, async () => 'fresh-from-model')
    expect(await model('p')).toBe('fresh-from-model')
    expect(loadFixture(GROUP, ID, 'txt')).toBe('fresh-from-model')
  })
})

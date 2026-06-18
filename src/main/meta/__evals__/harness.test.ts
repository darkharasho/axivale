import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { evalMode, fixturePath, loadFixture, saveFixture, fixtureModel } from './harness'

const GROUP = '__selftest__'
const ID = 'case-a'

afterEach(() => {
  const p = fixturePath(GROUP, ID, 'txt')
  if (existsSync(p)) rmSync(p)
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

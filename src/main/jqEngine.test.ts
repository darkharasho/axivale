import { describe, it, expect } from 'vitest'
import { jqEngine } from './jqEngine'

describe('jqEngine', () => {
  it('returns all outputs of an expression as an array', async () => {
    const doc = { rollup: { playerRows: [{ account: 'A', hrs: 3 }, { account: 'B', hrs: 1 }] } }
    const out = await jqEngine.run('.rollup.playerRows[] | .account', doc)
    expect(out).toEqual(['A', 'B'])
  })

  it('returns a single scalar wrapped in a one-element array', async () => {
    const out = await jqEngine.run('.runs | length', { runs: [1, 2, 3] })
    expect(out).toEqual([3])
  })

  it('rejects on an invalid expression', async () => {
    await expect(jqEngine.run('.[', {})).rejects.toBeInstanceOf(Error)
  })
})

import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchEliteSpecMap, __resetSpecMapCache } from './specMap'

afterEach(() => {
  vi.unstubAllGlobals()
  __resetSpecMapCache()
})

describe('fetchEliteSpecMap', () => {
  it('maps elite spec name to profession, skipping core specs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { id: 1, name: 'Radiance', profession: 'Guardian', elite: false },
          { id: 2, name: 'Luminary', profession: 'Guardian', elite: true },
          { id: 3, name: 'Amalgam', profession: 'Engineer', elite: true }
        ]
      })
    )
    const map = await fetchEliteSpecMap()
    expect(map).toEqual({ Luminary: 'Guardian', Amalgam: 'Engineer' })
  })
  it('returns {} on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    expect(await fetchEliteSpecMap()).toEqual({})
  })
  it('returns {} on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await fetchEliteSpecMap()).toEqual({})
  })
  it('caches after first success (no second fetch)', async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 2, name: 'Luminary', profession: 'Guardian', elite: true }]
    })
    vi.stubGlobal('fetch', f)
    await fetchEliteSpecMap()
    await fetchEliteSpecMap()
    expect(f).toHaveBeenCalledTimes(1)
  })
})

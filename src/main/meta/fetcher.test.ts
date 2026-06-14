// src/main/meta/fetcher.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchWiki } from './fetcher'

const cfg = { host: 'metabattle.com', kind: 'wiki' as const, wikiApi: 'https://metabattle.com/api.php' }

afterEach(() => vi.unstubAllGlobals())

describe('fetchWiki', () => {
  it('parses the page title from the url and returns wikitext', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ parse: { wikitext: 'Zerg builds: Scourge, Firebrand' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const r = await fetchWiki('https://metabattle.com/wiki/Category:WvW_Zerg_Builds', cfg)
    expect(r).toEqual({ ok: true, text: 'Zerg builds: Scourge, Firebrand' })
    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).toContain('https://metabattle.com/api.php')
    expect(calledUrl).toContain('Category%3AWvW_Zerg_Builds')
  })

  it('returns an error result on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    const r = await fetchWiki('https://metabattle.com/wiki/Nope', cfg)
    expect(r.ok).toBe(false)
  })

  it('returns an error result when the payload has no wikitext', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    const r = await fetchWiki('https://metabattle.com/wiki/Nope', cfg)
    expect(r.ok).toBe(false)
  })
})

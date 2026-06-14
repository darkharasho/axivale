// src/main/meta/fetcher.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchWiki, pickCrawlLinks, normalizeUrl } from './fetcher'

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
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.text).toBe('Zerg builds: Scourge, Firebrand')
      expect(r.pages).toEqual([
        { url: 'https://metabattle.com/wiki/Category:WvW_Zerg_Builds', title: 'Category:WvW_Zerg_Builds', text: 'Zerg builds: Scourge, Firebrand' }
      ])
    }
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

describe('pickCrawlLinks', () => {
  it('dedupes by origin+pathname and caps to max', () => {
    const links = pickCrawlLinks(
      ['https://snowcrows.com/builds/a', 'https://snowcrows.com/builds/a?x=1', 'https://snowcrows.com/builds/b', 'https://snowcrows.com/builds/c'],
      'https://snowcrows.com/builds',
      2
    )
    expect(links).toEqual(['https://snowcrows.com/builds/a', 'https://snowcrows.com/builds/b'])
  })

  it('drops the landing page itself (ignoring trailing slash)', () => {
    const links = pickCrawlLinks(['https://hardstuck.gg/gw2/builds/', 'https://hardstuck.gg/gw2/builds/x'], 'https://hardstuck.gg/gw2/builds', 5)
    expect(links).toEqual(['https://hardstuck.gg/gw2/builds/x'])
  })

  it('skips namespaced wiki paths (a colon in the path)', () => {
    const links = pickCrawlLinks(
      ['https://metabattle.com/wiki/Category:PvE_builds', 'https://metabattle.com/wiki/Template:Foo', 'https://metabattle.com/wiki/Power_Tempest'],
      'https://metabattle.com/wiki/Category:PvE_builds',
      5
    )
    expect(links).toEqual(['https://metabattle.com/wiki/Power_Tempest'])
  })

  it('skips malformed hrefs', () => {
    expect(pickCrawlLinks(['not a url', 'https://x.com/a'], 'https://x.com', 5)).toEqual(['https://x.com/a'])
  })

  it('skips off-site links', () => {
    const links = pickCrawlLinks(
      ['https://snowcrows.com/builds/a', 'https://discord.gg/x', 'https://twitter.com/y'],
      'https://snowcrows.com/builds',
      5
    )
    expect(links).toEqual(['https://snowcrows.com/builds/a'])
  })
})

describe('normalizeUrl', () => {
  it('strips trailing slash, query, and hash', () => {
    expect(normalizeUrl('https://x.com/a/b/?q=1#f')).toBe('https://x.com/a/b')
  })
  it('keeps a bare path', () => {
    expect(normalizeUrl('https://x.com/a')).toBe('https://x.com/a')
  })
  it('returns null for malformed input', () => {
    expect(normalizeUrl('not a url')).toBeNull()
  })
})

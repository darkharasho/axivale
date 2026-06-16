import { describe, it, expect } from 'vitest'
import { liveWikiSearch } from './liveSearch'

describe('liveWikiSearch', () => {
  it('searches titles then fetches+cleans each page', async () => {
    const fetchJson = async () => ({ query: { search: [{ title: 'Twilight' }, { title: 'Sunrise' }] } })
    const getWikitext = async (t: string) => `Wikitext body for ${t} that is definitely longer than fifty characters of content.`
    const res = await liveWikiSearch('how to craft twilight', { fetchJson, getWikitext }, { limit: 2 })
    expect(res.map((r) => r.title)).toEqual(['Twilight', 'Sunrise'])
    expect(res[0].url).toBe('https://wiki.guildwars2.com/wiki/Twilight')
    expect(res[0].snippet.length).toBeGreaterThan(0)
  })
  it('skips pages whose wikitext is missing', async () => {
    const fetchJson = async () => ({ query: { search: [{ title: 'Ghost' }] } })
    const getWikitext = async () => null
    const res = await liveWikiSearch('x', { fetchJson, getWikitext })
    expect(res).toEqual([])
  })
})

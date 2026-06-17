import { describe, it, expect } from 'vitest'
import { liveWikiSearch, cleanWikiHtml, searchTerms } from './liveSearch'

describe('liveWikiSearch', () => {
  it('searches titles then fetches each page as rendered text', async () => {
    const fetchJson = async () => ({ query: { search: [{ title: 'Twilight' }, { title: 'Sunrise' }] } })
    const getPageText = async (t: string) =>
      `Rendered page text for ${t} that is definitely longer than fifty characters of content.`
    const res = await liveWikiSearch('how to craft twilight', { fetchJson, getPageText }, { limit: 2 })
    expect(res.map((r) => r.title)).toEqual(['Twilight', 'Sunrise'])
    expect(res[0].url).toBe('https://wiki.guildwars2.com/wiki/Twilight')
    expect(res[0].snippet).toContain('Rendered page text for Twilight')
  })
  it('skips pages whose rendered text is missing', async () => {
    const fetchJson = async () => ({ query: { search: [{ title: 'Ghost' }] } })
    const getPageText = async () => null
    const res = await liveWikiSearch('x', { fetchJson, getPageText })
    expect(res).toEqual([])
  })
})

describe('searchTerms', () => {
  it('reduces a conversational query to its keyword core', () => {
    expect(searchTerms('how do I make the precursor Dusk')).toBe('precursor dusk')
    expect(searchTerms('how do I craft the precursor for The Bifrost')).toBe('precursor bifrost')
  })
  it('keeps the original query when stripping would leave nothing', () => {
    expect(searchTerms('how to')).toBe('how to')
    expect(searchTerms('what is it')).toBe('what is it')
  })
  it('lowercases the keyword core for a single content word', () => {
    expect(searchTerms('Boon')).toBe('boon')
  })
})

describe('cleanWikiHtml', () => {
  it('keeps table/collection rows as text and drops tags + edit links', () => {
    const html =
      '<h2>Collection items<span class="mw-editsection">[edit]</span></h2>' +
      '<table><tr><td>Gloominator</td><td>Item</td></tr><tr><td>Aquatic&#160;Murk</td><td>Trophy</td></tr></table>'
    const text = cleanWikiHtml(html)
    expect(text).toContain('Collection items')
    expect(text).toContain('Gloominator')
    expect(text).toContain('Aquatic Murk')
    expect(text).not.toContain('<td>')
    expect(text).not.toContain('[edit]')
    expect(text).not.toContain('mw-editsection')
  })
})

import { describe, it, expect } from 'vitest'
import { corpusForUrl } from './corpus'

describe('corpusForUrl', () => {
  it('routes the GW2 wiki to wiki', () => {
    expect(corpusForUrl('https://wiki.guildwars2.com/wiki/Twilight')).toBe('wiki')
  })
  it('routes Discretize (both subdomains) to general', () => {
    expect(corpusForUrl('https://discretize.eu/guides/')).toBe('general')
    expect(corpusForUrl('https://next.discretize.eu/fractals/')).toBe('general')
  })
  it('routes /guides/ paths to general regardless of host', () => {
    expect(corpusForUrl('https://snowcrows.com/guides/wvw/wvw-basics')).toBe('general')
    expect(corpusForUrl('https://hardstuck.gg/gw2/guides/something')).toBe('general')
  })
  it('routes build pages to meta', () => {
    expect(corpusForUrl('https://snowcrows.com/builds/raids')).toBe('meta')
    expect(corpusForUrl('https://metabattle.com/wiki/Raid_Builds')).toBe('meta')
    expect(corpusForUrl('https://guildjen.com/gw2-raid-builds/')).toBe('meta')
  })
  it('defaults unparseable input to meta', () => {
    expect(corpusForUrl('not a url')).toBe('meta')
  })
})

// src/main/meta/sources.test.ts
import { describe, it, expect } from 'vitest'
import { SOURCE_CONFIGS, configForUrl } from './sources'

describe('source registry', () => {
  it('every config is well-formed for its kind', () => {
    for (const c of SOURCE_CONFIGS) {
      expect(c.host).toBeTruthy()
      if (c.kind === 'browser') expect(c.selector).toBeTruthy()
      if (c.kind === 'wiki') expect(c.wikiApi).toBeTruthy()
    }
  })

  it('matches snowcrows to a browser config', () => {
    expect(configForUrl('https://snowcrows.com/builds')?.kind).toBe('browser')
  })

  it('matches metabattle to a browser config with the wiki content selector', () => {
    const c = configForUrl('https://metabattle.com/wiki/Category:WvW_Zerg_Builds')
    expect(c?.kind).toBe('browser')
    expect(c?.selector).toBe('#mw-content-text')
  })

  it('ignores a leading www', () => {
    expect(configForUrl('https://www.guildjen.com/x')?.kind).toBe('browser')
  })

  it('returns null for an unknown host', () => {
    expect(configForUrl('https://example.com')).toBeNull()
  })

  it('returns null for a malformed url', () => {
    expect(configForUrl('not a url')).toBeNull()
  })

  it('configures depth-1 link selectors for the build databases', () => {
    expect(configForUrl('https://snowcrows.com/builds')?.linkSelector).toBeTruthy()
    expect(configForUrl('https://metabattle.com/wiki/Category:PvE_builds')?.linkSelector).toBeTruthy()
    expect(configForUrl('https://hardstuck.gg/gw2/builds/')?.linkSelector).toBeTruthy()
  })

  it('crawls the build databases two levels deep', () => {
    expect(configForUrl('https://snowcrows.com/builds')?.crawlDepth).toBe(2)
    expect(configForUrl('https://hardstuck.gg/gw2/builds/')?.crawlDepth).toBe(2)
    expect(configForUrl('https://metabattle.com/wiki/Category:PvE_builds')?.crawlDepth).toBeUndefined()
  })
})

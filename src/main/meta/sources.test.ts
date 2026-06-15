// src/main/meta/sources.test.ts
import { describe, it, expect } from 'vitest'
import { SOURCE_CONFIGS, configForUrl, resolveContent } from './sources'

describe('source registry', () => {
  it('every config is well-formed for its kind', () => {
    for (const c of SOURCE_CONFIGS) {
      expect(c.host).toBeTruthy()
      if (c.kind === 'browser') expect(c.selector).toBeTruthy()
      if (c.kind === 'wiki') expect(c.wikiApi).toBeTruthy()
    }
  })

  it('uses the static extractor for Snowcrows', () => {
    const c = configForUrl('https://snowcrows.com/builds/raids')
    expect(c?.kind).toBe('static')
    expect(c?.crawlDepth).toBe(2)
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
    expect(configForUrl('https://metabattle.com/wiki/Category:PvE_builds')?.linkSelector).toBeTruthy()
    expect(configForUrl('https://hardstuck.gg/gw2/builds/')?.linkSelector).toBeTruthy()
  })

  it('crawls the build databases two levels deep', () => {
    expect(configForUrl('https://snowcrows.com/builds')?.crawlDepth).toBe(2)
    expect(configForUrl('https://hardstuck.gg/gw2/builds/')?.crawlDepth).toBe(2)
    expect(configForUrl('https://metabattle.com/wiki/Category:PvE_builds')?.crawlDepth).toBeUndefined()
  })

  it('tags WvW guide/wiki pages as rules and build pages as builds', () => {
    expect(resolveContent('https://wiki.guildwars2.com/wiki/Boon')).toBe('rules')
    expect(resolveContent('https://snowcrows.com/guides/wvw/wvw-basics-understanding-roles')).toBe('rules')
    expect(resolveContent('https://guildorder.com/games/gw2/guides/wvw-squad-leadership')).toBe('rules')
    expect(resolveContent('https://snowcrows.com/builds/wvw')).toBe('builds')
    expect(resolveContent('https://metabattle.com/wiki/WvW')).toBe('builds')
  })

  it('crawls the snowcrows WvW news landing into the latest tier list', () => {
    const cfg = configForUrl('https://snowcrows.com/news/wvw')
    expect(cfg?.kind).toBe('browser')
    expect(cfg?.linkSelector).toBeTruthy()
    expect(cfg?.crawlDepth ?? 0).toBeGreaterThanOrEqual(1)
  })

  it('keeps snowcrows build pages static', () => {
    expect(configForUrl('https://snowcrows.com/builds/wvw')?.kind).toBe('static')
  })

  it('uses tight per-build content selectors (slice 1)', () => {
    const hs = configForUrl('https://hardstuck.gg/gw2/builds/mesmer/power-virtuoso')
    expect(hs?.selector).toBe('section.gw2-build-page')
    const gj = configForUrl('https://guildjen.com/gw2-wvw-builds/')
    expect(gj?.selector).toBe('.entry-content')
    expect(gj?.linkSelector).toBeTruthy()
    expect(gj?.crawlDepth).toBe(2)
    const gm = configForUrl('https://gw2mists.com/en/builds?mode=zerg')
    expect(gm?.selector).toBeTruthy()
    expect(gm?.selector).not.toBe('body')
    expect(gm?.linkSelector).toBeTruthy()
    expect(gm?.crawlDepth).toBe(2)
    // MetaBattle unchanged
    expect(configForUrl('https://metabattle.com/wiki/Build:X')?.selector).toBe('#mw-content-text')
  })
})

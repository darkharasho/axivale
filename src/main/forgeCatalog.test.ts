import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ForgeCatalogCache } from './forgeCatalog'

const upgrades = {
  runes: [{ id: 24836, name: 'Superior Rune of the Pack', icon: 'https://render.guildwars2.com/r.png', bonuses: ['+25 Power'] }],
  relics: [{ name: 'Relic of the Defender', icon: 'https://render.guildwars2.com/d.png' }]
}

function makeCache(fetcher: () => Promise<typeof upgrades>): ForgeCatalogCache {
  return new ForgeCatalogCache(mkdtempSync(join(tmpdir(), 'forge-cat-')), fetcher)
}

describe('ForgeCatalogCache', () => {
  it('fetches once and serves from cache within the TTL', async () => {
    const fetcher = vi.fn().mockResolvedValue(upgrades)
    const cache = makeCache(fetcher)
    expect(await cache.getUpgrades()).toEqual(upgrades)
    expect(await cache.getUpgrades()).toEqual(upgrades)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('persists across instances (disk cache)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-cat-'))
    const first = new ForgeCatalogCache(dir, vi.fn().mockResolvedValue(upgrades))
    await first.getUpgrades()
    const failing = vi.fn().mockRejectedValue(new Error('AxiForge not running'))
    const second = new ForgeCatalogCache(dir, failing)
    expect(await second.getUpgrades()).toEqual(upgrades)
    expect(failing).not.toHaveBeenCalled()
  })

  it('serves stale data when the API is down after TTL expiry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-cat-'))
    const cache = new ForgeCatalogCache(dir, vi.fn().mockResolvedValue(upgrades), 0) // ttl 0 = always stale
    await cache.getUpgrades()
    const down = new ForgeCatalogCache(dir, vi.fn().mockRejectedValue(new Error('down')), 0)
    expect(await down.getUpgrades()).toEqual(upgrades)
  })

  it('returns null when nothing is cached and the API is down', async () => {
    const cache = makeCache(vi.fn().mockRejectedValue(new Error('down')))
    expect(await cache.getUpgrades()).toBeNull()
  })
})

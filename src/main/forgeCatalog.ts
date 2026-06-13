import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface ForgeUpgradeCatalog {
  runes: Array<{ id: number; name: string; icon?: string; bonuses?: string[] }>
  relics: Array<{ name: string; icon?: string }>
}

interface CacheFile {
  fetchedAt: number
  upgrades: ForgeUpgradeCatalog
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Persistent cache for AxiForge catalog data used by inline cards.
 * Cards must render even when AxiForge is closed, so stale data is served
 * whenever a refresh fails; null only when we've never connected at all.
 * The fetcher is axiforgeClient.catalogUpgrades (sibling AxiForge plan).
 */
export class ForgeCatalogCache {
  private readonly file: string

  constructor(
    cacheDir: string,
    private readonly fetchUpgrades: () => Promise<ForgeUpgradeCatalog>,
    private readonly ttlMs: number = DEFAULT_TTL_MS
  ) {
    mkdirSync(cacheDir, { recursive: true })
    this.file = join(cacheDir, 'forge-catalog.json')
  }

  private read(): CacheFile | null {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as CacheFile
    } catch {
      return null
    }
  }

  async getUpgrades(): Promise<ForgeUpgradeCatalog | null> {
    const cached = this.read()
    if (cached && Date.now() - cached.fetchedAt < this.ttlMs) return cached.upgrades
    try {
      const upgrades = await this.fetchUpgrades()
      writeFileSync(this.file, JSON.stringify({ fetchedAt: Date.now(), upgrades } satisfies CacheFile))
      return upgrades
    } catch {
      return cached?.upgrades ?? null
    }
  }
}

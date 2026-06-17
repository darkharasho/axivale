// src/main/entities/service.ts
import type { WikiFacts } from '../meta/wikiFacts'
import type { ForgeUpgradeCatalog } from '../forgeCatalog'
import type { EntityCard, EntityType } from './types'
import { wikiFactsToCard, catalogItemToCard } from './normalize'
import { buildDictionary, type EntityDictionary } from './dictionary'

interface Deps {
  wikiFacts: WikiFacts
  getCatalog: () => Promise<ForgeUpgradeCatalog | null>
  fetchEntities: (e: 'skills' | 'traits') => Promise<{ name: string; icon?: string }[]>
}

interface GW2EntityData {
  skills: { name: string; icon?: string }[]
  traits: { name: string; icon?: string }[]
}

export class EntityService {
  private readonly cache = new Map<string, EntityCard>()
  private dict: EntityDictionary | null = null

  // Store the in-flight promise so concurrent callers share one fetch (no double-fetch)
  private dataPromise: Promise<GW2EntityData> | null = null
  private iconIndexPromise: Promise<Map<string, string>> | null = null

  constructor(private readonly deps: Deps) {}

  /** Fetches skills + traits exactly once; concurrent callers share the same promise. */
  private ensureData(): Promise<GW2EntityData> {
    if (!this.dataPromise) {
      this.dataPromise = Promise.all([
        this.deps.fetchEntities('skills'),
        this.deps.fetchEntities('traits')
      ]).then(([skills, traits]) => ({ skills, traits }))
    }
    return this.dataPromise
  }

  /** Builds the skill/trait icon index once; resolves immediately after first build. */
  private ensureIconIndex(): Promise<Map<string, string>> {
    if (!this.iconIndexPromise) {
      this.iconIndexPromise = this.ensureData().then(({ skills, traits }) => {
        const index = new Map<string, string>()
        for (const e of skills) {
          if (e.icon) index.set(`skill:${e.name}`, e.icon)
        }
        for (const e of traits) {
          if (e.icon) index.set(`trait:${e.name}`, e.icon)
        }
        return index
      })
    }
    return this.iconIndexPromise
  }

  async resolve(input: { type: EntityType; name: string }): Promise<EntityCard | null> {
    const key = `${input.type}:${input.name}`
    const hit = this.cache.get(key)
    if (hit) return hit
    let card: EntityCard | null = null
    if (input.type === 'item') {
      const catalog = await this.deps.getCatalog()
      const entry =
        catalog?.runes.find((r) => r.name === input.name) ??
        catalog?.relics.find((r) => r.name === input.name)
      card = entry ? catalogItemToCard(entry) : null
    } else {
      const [facts, iconIndex] = await Promise.all([
        this.deps.wikiFacts.lookup(input.name),
        this.ensureIconIndex()
      ])
      card = wikiFactsToCard(input.type, facts)
      if (card) {
        // Attach icon BEFORE caching so card is never cached icon-less
        card.icon ??= iconIndex.get(`${input.type}:${input.name}`)
      }
    }
    if (card) this.cache.set(key, card) // never cache a miss
    return card
  }

  async dictionary(): Promise<EntityDictionary> {
    if (this.dict) return this.dict
    const [catalog, { skills, traits }] = await Promise.all([
      this.deps.getCatalog(),
      this.ensureData()
    ])
    const catalogRunes = catalog?.runes ?? []
    const catalogRelics = catalog?.relics ?? []
    const items = [
      ...catalogRunes.map((r) => ({ name: r.name, icon: r.icon })),
      ...catalogRelics.map((r) => ({ name: r.name, icon: r.icon }))
    ]
    this.dict = buildDictionary({ skills, traits, items })
    return this.dict
  }
}

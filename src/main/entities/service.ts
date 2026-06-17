// src/main/entities/service.ts
import type { WikiFacts } from '../meta/wikiFacts'
import type { ForgeUpgradeCatalog } from '../forgeCatalog'
import type { EntityCard, EntityType } from './types'
import { wikiFactsToCard, catalogItemToCard } from './normalize'
import { buildDictionary, type EntityDictionary } from './dictionary'

interface Deps {
  wikiFacts: WikiFacts
  getCatalog: () => Promise<ForgeUpgradeCatalog | null>
  fetchNames: (e: 'skills' | 'traits') => Promise<string[]>
}

export class EntityService {
  private readonly cache = new Map<string, EntityCard>()
  private dict: EntityDictionary | null = null

  constructor(private readonly deps: Deps) {}

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
      const facts = await this.deps.wikiFacts.lookup(input.name)
      card = wikiFactsToCard(input.type, facts)
    }
    if (card) this.cache.set(key, card) // never cache a miss
    return card
  }

  async dictionary(): Promise<EntityDictionary> {
    if (this.dict) return this.dict
    const [catalog, skills, traits] = await Promise.all([
      this.deps.getCatalog(),
      this.deps.fetchNames('skills'),
      this.deps.fetchNames('traits')
    ])
    const items = [
      ...(catalog?.runes ?? []).map((r) => r.name),
      ...(catalog?.relics ?? []).map((r) => r.name)
    ]
    this.dict = buildDictionary({ skills, traits, items })
    return this.dict
  }
}

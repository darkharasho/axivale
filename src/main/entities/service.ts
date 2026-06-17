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

export class EntityService {
  private readonly cache = new Map<string, EntityCard>()
  private dict: EntityDictionary | null = null
  private iconIndex: Map<string, string> | null = null

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
      if (card && this.iconIndex) {
        card.icon ??= this.iconIndex.get(`${input.type}:${input.name}`)
      }
    }
    if (card) this.cache.set(key, card) // never cache a miss
    return card
  }

  async dictionary(): Promise<EntityDictionary> {
    if (this.dict) return this.dict
    const [catalog, skills, traits] = await Promise.all([
      this.deps.getCatalog(),
      this.deps.fetchEntities('skills'),
      this.deps.fetchEntities('traits')
    ])
    const catalogRunes = catalog?.runes ?? []
    const catalogRelics = catalog?.relics ?? []
    const items = [
      ...catalogRunes.map((r) => ({ name: r.name, icon: r.icon })),
      ...catalogRelics.map((r) => ({ name: r.name, icon: r.icon }))
    ]

    // Build icon index keyed by `type:name` — built once alongside the dictionary
    const iconIndex = new Map<string, string>()
    for (const e of skills) {
      if (e.icon) iconIndex.set(`skill:${e.name}`, e.icon)
    }
    for (const e of traits) {
      if (e.icon) iconIndex.set(`trait:${e.name}`, e.icon)
    }
    for (const r of catalogRunes) {
      if (r.icon) iconIndex.set(`item:${r.name}`, r.icon)
    }
    for (const r of catalogRelics) {
      if (r.icon) iconIndex.set(`item:${r.name}`, r.icon)
    }
    this.iconIndex = iconIndex

    this.dict = buildDictionary({ skills, traits, items })
    return this.dict
  }
}

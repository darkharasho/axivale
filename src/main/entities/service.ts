// src/main/entities/service.ts
import type { Gw2Fact } from '@axiapps/gw2-data'
import { stripGw2Markup } from '@axiapps/gw2-data'
import type { ForgeUpgradeCatalog } from '../forgeCatalog'
import type { EntityCard, EntityType } from './types'
import { catalogItemToCard, wikiUrlFor } from './normalize'
import { buildDictionary, type EntityDictionary } from './dictionary'
import { formatFacts } from './gw2Facts'

interface Deps {
  getCatalog: () => Promise<ForgeUpgradeCatalog | null>
  fetchEntities: (e: 'skills' | 'traits') => Promise<{ id: number; name: string; icon?: string }[]>
  fetchEntityDetail: (
    endpoint: 'skills' | 'traits',
    id: number
  ) => Promise<{ description?: string; icon?: string; facts?: Gw2Fact[] } | null>
}

interface GW2EntityData {
  skills: { id: number; name: string; icon?: string }[]
  traits: { id: number; name: string; icon?: string }[]
}

type EntityIndexEntry = { id: number; icon?: string }

const SUBTITLE: Record<EntityType, string> = { skill: 'Skill', trait: 'Trait', item: 'Item' }

export class EntityService {
  private readonly cache = new Map<string, EntityCard>()
  private dict: EntityDictionary | null = null

  // Store the in-flight promise so concurrent callers share one fetch (no double-fetch)
  private dataPromise: Promise<GW2EntityData> | null = null
  private entityIndexPromise: Promise<Map<string, EntityIndexEntry>> | null = null

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

  /** Builds the skill/trait entity index (id + optional icon) once; keyed by `type:name`. */
  private ensureEntityIndex(): Promise<Map<string, EntityIndexEntry>> {
    if (!this.entityIndexPromise) {
      this.entityIndexPromise = this.ensureData().then(({ skills, traits }) => {
        const index = new Map<string, EntityIndexEntry>()
        for (const e of skills) {
          const entry: EntityIndexEntry = { id: e.id }
          if (e.icon) entry.icon = e.icon
          index.set(`skill:${e.name}`, entry)
        }
        for (const e of traits) {
          const entry: EntityIndexEntry = { id: e.id }
          if (e.icon) entry.icon = e.icon
          index.set(`trait:${e.name}`, entry)
        }
        return index
      })
    }
    return this.entityIndexPromise
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
      const idx = await this.ensureEntityIndex()
      const indexEntry = idx.get(`${input.type}:${input.name}`)
      if (!indexEntry) return null // unknown name — not cached

      const endpoint = input.type === 'skill' ? 'skills' : 'traits'
      const detail = await this.deps.fetchEntityDetail(endpoint, indexEntry.id)

      card = {
        type: input.type,
        name: input.name,
        subtitle: SUBTITLE[input.type],
        icon: detail?.icon ?? indexEntry.icon,
        description: detail?.description ? stripGw2Markup(detail.description) : undefined,
        facts: formatFacts(detail?.facts),
        wikiUrl: wikiUrlFor(input.name)
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
    // buildDictionary takes {name, icon?} — derive from the richer id+name+icon rows
    this.dict = buildDictionary({
      skills: skills.map((s) => ({ name: s.name, icon: s.icon })),
      traits: traits.map((t) => ({ name: t.name, icon: t.icon })),
      items
    })
    return this.dict
  }
}

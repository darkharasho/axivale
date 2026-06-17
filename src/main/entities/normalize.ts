// src/main/entities/normalize.ts
import type { WikiFactsResult } from '../meta/wikiFacts'
import type { EntityCard, EntityType } from './types'

export function wikiUrlFor(name: string): string {
  // Wiki titles use underscores for spaces; encode the rest but keep underscores readable.
  const title = name.trim().replace(/ /g, '_')
  return `https://wiki.guildwars2.com/wiki/${encodeURI(title)}`
}

const SUBTITLE: Record<EntityType, string> = { skill: 'Skill', trait: 'Trait', item: 'Item' }

export function wikiFactsToCard(type: 'skill' | 'trait', r: WikiFactsResult): EntityCard | null {
  if (!r.found) return null
  const facts: EntityCard['facts'] = []
  if (r.recharge?.pve != null) facts.push({ label: 'Recharge', value: `${r.recharge.pve}s` })
  if (r.activation?.pve) facts.push({ label: 'Activation', value: `${r.activation.pve}s` })
  return {
    type,
    name: r.name,
    subtitle: SUBTITLE[type],
    facts,
    wikiUrl: wikiUrlFor(r.name)
  }
}

export function catalogItemToCard(entry: {
  id?: number
  name: string
  icon?: string
  bonuses?: string[]
}): EntityCard {
  return {
    type: 'item',
    name: entry.name,
    icon: entry.icon,
    subtitle: SUBTITLE.item,
    description: undefined,
    facts: (entry.bonuses ?? []).map((value) => ({ label: '', value })),
    wikiUrl: wikiUrlFor(entry.name)
  }
}

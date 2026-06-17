// src/main/entities/dictionary.ts
import type { EntityType } from './types'

export interface EntityDictionaryEntry {
  name: string
  type: EntityType
  icon?: string
}

export interface EntityDictionary {
  entries: EntityDictionaryEntry[]
}

export function buildDictionary(input: {
  skills: { name: string; icon?: string }[]
  traits: { name: string; icon?: string }[]
  items: { name: string; icon?: string }[]
}): EntityDictionary {
  const byName = new Map<string, { type: EntityType; icon?: string }>()
  // Precedence: item > skill > trait. Insert lowest precedence first so higher overwrites.
  const ordered: Array<[EntityType, { name: string; icon?: string }[]]> = [
    ['trait', input.traits],
    ['skill', input.skills],
    ['item', input.items]
  ]
  for (const [type, entities] of ordered) {
    for (const raw of entities) {
      const name = raw.name.trim()
      if (name) byName.set(name, { type, icon: raw.icon })
    }
  }
  const entries = [...byName.entries()].map(([name, { type, icon }]) => {
    const entry: EntityDictionaryEntry = { name, type }
    if (icon !== undefined) entry.icon = icon
    return entry
  })
  entries.sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name))
  return { entries }
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>

export async function fetchGw2Names(
  endpoint: 'skills' | 'traits',
  fetchImpl: FetchLike
): Promise<string[]> {
  const res = await fetchImpl(`https://api.guildwars2.com/v2/${endpoint}?ids=all`)
  if (!res.ok) return []
  const rows = (await res.json()) as Array<{ name?: unknown }>
  return rows.map((r) => r.name).filter((n): n is string => typeof n === 'string' && n.length > 0)
}

export async function fetchGw2Entities(
  endpoint: 'skills' | 'traits',
  fetchImpl: FetchLike
): Promise<{ name: string; icon?: string }[]> {
  const res = await fetchImpl(`https://api.guildwars2.com/v2/${endpoint}?ids=all`)
  if (!res.ok) return []
  const rows = (await res.json()) as Array<{ name?: unknown; icon?: unknown }>
  const result: { name: string; icon?: string }[] = []
  for (const r of rows) {
    if (typeof r.name !== 'string' || r.name.length === 0) continue
    const entry: { name: string; icon?: string } = { name: r.name }
    if (typeof r.icon === 'string') entry.icon = r.icon
    result.push(entry)
  }
  return result
}

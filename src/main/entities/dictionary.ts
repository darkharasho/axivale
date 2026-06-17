// src/main/entities/dictionary.ts
import type { EntityType } from './types'

export interface EntityDictionaryEntry {
  name: string
  type: EntityType
}

export interface EntityDictionary {
  entries: EntityDictionaryEntry[]
}

export function buildDictionary(input: {
  skills: string[]
  traits: string[]
  items: string[]
}): EntityDictionary {
  const byName = new Map<string, EntityType>()
  // Precedence: item > skill > trait. Insert lowest precedence first so higher overwrites.
  const ordered: Array<[EntityType, string[]]> = [
    ['trait', input.traits],
    ['skill', input.skills],
    ['item', input.items]
  ]
  for (const [type, names] of ordered) {
    for (const raw of names) {
      const name = raw.trim()
      if (name) byName.set(name, type)
    }
  }
  const entries = [...byName.entries()].map(([name, type]) => ({ name, type }))
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

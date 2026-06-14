// src/main/meta/specMap.ts
//
// Authoritative elite-spec -> profession map from the official GW2 API
// (/v2/specializations is public, no key, always current — includes
// latest-expansion specs the model doesn't know). Used to ground the distiller's
// profession<->spec pairing instead of trusting ambiguous source text or stale
// model priors. Cached per process; returns {} on any failure (distiller then
// just omits the map).
const API = 'https://api.guildwars2.com/v2/specializations?ids=all'

interface Spec {
  id: number
  name: string
  profession: string
  elite: boolean
}

let cache: Record<string, string> | null = null

export async function fetchEliteSpecMap(): Promise<Record<string, string>> {
  if (cache) return cache
  try {
    const res = await fetch(API, { headers: { 'User-Agent': 'AxiVale' } })
    if (!res.ok) return {}
    const specs = (await res.json()) as Spec[]
    const map: Record<string, string> = {}
    for (const s of specs) {
      if (s.elite && s.name && s.profession) map[s.name] = s.profession
    }
    cache = map
    return map
  } catch {
    return {}
  }
}

/** test seam — reset the module cache */
export function __resetSpecMapCache(): void {
  cache = null
}

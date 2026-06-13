import { useEffect, useState } from 'react'

interface RuneDef {
  id: number
  name: string
  icon?: string
  bonuses?: string[]
}
interface RelicDef {
  name: string
  icon?: string
}

export interface UpgradeCatalog {
  runeById: Map<number, RuneDef>
  relicByName: Map<string, RelicDef>
}

interface OfficerForgeApi {
  forgeCatalogUpgrades: () => Promise<{ runes: RuneDef[]; relics: RelicDef[] } | null>
}

let cached: UpgradeCatalog | null = null
let inflight: Promise<UpgradeCatalog | null> | null = null

async function load(): Promise<UpgradeCatalog | null> {
  if (cached) return cached
  inflight ??= (window as unknown as { officer: OfficerForgeApi }).officer
    .forgeCatalogUpgrades()
    .then((raw) => {
      if (!raw) return null
      cached = {
        runeById: new Map(raw.runes.map((r) => [r.id, r])),
        relicByName: new Map(raw.relics.map((r) => [r.name, r]))
      }
      return cached
    })
    .catch(() => null)
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Upgrade catalog for rune/relic names+icons on cards; null while loading
 *  or when AxiForge has never been reachable (cards degrade gracefully). */
export function useForgeCatalog(): UpgradeCatalog | null {
  const [catalog, setCatalog] = useState<UpgradeCatalog | null>(cached)
  useEffect(() => {
    if (catalog) return
    let alive = true
    void load().then((c) => {
      if (alive && c) setCatalog(c)
    })
    return () => {
      alive = false
    }
  }, [catalog])
  return catalog
}

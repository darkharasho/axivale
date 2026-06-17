import { useEffect, useState } from 'react'

type EntityType = 'skill' | 'trait' | 'item'
export interface EntityDictionary { entries: { name: string; type: EntityType }[] }

const EMPTY: EntityDictionary = { entries: [] }

export function useEntityDictionary(): EntityDictionary {
  const [dict, setDict] = useState<EntityDictionary>(EMPTY)
  useEffect(() => {
    let alive = true
    void window.officer?.entityDictionary?.()
      ?.then((d) => { if (alive) setDict(d ?? EMPTY) })
      ?.catch(() => { /* degrade gracefully: keep EMPTY */ })
    return () => { alive = false }
  }, [])
  return dict
}

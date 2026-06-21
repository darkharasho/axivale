// src/main/buildNoteLinks.ts

export interface NoteLinkResolution {
  notes: string
  resolved: number
  unresolved: Array<{ name: string; type: 'skill' | 'trait' | 'item'; reason: 'not-found' | 'catalog-unavailable' }>
}

export interface NoteCatalog {
  profession?: unknown
  upgrades?: unknown
}

// AxiVale marker the agent writes: [[skill|trait|item:Name]]
const MARKER = /\[\[(skill|trait|item):([^\]]+)\]\]/g

/**
 * Walk any value, collecting every { id: number>0, name: non-empty string } node
 * into a case-insensitive name -> id map. First-seen wins, so callers walk the
 * highest-priority source (the build) before lower-priority ones (the catalog).
 * This is shape-agnostic: it does not depend on the exact build/catalog layout,
 * only on the universal { id, name } pairing GW2 entities use.
 */
function collectIdNames(node: unknown, out: Map<string, number>): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) collectIdNames(child, out)
    return
  }
  const obj = node as Record<string, unknown>
  const id = obj.id
  const name = obj.name
  if (typeof id === 'number' && id > 0 && typeof name === 'string' && name.trim()) {
    const key = name.trim().toLowerCase()
    if (!out.has(key)) out.set(key, id)
  }
  for (const value of Object.values(obj)) collectIdNames(value, out)
}

export function transpileNotes(notes: string, build: unknown, catalog: NoteCatalog | null): NoteLinkResolution {
  const index = new Map<string, number>()
  collectIdNames(build, index) // build first → its ids take precedence
  if (catalog) {
    collectIdNames(catalog.profession, index)
    collectIdNames(catalog.upgrades, index)
  }

  let resolved = 0
  const unresolved: NoteLinkResolution['unresolved'] = []

  const out = notes.replace(MARKER, (_full, type: string, rawName: string) => {
    const name = rawName.trim()
    const id = index.get(name.toLowerCase())
    if (id) {
      resolved += 1
      return `@[${type}:${id}:${name}]`
    }
    unresolved.push({
      name,
      type: type as 'skill' | 'trait' | 'item',
      reason: catalog ? 'not-found' : 'catalog-unavailable'
    })
    return name // strip brackets → plain text; never leak [[...]] into AxiForge
  })

  return { notes: out, resolved, unresolved }
}

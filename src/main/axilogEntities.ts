// The ONE place axilog entity ids are handled. axilog's roster is `entities[]`
// (there is no players[]), and every per-entity statistic lives in
// `blocks.<name>.by_entity` keyed by `entities[].id`. Those are JSON object
// keys, so they arrive as STRINGS: `by_entity[entity.id]` happens to work by
// coercion, but `Object.keys()` gives strings. Normalizing on strings here, once,
// is what keeps that footgun out of every section.
//
// Correction vs. the original task brief: the brief's `AxilogEntity` assumed a
// single generic `name?: string` field shared by every role. The real SDK
// (`@axiapps/axilog`'s `types.d.ts`, `EntityOut`) splits this: player roles
// (`squad` / `friendly_player`) carry `account` + `character` and NO `name`;
// non-player roles (`enemy_player` / `npc`) carry `name` and NO
// `account`/`character`. A generator built against the brief's shape would
// have silently produced `Unknown #n` for every player. `AxilogEntity` below
// is corrected to the real shape, and the display name a caller sees is
// `character ?? name ?? "Unknown #<id>"`.

export type CoverageState = 'present' | 'empty' | 'not_computed' | 'unsupported'
export type EntityRole = 'squad' | 'friendly_player' | 'enemy_player' | 'npc'

export interface AxilogEntity {
  id: number
  /** Non-player roles only (`enemy_player` / `npc`). */
  name?: string
  /** Player roles only (`squad` / `friendly_player`). */
  character?: string
  /** Player roles only (`squad` / `friendly_player`). */
  account?: string
  profession?: string
  role: EntityRole
  subgroup?: number
}

export interface AxilogEncounter {
  kind?: string
  map?: string
  duration_ms?: number
  recorded_by?: string
}

export interface AxilogReport {
  axilog: { schema: string; version: string; generated_from: string }
  encounter: AxilogEncounter
  entities: AxilogEntity[]
  catalogs: Record<string, Record<string, { name?: string }>>
  blocks: Record<string, { by_entity?: Record<string, unknown> } & Record<string, unknown>>
  coverage: Record<string, CoverageState>
  warnings?: string[]
}

export interface EntityRef {
  /** Always the STRING form — the same shape `by_entity` keys arrive in. */
  id: string
  name: string
  account: string
  profession: string
  role: EntityRole
  subgroup: number | null
}

export class EntityIndex {
  private readonly byId: Map<string, EntityRef>
  private readonly byLowerName: Map<string, EntityRef[]>

  constructor(refs: EntityRef[]) {
    this.byId = new Map(refs.map((r) => [r.id, r]))
    this.byLowerName = new Map()
    for (const r of refs) {
      for (const key of [r.name.toLowerCase(), r.account.toLowerCase()]) {
        if (!key) continue
        const bucket = this.byLowerName.get(key)
        if (bucket) bucket.push(r)
        else this.byLowerName.set(key, [r])
      }
    }
  }

  /** null, never a placeholder — an unresolved id is a real condition callers must show. */
  get(id: string | number): EntityRef | null {
    return this.byId.get(String(id)) ?? null
  }

  all(): EntityRef[] {
    return [...this.byId.values()]
  }

  byRole(role: EntityRole): EntityRef[] {
    return this.all().filter((r) => r.role === role)
  }

  roleCounts(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const r of this.all()) counts[r.role] = (counts[r.role] ?? 0) + 1
    return counts
  }

  /**
   * Exact (case-insensitive) match against a name or account handle.
   *
   * Tie-breaking rule: NONE — an ambiguous query returns null rather than
   * silently picking a winner. Two different accounts can legitimately share
   * a character name (`Anon133` on one account, someone else's alt also
   * named `Anon133`), and a chat command that misidentifies a player is
   * worse than one that says "not sure, be more specific." Substring/partial
   * matching is deliberately NOT implemented here for the same reason: a
   * partial match against a 122-entity roster is far more likely to resolve
   * ambiguously (or to the wrong person) than to help, so this method only
   * ever matches a full name or account string, case-insensitively.
   */
  resolveName(loose: string): EntityRef | null {
    const hits = this.byLowerName.get(loose.trim().toLowerCase()) ?? []
    return hits.length === 1 ? hits[0] : null
  }
}

export function buildEntityIndex(report: AxilogReport): EntityIndex {
  return new EntityIndex(
    (report.entities ?? []).map((e) => ({
      id: String(e.id),
      name: e.character?.trim() || e.name?.trim() || `Unknown #${e.id}`,
      account: e.account?.trim() ?? '',
      profession: e.profession?.trim() ?? '',
      role: e.role,
      subgroup: typeof e.subgroup === 'number' ? e.subgroup : null
    }))
  )
}

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
  /**
   * The elite spec display name (`"Firebrand"`), empty when the agent has no
   * elite spec or axilog cannot name its id. Never a numeric spec id.
   */
  elite_spec?: string
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
  /**
   * What a player would call the class: the elite spec when the log names one,
   * falling back to the base profession. axilog reports these as two separate
   * fields and only the base is guaranteed present, so folding them here is
   * what keeps every consumer from having to remember the fallback -- and from
   * silently reporting "Guardian" for a roster full of Firebrands.
   */
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
   * Spec histogram for one role, highest count first: `{ Luminary: 4, ... }`.
   *
   * The class question a player actually asks is "what were they running",
   * and the only place an enemy roster was reachable before this was a raw jq
   * filter over `entities[]` -- where `profession` is the BASE class and the
   * spec sits in a sibling field. A model that grouped by `.profession` got
   * "Guardian x8" and reasonably concluded the log had no specs. Answering it
   * here, pre-folded, is what keeps that inference from being available.
   *
   * Entities with no class at all (NPCs) are omitted rather than bucketed
   * under "".
   */
  professionCounts(role: EntityRole): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const r of this.byRole(role)) {
      if (!r.profession) continue
      counts[r.profession] = (counts[r.profession] ?? 0) + 1
    }
    return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]))
  }

  /**
   * Two-stage resolution, exact before partial, honest about ambiguity at
   * both stages:
   *
   * 1. Trim the query. Exact, case-insensitive match against display name or
   *    account handle. Exactly one match -> return it. More than one -> null
   *    (an exact match is never overridden by stage 2, so a query that
   *    exactly names one player is never hijacked by being a substring of
   *    another).
   * 2. Only when stage 1 finds nothing: case-insensitive SUBSTRING match
   *    against display name or account handle. Exactly one candidate ->
   *    return it. Zero or more-than-one -> null.
   *
   * This exists because the primary caller is an LLM agent turning a chat
   * message ("how were Anon133's strips last fight?") into a tool call — it
   * cannot be relied on to echo a roster string verbatim, and a unique
   * substring candidate is a real answer, not a guess. Ambiguity is still
   * never silently resolved: two different accounts can legitimately share a
   * character name, and a fragment shared by several roster entries (e.g. a
   * short "Anon" prefix matching dozens of players) must still return null
   * rather than pick one.
   */
  resolveName(loose: string): EntityRef | null {
    const query = loose.trim().toLowerCase()
    if (!query) return null

    const exact = this.byLowerName.get(query) ?? []
    if (exact.length === 1) return exact[0]
    if (exact.length > 1) return null

    const partial = this.all().filter(
      (r) => r.name.toLowerCase().includes(query) || r.account.toLowerCase().includes(query)
    )
    return partial.length === 1 ? partial[0] : null
  }
}

export function buildEntityIndex(report: AxilogReport): EntityIndex {
  return new EntityIndex(
    (report.entities ?? []).map((e) => ({
      id: String(e.id),
      name: e.character?.trim() || e.name?.trim() || `Unknown #${e.id}`,
      account: e.account?.trim() ?? '',
      profession: e.elite_spec?.trim() || e.profession?.trim() || '',
      role: e.role,
      subgroup: typeof e.subgroup === 'number' ? e.subgroup : null
    }))
  )
}

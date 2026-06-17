# Memory under Sources — Design

**Date:** 2026-06-16
**Status:** Approved (brainstorm), pending implementation plan

## Summary

Add a durable **memory** capability to AxiVale, surfaced as a new entry under **Sources**.
Where today's Sources are external reference corpora crawled from the web (Snowcrows,
MetaBattle, GW2 Wiki — indexed into LanceDB and recalled via `meta_search`), memory is
AxiVale's **own self-authored knowledge** accumulated across conversations: durable facts
and operational know-how the officer learns and reuses.

The design adapts Otto's memory architecture (`../otto`) — facts + artifacts, semantic
dedup, hybrid recall, decay/archival, pinned working set — onto AxiVale's existing
LanceDB + JSON-store conventions, and extends it with an **entity anchor** so memory can
attach to a specific person in the roster (build preferences, comp style, play tendencies).

### Scope decisions

- **Memory is about** durable officer-domain knowledge: per-person preferences/tendencies
  (WvW vs PvE, small- vs large-scale, mains, build/comp style), operational know-how
  (playbooks / anti-patterns / heuristics), and standing officer preferences.
- **Entity model:** hybrid — flat facts are the universal substrate; a fact *optionally*
  carries an `entity` key when it's about someone, enabling lightweight profile rollups
  without a relational model.
- **Write paths (v1):** agent-driven `remember` tool + manual user curation in the UI.
  Auto-reflection (Otto-style background extraction) is explicitly deferred to a later
  phase; the data model leaves hooks for it.
- **Storage (v1):** reuse the existing LanceDB + `Xenova/all-MiniLM-L6-v2` embedder + JSON
  atomic-write store patterns. No new storage engine, no new dependencies.

## Non-goals (v1)

- Automatic reflection / transcript extraction (deferred; hooks left in place).
- Cross-session "re-learned across N sessions" value counting (Otto's `distinctSessions`).
- Agent-initiated deletion (deletion is user-only, via UI).
- Re-pointing `acct:`-keyed memory when a GW2 account later links a Discord identity
  (noted as future roster-merge work).

---

## Section 1 — Data model

Two record kinds.

### MemoryFact — universal substrate (one-liners)

```ts
interface MemoryFact {
  id: string                    // uuid
  body: string                  // the fact, <=280 chars ("prefers WvW small-scale, mains Firebrand")
  bodyNorm: string              // normalized for exact-dedup
  entity: string | null         // optional roster identity key (see below); null = global/guild fact
  tags: string[]                // freeform labels ("wvw","build","schedule"), <=8
  pinned: boolean               // user-pinned OR top-score auto-pin -> injected into system prompt
  useCount: number              // times recalled (recency signal)
  score: number                 // computed; drives auto-pin + ordering
  source: 'agent' | 'user'      // remember-tool vs manual entry
  createdAt: string             // ISO
  lastUsedAt: string | null     // ISO
  archived: boolean
}
```

### MemoryArtifact — structured operational know-how

```ts
interface MemoryArtifact {
  id: string
  kind: 'playbook' | 'anti_pattern' | 'heuristic'
  title: string                 // <=120
  body: string                  // markdown, <=4000 ("## When to use / ## Steps / ## Notes")
  tags: string[]
  entity: string | null         // usually null; artifacts are mostly cross-cutting
  useCount: number
  source: 'agent' | 'user'
  createdAt: string
  updatedAt: string
  archived: boolean
}
```

Artifact-kind semantics (from Otto): **playbook** = named reusable procedure;
**anti_pattern** = something that failed + why; **heuristic** = a context-specific rule.

### The `entity` key

`entity` reuses the roster's **existing identity-key convention** (from `rosterStore` /
`identityResolve`), so it covers both Discord-linked people and GW2-account-only people:

```
entity:
  "<discord_member_id>"   // Discord-linked roster member
  "acct:<accountName>"    // GW2-account-only person (roster's synthetic key)
  null                    // global / guild-wide fact
```

Resolution from a typed name ("Zara", "@zara") -> identity key reuses the existing
`resolve_identity` ranker. The roster already mints `acct:` keys and `resolve_identity`
already returns `member_id`, so memory adds no new resolution logic.

### Deliberate differences from Otto

- **`entity` field** is new — enables per-person rollups ("everything we know about Zara")
  without a relational model.
- **`source: 'agent' | 'user'`** replaces Otto's `distinctSessions` / re-learning
  machinery. With tool + manual writes (no auto-reflection), the "learned across N
  sessions" value signal doesn't apply; scoring leans on recency + curation instead
  (Section 5). This keeps v1 simple and reflection-ready.

### Relationship to `RosterAnnotation.notes`

`RosterAnnotation.notes` is the user's hand-written canonical context and stays separate
from memory (which is accumulated and decayable). The roster UI surfaces an entity's
memory facts *next to* notes (read-only rollup) so they complement rather than overlap.

---

## Section 2 — Storage & indexing

Mirrors the existing `metaStore` + `meta/rag` split; slots into `src/main` with no new
patterns or dependencies.

### Canonical records — `userData/memory.json`

A new `MemoryStore` class, shaped like `metaStore` / `rosterStore`: reads on boot, corrupt
file -> safe empty state, 300ms-debounced atomic tmp+rename writes. Holds the full
`MemoryFact[]` and `MemoryArtifact[]`. **Records are the source of truth; LanceDB is a
derived index.**

### Vector/keyword index — `userData/memory-lance/`

A thin `MemoryIndex` built on the existing `meta/rag` primitives:

- Same `TransformersEmbedder` (`Xenova/all-MiniLM-L6-v2`, 384-dim), lazy-loaded.
- Same hybrid search (FTS + semantic + `RRFReranker`) as `MetaIndex.search`.
- **One row per fact / per artifact** (artifacts embed `title + "\n" + body`). No chunking
  — memory entries are short, so each record is its own atomic row.
- Row carries `{ id, kind, entity, text, contentHash }`. `contentHash` (SHA1 of body, like
  `chunk.ts`) lets `reindexAll()` skip re-embedding unchanged records (reuses the
  `indexedHash` idea).

### Sync model — records -> index, one direction

Every write/edit/delete goes through `MemoryStore` first, then
`MemoryIndex.upsert(record)` / `.remove(id)`. A `reindexAll()` supports cold rebuilds
(boot reconcile + dev "rebuild index" button), matching how `MetaIndex` rebuilds from
cached pages. JSON is authoritative; on drift, rebuild from it.

### Entity filtering

LanceDB queries take a `where entity = ?` (or `entity = ? OR entity IS NULL`) predicate, so
the roster rollup is an indexed lookup and global recall omits the filter. Same code path
as `MetaIndex`'s per-mode filter, different column.

---

## Section 3 — Write path (`remember` tool + manual entry + dedup)

### A. Agent `remember` tool

New tool in `src/main/tools/`, registered via `buildOfficerTools`, defined with the SDK
`tool()` + Zod pattern (like `meta_search` / `resolve_identity`):

```ts
remember({
  kind: 'fact' | 'playbook' | 'anti_pattern' | 'heuristic',
  body: string,                 // fact text, or artifact markdown
  title?: string,               // required when kind != 'fact'
  entity?: string,              // a loose name to resolve, OR a raw identity key
  tags?: string[],
})
```

- A loose `entity` ("Zara", "@zara") runs through `resolve_identity`. **One match -> anchor
  it.** Ambiguous / no match -> store with `entity: null` and fold the name into
  `tags`/body (no blocking prompts — keep the turn flowing). The resolved key + matched
  name appear in the tool result for transcript visibility.
- `source: 'agent'`. Returns the created/merged record id and whether it was a dedup-merge.
- **Gating:** non-destructive, so `remember` is **not** in `DESTRUCTIVE_TOOLS` and runs
  without a confirm prompt. (Deletion is UI-only in v1.)

### B. Manual entry

The Memory UI (Section 6) creates/edits records directly via IPC (`memory:create`,
`memory:update`), `source: 'user'`. Same store + index path.

### C. Dedup — at write time, both paths (ported from Otto)

1. **Exact:** `bodyNorm` match (lowercase, collapse whitespace, strip bullets/trailing dates).
2. **Semantic:** embed body, cosine **>= 0.9** against same-`kind` rows -> duplicate.

- **Fact dedup-hit:** no new row — bump `lastUsedAt`, `useCount`, un-archive, merge tags.
  If the incoming fact resolved an `entity` the existing one lacked, fill it in.
  (Lightweight stand-in for Otto's "re-learned" signal.)
- **Artifact hit (cosine >= 0.85, looser):** update the existing record's body/tags in
  place, preserve id, bump `updatedAt`.
- **Fact dedup is entity-scoped:** the same sentence about Zara vs. Bob is *not* a
  duplicate. Two `entity: null` facts dedup globally.

### Caps

Soft cap ~500 artifacts per kind and a configurable max facts. Over cap, archival
(Section 5) trims the lowest-score unpinned tail rather than hard-rejecting writes.

---

## Section 4 — Recall path (`recall` tool + pinned injection)

### A. `recall` tool

Read counterpart to `remember`, via `buildOfficerTools`:

```ts
recall({
  query: string,
  entity?: string,              // loose name -> resolve_identity, or raw key
  kinds?: ('fact'|'playbook'|'anti_pattern'|'heuristic')[],
  limit?: number,               // default 5, hard cap 20
})
```

- Runs `MemoryIndex` hybrid search (FTS + semantic + RRF), same engine as `meta_search`.
- `entity` set -> `where entity = <key> OR entity IS NULL` (that person's facts plus
  globals); omitted -> searches everything.
- Returns each hit with **provenance**: `body`, `learned_at`, `last_used_at`,
  `times_used`, `source`, and (for facts) the resolved entity's display name — so the model
  can weigh fresh self-authored memory vs. stale lines.
- **Side effect:** bump `useCount` + `lastUsedAt` on returned records (recency only —
  appearing in results never directly boosts pin-worthiness; avoids self-reinforcement).

A short **system-prompt instruction** tells AxiVale to `recall` at the start of any task
resembling past work or concerning a specific person, and to `remember` durable
preferences/outcomes (modeled on Otto's tool descriptions, scoped to the officer domain).

### B. Pinned facts injected into the system prompt

Passive channel, reusing the `buildMetaReference()` / `buildPlaybookReference()` append
pattern in `agent.ts`:

- A new `buildMemoryReference()` renders the **top-N pinned facts** (user-pinned +
  top-score auto-pinned, budget ~40, token-capped) as a compact markdown block appended
  every turn.
- **Token budget guard:** respects the local-vs-cloud model split (full for cloud,
  trimmed/omitted for tight local budgets), like the meta reference.
- Pinned facts are global-leaning; per-entity facts surface mainly via `recall` / the
  roster rollup, so the always-on block doesn't bloat with everyone's preferences.

---

## Section 5 — Lifecycle & scoring

A single `rerank()` pass owns scoring, auto-pin, and archival — run after each write and on
boot (cheap, in-memory over the JSON records).

### Score formula

```
score = base(source, pinned) * exp(-ageSinceLastUse / HALF_LIFE)
        * (1 + 0.25 * log1p(useCount))
```

- `HALF_LIFE = 21 days` on `lastUsedAt ?? createdAt`.
- `base`: `user`-sourced > `agent`-sourced (curation = stronger intent); user-`pinned`
  gets a large constant so it never ages out.
- `useCount` contributes a **log-damped** nudge so heavily-recalled facts float up without
  one dominating (Otto's anti-domination trick).

### Auto-pin

`rerank()` keeps the top **~40** non-archived facts by score as `pinned`, **plus** all
user-pinned facts (sticky — auto-pin cannot unpin a user pin). This set is exactly what
`buildMemoryReference()` injects. Auto-pin weights `entity: null` (global) facts above
per-person ones.

### Archival (soft)

- A non-user-pinned fact untouched > **180 days** -> `archived: true`: hidden from
  `recall`, dropped from the index's active filter, excluded from the pin budget.
  Recoverable — a later `remember` dedup-hit un-archives it.
- **Cap-driven:** over the configured max facts (or ~500/kind artifacts), archive the
  lowest-score unpinned tail until under budget.

### Deletion

User-only: UI delete -> hard-remove from JSON + `MemoryIndex.remove(id)`. The agent cannot
delete in v1.

### Reflection-ready hooks

No auto-extraction or cross-session counting in v1. The `source` field and the `rerank()`
seam are where Otto-style reflection plugs in later — adding it introduces a third `source`
and optionally revives `distinctSessions` as a booster, without disturbing this model.

---

## Section 6 — UI

Three touchpoints, all reusing existing component patterns.

### A. "Memory" entry under Sources

Add a `Memory` item to `MetaNav.tsx`'s sections — a peer to Meta / Wiki / Guides —
selecting it opens a Memory panel (sibling to `Meta.tsx`), framed as "what AxiVale has
learned" alongside the crawled sources.

### B. Memory panel (modeled on Otto's `MemorySection` + AxiVale panel styling)

- **Search box** -> live hybrid search over all memory.
- **Filter chips:** kind (fact / playbook / anti_pattern / heuristic), `source`
  (agent/user), show-archived toggle.
- **Facts list:** body, badges (`pinned`, `archived`, `user`/`agent`), entity chip
  (resolved display name, click -> roster), provenance line (`learned · last used · used
  Nx`). Row actions: pin/unpin, edit, archive, delete.
- **Artifacts list:** title + kind badge + tags, `updated · used Nx`, inline edit modal
  (title/body/tags).
- **"+ Add":** manual create (`source: 'user'`) for facts and artifacts.
- **Dev-only footer:** "Rebuild index" button (`reindexAll()`) + stats line (counts by
  kind, pinned count, last index time), paralleling `MetaIndexInspector`.

### C. Roster rollup (entity payoff)

In the roster/member detail UI, add a read-only **"What AxiVale knows"** block beside
`RosterAnnotation.notes`, listing that identity's memory facts (query by `entity` key).
Separates accumulated memory from hand-written notes; each row links into the Memory panel
for editing.

### IPC surface

Preload bridge + `index.ts` handlers, mirroring `meta:*` / `roster:*`:

```
memory:list · memory:search · memory:create · memory:update · memory:delete
memory:pin · memory:reindex · memory:statsForEntity
```

Renderer holds memory in React state, re-fetches on a `memory:progress` event (same pattern
as `meta:progress`).

---

## Reuse map (existing code this builds on)

| New piece | Modeled on |
|---|---|
| `MemoryStore` (`memory.json`) | `metaStore.ts`, `rosterStore.ts` |
| `MemoryIndex` (`memory-lance/`) | `meta/rag/index.ts`, `embedder.ts`, `chunk.ts` |
| `remember` / `recall` tools | `tools/metaSearch.ts`, `tools/axitools.ts` (`resolve_identity`) |
| entity resolution | `identityResolve.ts` (`resolve_identity`) |
| `buildMemoryReference()` | `agent.ts` `buildMetaReference()` / `buildPlaybookReference()` |
| Memory panel + nav | `meta/Meta.tsx`, `meta/MetaNav.tsx`, `MetaIndexInspector.tsx` |
| roster rollup | roster detail UI + `RosterAnnotation` |
| IPC + progress events | `meta:*` handlers, `meta:progress` |

## Open questions / future phases

- **Auto-reflection (phase 2):** background transcript extraction with a cheap model;
  reintroduces `distinctSessions` as a value booster.
- **`acct:` -> Discord re-pointing:** when a GW2-only person links Discord, migrate their
  memory entity keys (roster-merge concern).
- **Artifact recall in system prompt:** v1 injects only pinned *facts*; whether to surface
  top heuristics/anti-patterns passively is deferred until we see real usage.

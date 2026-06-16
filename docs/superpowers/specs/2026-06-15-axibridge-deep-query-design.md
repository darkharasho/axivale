# AxiBridge Deep Query — Design

**Date:** 2026-06-15
**Status:** Approved (brainstorming)

## Problem

AxiBridge exposes 7 fixed-shape agent tools (`axibridge_attendance`,
`axibridge_player_stats`, `axibridge_run_summary`, etc.). When a user question
doesn't fit one of those shapes, the agent has no way to slice the underlying
cached JSON — so it dumps a one-line, unreadable "blob" (the reported
attendance case). There is a LOT of data in AxiBridge (run index, cross-run
rollup, and per-run reports/summaries across multiple linked repos), so any
fix must aggressively control result size.

## Goal

Give the agent (Claude) a flexible way to deeply query AxiBridge content, while
keeping the mechanism **completely abstracted from the user** — the user only
ever sees clean, readable, appropriately-sized results. No query syntax, no
"sources," no jargon surfaces to the user. This is a non-technical app.

## Non-goals

- No user-facing query/explorer UI (agent is the only consumer).
- No write access to the cache (read-only).
- Not replacing the 7 existing tools — this is the escape hatch beside them.

## Design

### New agent tool: `axibridge_query`

- The agent writes a `jq` expression against a **single virtual AxiBridge
  document**:
  ```
  { repos, runs (index across repos), rollup{ playerRows, commanderRows }, summaries{ <id>: ... } }
  ```
- The user never sees the jq expression or the document shape — these are
  internal to the tool/agent.
- The 7 existing tools remain as fast paths for common questions;
  `axibridge_query` handles everything they can't shape.

### Scoped materialization (cheap over a large dataset)

jq evaluates over a concrete in-memory value, so a transparent lazy proxy isn't
possible — instead we materialize only what a query is scoped to:

- The **always-cheap base** (`repos`, `runs` index, merged `rollup`) is built
  cache-first on every query — one JSON each, already cached.
- **Per-run detail (`summaries`) is materialized only when the agent scopes it**
  — by passing `from`/`to` (the runs in that window) or an explicit `runs[]`
  list. With no scope, `summaries` is empty `{}` and no per-run reports are
  fetched. This preserves "never load every run" through explicit scope rather
  than a magic proxy.
- A guard caps the number of scoped runs per query (`MAX_SCOPED_RUNS`) so a wide
  range can't trigger an unbounded fetch; over the cap, the tool asks the agent
  to narrow.
- The document is built entirely from the service's existing public methods
  (`reposStatus`, `runsList`, `attendance`, `commanderStats`, `runSummary`), so
  no new cache internals are introduced.

### jq engine

- Bundle a **pure-JS jq implementation** (e.g. `jq-web`) so there is no
  system-binary dependency — the Electron app stays self-contained.
- Run read-only; jq cannot mutate the cache.

### Size discipline (first-class — "there's a LOT of data")

This is the core of fixing the blob. **Critical distinction:** caps apply to
the *returned result*, never to what jq can *process*. jq always runs over the
full virtual document (all touched runs, the whole rollup) — aggregations,
counts, sums, and joins see 100% of the data. The caps only bound the final
projected value so it doesn't become a runaway blob in chat. Nothing is ever
silently dropped from computation.

The tool enforces, in order:

1. **Result count cap — agent-controllable, not a wall.** Array results default
   to a soft limit of ~50 rows, but the tool exposes a `limit` param the agent
   can raise (or set to "all") when it genuinely needs the full list. When a
   result is truncated, return `showing N of M` so the agent knows there's more
   and can raise the limit or paginate. The default protects the *user* from a
   runaway blob; it never blocks the *agent* from the data.
2. **Serialized-size cap — the only hard backstop.** A byte ceiling on the
   returned payload guards against pathological cases (e.g. a high `limit` over
   very wide objects). On hit, truncate and note it via `showing N of M`. This
   is the single true limit; everything else is the agent's call.
3. **Depth/length cap on the pretty-printed fallback.** Nested values are
   printed with bounded depth and elided with `…` past the limit (display only).
4. **Tool description nudges projection.** The tool doc instructs the agent to
   project only needed fields and aggregate server-side (via jq) rather than
   pulling whole reports — so the *first* result is already small, and raising
   `limit` is rarely necessary.

### Result presentation (kills the blob)

The tool **always** returns a `display` payload; results are never emitted as
one-line JSON. The display is auto-shaped from the result value:

- **Array of uniform objects** → `RichTable` (existing component).
- **Scalar or small flat object** → a labeled key/value card.
- **Nested / irregular value** → a **pretty-printed, indented, scrollable
  code block** (bounded by the depth/length cap above). We do *not* force
  ill-fitting data into a table.

Plus a CSS fix so even table cells wrap:
`td { overflow-wrap: anywhere }` in `theme.css`.

The jq expression is hidden from the user (at most tucked behind a subtle
"details" affordance — default hidden).

## Components & boundaries

| Unit | Responsibility | Depends on |
|------|----------------|-----------|
| `axibridgeQuery` (service) | Build lazy virtual document; run jq; apply size caps | `axibridgeService`, `axibridgeCache`, jq engine |
| Lazy document proxy | Resolve only touched pieces from cache/client | `axibridgeCache`, `axibridgeClient` |
| Auto-shaper | Map a result value → `display` payload (table/card/code) | result type only (pure) |
| `axibridge_query` tool | Tool schema + description; calls service; returns result + display | `axibridgeQuery`, auto-shaper |

## Error handling

- Invalid jq expression → structured error back to the agent (so it can fix and
  retry), never shown raw to the user.
- Query timeout (e.g. a few seconds) → abort with a clear error.
- Missing/unresolvable run id → that piece resolves to null; jq continues.
- Network/cache failures during lazy resolve → surfaced in an `errors` array on
  the result (matching existing tool conventions).

## Testing

- **Lazy resolver:** a query touching one run fetches only that run (assert no
  other report loads).
- **Auto-shaper:** each result type (array-of-objects, scalar, small object,
  nested/irregular) → correct display kind.
- **Size caps:** oversized array → capped with `showing N of M`; oversized wide
  object → byte-capped; deep nesting → depth-elided.
- **Representative queries:** reproduce the attendance question via
  `axibridge_query` and assert a clean table, not a blob.
- **Read-only:** a jq expression cannot mutate cache state.

## Open questions

None blocking. Engine choice (`jq-web` vs alternative pure-JS jq) to be
confirmed at implementation time based on bundle size / WASM footprint.

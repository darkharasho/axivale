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
  { repos, index (all runs across repos), rollup, reports{ <id>: ... } }
  ```
- The user never sees the jq expression or the document shape — these are
  internal to the tool/agent.
- The 7 existing tools remain as fast paths for common questions;
  `axibridge_query` handles everything they can't shape.

### Lazy resolution (cheap over a large dataset)

- The virtual document is a **proxy**. jq only pulls the pieces it actually
  touches: touching `reports["abc"]` resolves that one report from
  cache/GitHub on demand; never load every run.
- `repos`, `index`, and `rollup` are cheap/already-cached and resolve eagerly.
- Per-run `reports` resolve individually and respect the existing LRU cache.

### jq engine

- Bundle a **pure-JS jq implementation** (e.g. `jq-web`) so there is no
  system-binary dependency — the Electron app stays self-contained.
- Run read-only; jq cannot mutate the cache.

### Size discipline (first-class — "there's a LOT of data")

This is the core of fixing the blob. The tool enforces, in order:

1. **Result count cap.** Array results are capped at a default N (e.g. 50
   rows). When truncated, return `showing N of M` so the agent/user knows
   data was cut, and the agent can re-query with a tighter filter or
   aggregation.
2. **Serialized-size cap.** Hard byte ceiling on the returned payload. If a
   result is under the count cap but still huge (wide objects), truncate and
   note it.
3. **Depth/length cap on the pretty-printed fallback.** Nested values are
   printed with bounded depth and elided with `…` past the limit.
4. **Tool description nudges projection.** The tool doc instructs the agent to
   project only needed fields and aggregate server-side (via jq) rather than
   pulling whole reports — so the *first* result is already small.

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

# Graceful Degradation — Design

**Date:** 2026-06-17
**Status:** Approved (revised after reading the stores)
**Sub-project:** 1 of 5 in the reliability/feature roadmap (graceful degradation → source-health dashboard → agent-reasoning evals → guild digests → richer share viewer)

## Problem

When a live fetch fails or is slow, AxiVale degrades poorly:

1. **Timeouts are inconsistent.** `axitoolsClient` already uses `AbortSignal.timeout(8000)` and maps `TimeoutError` to a clear message, but `gw2Client` (`src/main/gw2Client.ts`), `axibridgeClient` (`fetchJsonOrNull` + `downloadReport`), and the static wiki fetcher (`meta/fetcher.ts` `fetchWiki`) have **no deadline** — a slow or hung host wedges the whole agent turn. This is the likely cause of "attendance queries can time out on large guilds."
2. **AxiBridge index/rollup has no stale fallback.** `AxibridgeCache` persists `index.json` / `rollup.json` with a 5-minute TTL (`META_TTL_MS`). Past TTL, `readMeta` returns null and the service goes live (`axibridgeService.indexFor`). If the live fetch then fails, the still-on-disk-but-stale copy is **discarded** rather than served — so a transient GitHub outage blanks AxiBridge data the app already has.
3. **Retry/backoff is one-off.** It exists only inside `downloadReport`, not shared.

## Corrections from the first draft

Reading the stores corrected three assumptions:

- **Roster is not persisted.** `RosterStore` holds only user *annotations*, not a roster snapshot — roster is fetched live each turn. Stale-cache for roster would require **new snapshot persistence**, so it is explicitly a follow-up, not part of this pass.
- **AxiBridge already has a cache substrate.** `AxibridgeCache` (TTL, `fetchedAt`, LRU) is the natural and cheap target for stale-fallback.
- **A per-source status seam largely exists.** `MetaStore.MetaSource` already tracks `status / fetchedAt / error / sourceDate`, and `AxibridgeCache.repoStats` exposes `lastIndexFetch`. We do **not** build a parallel `sourceStatus` system; #4 reads what exists.

## Scope

In scope: a shared `resilientFetch` (timeout + opt-in retry/backoff), refactor of the three timeout-less clients onto it, `downloadReport`'s retry loop folded onto it, and AxiBridge stale-fallback for `index`/`rollup`.

Out of scope: roster snapshot persistence (follow-up), any new `sourceStatus` subsystem, caching GW2 item/price lookups, stale semantics on writes/Discord actions, and the #4 dashboard UI.

## Architecture

Two new units, one reused. No new dependencies.

```
resilientFetch (new)        global fetch + AbortSignal.timeout + opt-in retry/backoff
   ▲ used by
   gw2Client · axibridgeClient (fetchJsonOrNull + downloadReport) · meta/fetcher.fetchWiki
   (axitoolsClient already has its own timeout; migrate it for consistency)

AxibridgeCache.readMetaStale (new method)   read index/rollup ignoring TTL, return body + fetchedAt
   ▲ used by
   axibridgeService.indexFor / rollupFor    on live-fetch failure → serve stale + marker
```

`resilientFetch` sits *underneath* each client's existing typed-error mapping (`Gw2Error`, `AxibridgeError`, `AxitoolsError`). Clients keep their own status/JSON handling.

## Component 1: `resilientFetch`

**Location:** `src/main/net/resilientFetch.ts` (new `net/` directory)

**What it does:** Wraps the global `fetch` with a timeout and optional retry-with-backoff, returning the raw `Response`.

**Interface:**

```ts
export interface ResilientFetchOptions extends RequestInit {
  timeoutMs?: number        // default 10_000
  retries?: number          // default 0; >0 only for idempotent GETs
  backoffBaseMs?: number    // default 500 (matches downloadReport)
  sleep?: (ms: number) => Promise<void>  // injectable for tests; default setTimeout
}

export class FetchTimeoutError extends Error {}

export async function resilientFetch(
  url: string,
  opts?: ResilientFetchOptions
): Promise<Response>
```

**Behavior:**

- Timeout via `AbortSignal.timeout(timeoutMs)` (the pattern already proven in `axitoolsClient`); default **10s**. A caller's own `signal`, if passed, is honored alongside the timeout.
- A fetch aborted by the timeout throws `DOMException('TimeoutError')`; `resilientFetch` normalizes that to `FetchTimeoutError` so callers match one type.
- Retry only when `retries > 0`: attempts `retries + 1` times, exponential backoff `backoffBaseMs · 2^(attempt-1)` between tries. Retries on network/timeout errors only — **never** on an HTTP response (callers own status handling; a 500 is returned, not retried). 4xx/5xx are responses, not throws.
- `downloadReport`'s streaming read stays in `axibridgeClient`, but its attempt/backoff bookkeeping is expressed by calling `resilientFetch` with `retries` and a longer `timeoutMs` (e.g. 30s) per candidate URL.

**Dependencies:** global `fetch`, `AbortSignal.timeout`. Nothing else.

## Component 2: AxiBridge stale-fallback

**Location:** `AxibridgeCache.readMetaStale` (new method, `src/main/axibridgeCache.ts`) + `axibridgeService.indexFor` and the rollup path (`src/main/axibridgeService.ts`).

**`readMetaStale`:** like `readMeta` but ignores TTL and returns `{ body, fetchedAt } | null` (null only when the file is truly absent). It does **not** bump `lastAccess` (a stale read is a degraded read, not a real hit).

```ts
readMetaStale(repo: RepoRef, name: 'index' | 'rollup'): { body: string; fetchedAt: number } | null
```

**Service change (`indexFor`):** keep cache-first within TTL. When TTL has expired and the live `fetchIndex` *throws*, fall back to `readMetaStale`; if present, return its parsed value tagged stale. When live succeeds, behave exactly as today (write cache, return fresh). When live fails and no stale copy exists, rethrow.

The fresh/stale distinction is surfaced to callers via a small return shape so the tool/agent layer can say *"AxiBridge data as of 2 hours ago — GitHub was unreachable."* Concretely, `indexFor` returns `{ entries, stale, fetchedAt }`; callers that only need entries read `.entries`. The same treatment applies to the rollup path.

**Scope:** `index` and `rollup` only (the TTL'd meta files). Reports are immutable-once-cached already; roster is out of scope.

## Component 3: status seam — reuse, don't build

No new code. `MetaStore.MetaSource.status/fetchedAt/error` and `AxibridgeCache.repoStats().lastIndexFetch` already provide what #4 needs. This component exists in the spec only to record the decision: **#4 reads existing state; this pass adds nothing for it.**

## Data Flow

1. A tool handler calls a client method (e.g. `axibridgeService.indexFor`).
2. Within TTL → cached value, fresh.
3. Past TTL → client calls `resilientFetch` (timeout; retries for the idempotent GET).
4. Live success → write cache, return fresh.
5. Live failure with a stale copy on disk → `readMetaStale` → return `{ ..., stale: true, fetchedAt }`.
6. Live failure, no stale copy → typed error (`AxibridgeError`) as today.
7. The tool result carries any `{ stale, fetchedAt }` marker; the agent surfaces it.

## Error Handling

- Timeout → `FetchTimeoutError` → each client maps to its existing error class with a "timed out" message.
- Network unreachable → existing `catch` paths, unchanged.
- 429 / rate-limit → unchanged (already typed); not retried beyond existing behavior.
- Stale fallback applies only to AxiBridge `index`/`rollup` reads — never to writes or Discord actions.

## Testing

- **`resilientFetch`** (`src/main/net/resilientFetch.test.ts`): timeout fires → `FetchTimeoutError`; retry sequence on a flaky GET (injected `sleep`, counted attempts); no retry on an HTTP error response; no retry when `retries` is 0; a caller-supplied `signal` still aborts.
- **`AxibridgeCache.readMetaStale`** (extend `axibridgeCache.test.ts`): returns body + fetchedAt past TTL; null when file absent; does not bump `lastAccess`.
- **`axibridgeService` stale-fallback** (extend `axibridgeService.test.ts`): live success → fresh; live throw + stale present → `{ stale: true }`; live throw + no stale → rethrow.
- **Refactored clients**: all existing `gw2Client.test.ts` / `axibridgeClient.test.ts` / `axitoolsClient.test.ts` stay green (largely a refactor); add a timeout case to one of them.
- Run under the repo's 2-worker vitest cap.

## Rollout Order

1. `resilientFetch` + its tests (no callers yet). Ship-able alone.
2. Migrate `gw2Client`, then `axibridgeClient` (`fetchJsonOrNull` + `downloadReport`), then `meta/fetcher.fetchWiki`, then `axitoolsClient` onto it. One client per commit; existing tests gate each.
3. `readMetaStale` + `axibridgeService` stale-fallback + tool-layer marker.

Each step is independently mergeable and leaves the app working.

## Open Decisions (resolved)

- Default timeout: **10s** (30s for streamed `downloadReport`).
- Stale scope: **AxiBridge `index`/`rollup` only**; roster snapshot persistence is a follow-up.
- Status seam for #4: **reuse existing state**, build nothing here.

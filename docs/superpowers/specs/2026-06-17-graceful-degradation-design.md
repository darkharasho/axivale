# Graceful Degradation — Design

**Date:** 2026-06-17
**Status:** Approved (pending spec review)
**Sub-project:** 1 of 5 in the reliability/feature roadmap (graceful degradation → source-health dashboard → agent-reasoning evals → guild digests → richer share viewer)

## Problem

When a live fetch fails or is slow, AxiVale degrades poorly:

1. **No timeouts.** None of the `fetch()` calls use an `AbortController`. A slow GW2 or AxiBridge endpoint hangs the whole agent turn — the likely cause of "attendance queries can time out on large guilds."
2. **No stale-cache fallback.** When a live fetch fails, tools return an error string rather than last-known-good data, even though `RosterStore` and `MetaStore` already persist their data to disk.
3. **Retry/backoff is one-off.** It exists only inside `downloadReport` (`src/main/axibridgeClient.ts`), not shared across clients.

The codebase already has typed errors (`Gw2Error`, `AxibridgeError`), per-item fallback (parallel guild resolution in `gw2Client.accountInfo`), and disk persistence in the stores. This design fills the three gaps above without a greenfield rewrite.

## Scope

In scope: timeouts on all client fetches, generalized retry/backoff for idempotent GETs, stale-cache fallback for roster + meta reads, and a minimal source-status seam for the future source-health dashboard (#4).

Out of scope: caching GW2 item/price lookups (stale prices are wrong), stale semantics on Discord/write actions, the dashboard UI itself (#4), and any new external dependency.

## Architecture

Three new, independently testable units. No new dependencies.

```
resilientFetch (new)         fetch + AbortController timeout + retry/backoff
   ▲ used by every client
   gw2Client · axibridgeClient · axitoolsClient · axiforgeClient · meta/fetcher

withStaleCache (new)         try live → on failure, return persisted last-good + {stale, fetchedAt}
   ▲ wraps roster + meta reads only

sourceStatus (new, minimal)  record last-success / last-failure / latency  (seam for #4)
```

Existing typed-error mapping stays; `resilientFetch` sits *underneath* it. Each client keeps its own status/JSON handling and error classes.

## Component 1: `resilientFetch`

**Location:** `src/main/net/resilientFetch.ts` (new `net/` directory)

**What it does:** Wraps the global `fetch` with a timeout and optional retry-with-backoff, returning the raw `Response` so callers keep their existing handling.

**Interface (sketch):**

```ts
export interface ResilientFetchOptions extends RequestInit {
  timeoutMs?: number   // default 10_000
  retries?: number     // default 0; set >0 only for idempotent GETs
  backoffBaseMs?: number // default 500 (matches downloadReport)
  sleep?: (ms: number) => Promise<void> // injectable for tests
}

export class FetchTimeoutError extends Error {}

export async function resilientFetch(
  url: string,
  opts?: ResilientFetchOptions
): Promise<Response>
```

**Behavior:**

- Timeout via `AbortController`; default **10s**. Streamed `downloadReport` passes a longer value (e.g. 30s).
- Retry only when `retries > 0` (callers opt in for idempotent GETs): exponential backoff `backoffBaseMs · 2^(attempt-1)`. No retry on 4xx except 429.
- On timeout, the abort surfaces as `FetchTimeoutError`; each client maps it to its existing error class (`Gw2Error`, `AxibridgeError`, etc.) with a "timed out" message.
- `downloadReport`'s hand-rolled retry loop is reimplemented on top of this (its streaming read stays, but attempt/backoff bookkeeping moves into `resilientFetch`).

**Dependencies:** global `fetch`, `AbortController`. Nothing else.

## Component 2: `withStaleCache`

**Location:** `src/main/net/withStaleCache.ts` (helper) + small additions to `RosterStore` / `MetaStore`.

**What it does:** Runs a live fetch; on failure, returns the last persisted good value tagged as stale.

**Interface (sketch):**

```ts
export interface StaleResult<T> {
  value: T
  stale: boolean
  fetchedAt: string | null // ISO; null when value is fresh-but-untracked
}

export async function withStaleCache<T>(args: {
  live: () => Promise<T>
  readCache: () => { value: T; fetchedAt: string } | null
  writeCache: (value: T) => void // stamps fetchedAt = now
}): Promise<StaleResult<T>>
```

**Behavior:**

- Live success → `writeCache`, return `{ value, stale: false }`.
- Live failure with cache present → return `{ value: cached, stale: true, fetchedAt }`.
- Live failure with no cache → rethrow the live error (nothing to fall back to).

**Store changes:** add a `fetchedAt` ISO timestamp alongside the cached roster snapshot and meta builds. Both stores already write atomically (tmp + rename, debounced); we extend the `FileShape` with the timestamp and bump any version guard as needed.

**Scope:** roster + meta builds only. GW2 item/price lookups and Discord/write actions remain live-only.

**Surfacing:** the tool layer threads `{ stale, fetchedAt }` into the tool result so the agent can say e.g. *"roster as of 3 hours ago — the bot was unreachable."* This fits the existing system-prompt honesty values.

## Component 3: `sourceStatus` (minimal seam for #4)

**Location:** `src/main/net/sourceStatus.ts`

**What it does:** Records, per logical source (e.g. `gw2`, `axibridge:<repo>`, `meta:snowcrows`), the last success time, last failure time + reason, and last latency. In-memory map with an optional debounced persist (same pattern as the stores). Clients call `sourceStatus.record(source, outcome)` after each fetch.

**Why now:** building this seam while we touch every client is cheap; #4 (source-health dashboard) then just reads it. Kept deliberately minimal — no UI, no history ring beyond last-status — to avoid scope creep. If we'd rather defer it entirely, drop this component and add the `record` calls when building #4.

## Data Flow

1. A tool handler calls a client method (e.g. `axibridge.fetchIndex`).
2. The client calls `resilientFetch` (with a timeout; retries for idempotent GETs).
3. For roster/meta reads, the call is wrapped in `withStaleCache`.
4. The client calls `sourceStatus.record` with success/failure + latency.
5. On success: fresh value flows back. On failure with cache: stale value + marker. On failure without cache: typed error.
6. The tool result carries any `{ stale, fetchedAt }` marker; the agent surfaces it to the user.

## Error Handling

- Timeout → `FetchTimeoutError` → mapped to the client's existing error class.
- Network unreachable → existing `catch` paths, now also recorded in `sourceStatus`.
- 429 / rate-limit → unchanged (already typed); no retry beyond existing behavior.
- Stale fallback never masks a *write* failure — it applies only to the read paths listed above.

## Testing

- **`resilientFetch`:** fake-timer tests for timeout firing, retry/backoff sequence on a flaky GET, no-retry-on-4xx (except 429), abort cleanup. `sleep` injected.
- **`withStaleCache`:** live-success passthrough + cache write, live-fail → stale return, no-cache → rethrow.
- **`sourceStatus`:** record + read-back of last success/failure/latency.
- **Refactored clients:** all existing client tests must stay green (largely a refactor). Add a timeout case and a stale-fallback case to roster + axibridge tests.
- Run under the repo's 2-worker vitest cap.

## Rollout Order

1. `resilientFetch` + refactor all clients (timeouts everywhere). Ship-able on its own.
2. `withStaleCache` + store timestamps + tool surfacing.
3. `sourceStatus` seam.

Each step is independently mergeable and leaves the app in a working state.

## Open Decisions (resolved)

- Default timeout: **10s** (30s for streamed downloads).
- Stale scope: **roster + meta only**.
- `sourceStatus` seam: **included** (optional; can be deferred to #4).

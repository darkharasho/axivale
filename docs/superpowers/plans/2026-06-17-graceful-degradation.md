# Graceful Degradation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every AxiVale network client a request deadline and let AxiBridge serve last-known-good `index`/`rollup` data when a live fetch fails.

**Architecture:** Add one shared `resilientFetch` wrapper (timeout + opt-in retry) that every client uses underneath its existing typed-error mapping. Add a TTL-ignoring `readMetaStale` to `AxibridgeCache` and wire `axibridgeService` to fall back to it, tagging results as stale so the agent can say "data as of N ago."

**Tech Stack:** TypeScript, Electron main process, Vitest (`vi.stubGlobal('fetch', …)` mocking), global `fetch` + `AbortSignal.timeout`.

## Global Constraints

- Vitest must run under a 2-worker cap: `npx vitest run --maxWorkers=2 <path>`.
- No new runtime dependencies.
- Each client keeps its existing error class (`Gw2Error`, `AxibridgeError`, `AxitoolsError`) and its own HTTP-status/JSON handling. `resilientFetch` sits underneath and only throws on network/timeout, never on an HTTP response.
- Default timeout 10s; streamed `downloadReport` uses 30s; `axitoolsClient` keeps its existing 8s.
- Stale fallback applies only to AxiBridge `index`/`rollup` reads — never to writes or Discord actions.
- All existing tests must stay green after each task.

---

### Task 1: `resilientFetch` wrapper

**Files:**
- Create: `src/main/net/resilientFetch.ts`
- Test: `src/main/net/resilientFetch.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `resilientFetch(url: string, opts?: ResilientFetchOptions): Promise<Response>`
  - `class FetchTimeoutError extends Error`
  - `interface ResilientFetchOptions extends RequestInit { timeoutMs?: number; retries?: number; backoffBaseMs?: number; sleep?: (ms: number) => Promise<void> }`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/net/resilientFetch.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resilientFetch, FetchTimeoutError } from './resilientFetch'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const noSleep = (): Promise<void> => Promise.resolve()

describe('resilientFetch', () => {
  beforeEach(() => mockFetch.mockReset())

  it('returns the response on success without retrying', async () => {
    const resp = new Response('ok', { status: 200 })
    mockFetch.mockResolvedValueOnce(resp)
    const out = await resilientFetch('https://x/y')
    expect(out).toBe(resp)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry an HTTP error response', async () => {
    mockFetch.mockResolvedValueOnce(new Response('boom', { status: 500 }))
    const out = await resilientFetch('https://x/y', { retries: 3, sleep: noSleep })
    expect(out.status).toBe(500)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('normalizes a timeout abort to FetchTimeoutError', async () => {
    mockFetch.mockRejectedValueOnce(new DOMException('aborted', 'TimeoutError'))
    await expect(resilientFetch('https://x/y')).rejects.toBeInstanceOf(FetchTimeoutError)
  })

  it('retries thrown network errors with backoff, then succeeds', async () => {
    const sleep = vi.fn(() => Promise.resolve())
    mockFetch
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    const out = await resilientFetch('https://x/y', { retries: 2, sleep, backoffBaseMs: 500 })
    expect(out.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(500)
  })

  it('rethrows the last error after exhausting retries', async () => {
    mockFetch.mockRejectedValue(new TypeError('network'))
    await expect(resilientFetch('https://x/y', { retries: 2, sleep: noSleep })).rejects.toThrow('network')
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --maxWorkers=2 src/main/net/resilientFetch.test.ts`
Expected: FAIL — `Cannot find module './resilientFetch'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/net/resilientFetch.ts
//
// Shared fetch wrapper: every client gets a request deadline so a slow or hung
// host can't wedge an agent turn. Retries are opt-in and apply ONLY to thrown
// network/timeout errors — an HTTP response (any status) is returned as-is so
// callers keep ownership of status handling.

export interface ResilientFetchOptions extends RequestInit {
  /** Per-attempt deadline. Default 10s. */
  timeoutMs?: number
  /** Extra attempts after the first. Default 0. Use >0 only for idempotent GETs. */
  retries?: number
  /** Backoff base; delay before attempt n is backoffBaseMs * 2^(n-1). Default 500. */
  backoffBaseMs?: number
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>
}

export class FetchTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`)
    this.name = 'FetchTimeoutError'
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function resilientFetch(
  url: string,
  opts: ResilientFetchOptions = {}
): Promise<Response> {
  const {
    timeoutMs = 10_000,
    retries = 0,
    backoffBaseMs = 500,
    sleep = defaultSleep,
    signal: callerSignal,
    ...init
  } = opts

  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(backoffBaseMs * 2 ** (attempt - 1))
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal
    try {
      return await fetch(url, { ...init, signal })
    } catch (err) {
      // A caller-driven abort is intentional — surface it immediately, never retry.
      if (callerSignal?.aborted) throw err
      lastError =
        err instanceof DOMException && err.name === 'TimeoutError'
          ? new FetchTimeoutError(url, timeoutMs)
          : err
    }
  }
  throw lastError
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --maxWorkers=2 src/main/net/resilientFetch.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/net/resilientFetch.ts src/main/net/resilientFetch.test.ts
git commit -m "feat(net): add resilientFetch wrapper (timeout + opt-in retry)"
```

---

### Task 2: Migrate `gw2Client` onto `resilientFetch`

**Files:**
- Modify: `src/main/gw2Client.ts:37-56`
- Test: `src/main/gw2Client.test.ts` (add one case)

**Interfaces:**
- Consumes: `resilientFetch`, `FetchTimeoutError` from Task 1.
- Produces: no signature changes; `Gw2Client.get` now applies a 10s deadline.

- [ ] **Step 1: Write the failing test** (append inside the existing `describe('Gw2Client', …)` block)

```ts
  it('maps a fetch timeout to a clear Gw2Error', async () => {
    mockFetch.mockRejectedValueOnce(new DOMException('aborted', 'TimeoutError'))
    await expect(client.guildMembers('G-1')).rejects.toThrow(/did not respond in time/)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --maxWorkers=2 src/main/gw2Client.test.ts`
Expected: FAIL — current message is "Could not reach the GW2 API", not "did not respond in time".

- [ ] **Step 3: Write minimal implementation**

At the top of `src/main/gw2Client.ts`, add the import under the existing `const BASE` line:

```ts
import { resilientFetch, FetchTimeoutError } from './net/resilientFetch'
```

Replace the `get` method's fetch block (lines 38-45):

```ts
    let resp: Response
    try {
      resp = await resilientFetch(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        timeoutMs: 10_000
      })
    } catch (err) {
      if (err instanceof FetchTimeoutError) {
        throw new Gw2Error('The GW2 API did not respond in time — try again in a moment.')
      }
      throw new Gw2Error('Could not reach the GW2 API — check your network connection.')
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --maxWorkers=2 src/main/gw2Client.test.ts`
Expected: PASS (all existing cases + the new one).

- [ ] **Step 5: Commit**

```bash
git add src/main/gw2Client.ts src/main/gw2Client.test.ts
git commit -m "feat(gw2): apply request timeout via resilientFetch"
```

---

### Task 3: Migrate `axibridgeClient` onto `resilientFetch`

**Files:**
- Modify: `src/main/axibridgeClient.ts` — `fetchJsonOrNull` (lines 69-102) and `downloadReport` (lines 161-208)
- Test: `src/main/axibridgeClient.test.ts` (existing cases must stay green)

**Interfaces:**
- Consumes: `resilientFetch`, `FetchTimeoutError` from Task 1.
- Produces: no signature changes. `fetchJsonOrNull` treats a timeout as a network failure (sets `lastNetworkError`); `downloadReport` gives each candidate fetch a 30s deadline while keeping its existing 3-attempt backoff loop.

- [ ] **Step 1: Write the failing test** (append inside the top-level `describe` in `axibridgeClient.test.ts`)

```ts
  it('treats a fetch timeout as a network error', async () => {
    mockFetch.mockRejectedValue(new DOMException('aborted', 'TimeoutError'))
    const client = new AxibridgeClient(() => null)
    await expect(client.fetchIndex({ owner: 'o', repo: 'r' })).rejects.toThrow(/check your network connection/)
  })
```

> Note: confirm the test file's fetch mock variable name (it uses `vi.stubGlobal('fetch', …)`); reuse that mock. If the file names it differently than `mockFetch`, match the existing name.

- [ ] **Step 2: Run test to verify it fails or errors**

Run: `npx vitest run --maxWorkers=2 src/main/axibridgeClient.test.ts`
Expected: FAIL — without a timeout, the rejected DOMException currently lands in the generic catch but the message path differs; the new assertion pins the network-error message.

- [ ] **Step 3: Write minimal implementation**

Add the import at the top of `src/main/axibridgeClient.ts` (under the existing imports):

```ts
import { resilientFetch } from './net/resilientFetch'
```

In `fetchJsonOrNull`, replace the fetch call (line 76) so the request has a deadline; the surrounding `try/catch` already routes any throw to `lastNetworkError`:

```ts
        resp = await resilientFetch(url, {
          headers: isPages ? { 'User-Agent': 'AxiVale' } : this.authHeaders(),
          timeoutMs: 10_000
        })
```

In `downloadReport`, replace the fetch call (line 177) with a deadline-bearing call (the outer attempt loop keeps providing retry/backoff, so no inner retries):

```ts
        const resp = await resilientFetch(url, { headers, timeoutMs: 30_000 })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --maxWorkers=2 src/main/axibridgeClient.test.ts`
Expected: PASS (existing cases + the new timeout case).

- [ ] **Step 5: Commit**

```bash
git add src/main/axibridgeClient.ts src/main/axibridgeClient.test.ts
git commit -m "feat(axibridge): apply request timeouts via resilientFetch"
```

---

### Task 4: Migrate `meta/fetcher.fetchWiki` and `axitoolsClient`

**Files:**
- Modify: `src/main/meta/fetcher.ts` — `fetchWiki` (the `fetch(api, …)` call near line 87)
- Modify: `src/main/axitoolsClient.ts:30-50`
- Test: `src/main/axitoolsClient.test.ts` (existing cases must stay green)

**Interfaces:**
- Consumes: `resilientFetch`, `FetchTimeoutError` from Task 1.
- Produces: no signature changes. `axitoolsClient` keeps its 8s deadline and its existing timeout message, now sourced from `FetchTimeoutError`.

- [ ] **Step 1: Write the failing test** (append inside the `describe` in `axitoolsClient.test.ts`)

```ts
  it('maps a fetch timeout to the bot-not-responding message', async () => {
    mockFetch.mockRejectedValueOnce(new DOMException('aborted', 'TimeoutError'))
    const client = new AxitoolsClient('http://127.0.0.1:9', 'TOK')
    await expect(client.listGuilds()).rejects.toThrow(/did not respond in time/)
  })
```

> Match the existing fetch-mock variable name in this file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --maxWorkers=2 src/main/axitoolsClient.test.ts`
Expected: FAIL until the `request` method maps `FetchTimeoutError` (currently it matches `err.name === 'TimeoutError'`, which a real `AbortSignal.timeout` produces, but the test injects a thrown DOMException that the new path normalizes).

- [ ] **Step 3: Write minimal implementation**

Add the import at the top of `src/main/axitoolsClient.ts`:

```ts
import { resilientFetch, FetchTimeoutError } from './net/resilientFetch'
```

Replace the fetch block in `request` (lines 32-50):

```ts
    let resp: Response
    try {
      resp = await resilientFetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        timeoutMs: 8000
      })
    } catch (err) {
      if (err instanceof FetchTimeoutError) {
        throw new AxitoolsError('The AxiTools bot did not respond in time — is it running?')
      }
      throw new AxitoolsError('The AxiTools bot is not reachable — is it running on this machine?')
    }
```

In `src/main/meta/fetcher.ts`, add the import near the existing `import { fetchSnowcrowsStatic } from './snowcrows'`:

```ts
import { resilientFetch } from '../net/resilientFetch'
```

Replace the `fetchWiki` fetch call (line 87):

```ts
    const res = await resilientFetch(api, { headers: { 'User-Agent': 'AxiVale' }, timeoutMs: 10_000 })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --maxWorkers=2 src/main/axitoolsClient.test.ts src/main/meta`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/axitoolsClient.ts src/main/meta/fetcher.ts src/main/axitoolsClient.test.ts
git commit -m "feat(net): route axitools + wiki fetcher through resilientFetch"
```

---

### Task 5: `AxibridgeCache.readMetaStale`

**Files:**
- Modify: `src/main/axibridgeCache.ts` (add method after `readMeta`, line 138)
- Test: `src/main/axibridgeCache.test.ts` (add cases)

**Interfaces:**
- Consumes: nothing new.
- Produces: `readMetaStale(repo: RepoRef, name: 'index' | 'rollup'): { body: string; fetchedAt: number } | null`

- [ ] **Step 1: Write the failing test** (append inside the existing `describe` in `axibridgeCache.test.ts`; reuse its temp-dir + `now` setup pattern)

```ts
  it('readMetaStale returns body + fetchedAt past TTL, null when absent', () => {
    let clock = 1_000
    const cache = new AxibridgeCache({ dir: tmpDir, capBytes: 1_000_000, ttlMs: 5 * 60_000, now: () => clock })
    const repo = { owner: 'o', repo: 'r' }
    cache.putMeta(repo, 'index', '[{"id":"run-1"}]')
    clock += 10 * 60_000 // advance well past the TTL

    expect(cache.readMeta(repo, 'index')).toBeNull() // TTL'd out
    const stale = cache.readMetaStale(repo, 'index')
    expect(stale?.body).toBe('[{"id":"run-1"}]')
    expect(stale?.fetchedAt).toBe(1_000)
    expect(cache.readMetaStale(repo, 'rollup')).toBeNull() // never written
  })
```

> If the test file uses a different temp-dir variable than `tmpDir`, match it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --maxWorkers=2 src/main/axibridgeCache.test.ts`
Expected: FAIL — `readMetaStale` is not a function.

- [ ] **Step 3: Write minimal implementation** — add after the `readMeta` method (line 138):

```ts
  /** Read index/rollup ignoring the TTL — a degraded last resort when the live
   *  fetch fails. Does not bump lastAccess (a stale read is not a real hit). */
  readMetaStale(repo: RepoRef, name: 'index' | 'rollup'): { body: string; fetchedAt: number } | null {
    const path = this.pathFor(repo, 'meta', name)
    if (!existsSync(path)) return null
    const entry = this.readLedger().entries[this.key(repo, 'meta', name)]
    return { body: readFileSync(path, 'utf8'), fetchedAt: entry?.fetchedAt ?? 0 }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --maxWorkers=2 src/main/axibridgeCache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/axibridgeCache.ts src/main/axibridgeCache.test.ts
git commit -m "feat(axibridge): add readMetaStale (TTL-ignoring cache read)"
```

---

### Task 6: `axibridgeService.indexFor` stale-fallback + surface through `runsList`

**Files:**
- Modify: `src/main/axibridgeService.ts` — `indexFor` (lines 51-58), its three internal callers (lines 67, 91, 163), and `runsList` (lines 85-106)
- Test: `src/main/axibridgeService.test.ts` (add cases)

**Interfaces:**
- Consumes: `AxibridgeCache.readMetaStale` (Task 5).
- Produces:
  - `indexFor(repo)` now returns `{ entries: ReportIndexEntry[]; stale: boolean; fetchedAt: number | null }`.
  - `runsList(...)` return shape gains `staleRepos: string[]` (repos served from stale cache this call).

- [ ] **Step 1: Write the failing test** (in `axibridgeService.test.ts`; reuse its existing dep-stub helpers for `cache`, `client`, `repos`)

```ts
  it('serves stale index when the live fetch fails and flags the repo', async () => {
    const repo = { owner: 'o', repo: 'r' }
    const cache = {
      readMeta: vi.fn().mockReturnValue(null), // TTL expired
      putMeta: vi.fn(),
      readMetaStale: vi.fn().mockReturnValue({ body: JSON.stringify([{ id: 'run-1', dateStart: '2026-06-01' }]), fetchedAt: 1_000 }),
      repoStats: vi.fn().mockReturnValue({ cachedReports: 1, lastIndexFetch: 1_000, cacheBytes: 0 })
    }
    const client = { fetchIndex: vi.fn().mockRejectedValue(new Error('GitHub down')) }
    const svc = new AxibridgeService({ cache, client, repos: () => [repo] } as any)

    const { runs, staleRepos } = await svc.runsList({})
    expect(runs.map((r) => r.id)).toEqual(['run-1'])
    expect(staleRepos).toEqual(['o/r'])
  })

  it('rethrows when live fails and no stale copy exists', async () => {
    const repo = { owner: 'o', repo: 'r' }
    const cache = {
      readMeta: vi.fn().mockReturnValue(null),
      putMeta: vi.fn(),
      readMetaStale: vi.fn().mockReturnValue(null),
      repoStats: vi.fn().mockReturnValue({ cachedReports: 0, lastIndexFetch: null, cacheBytes: 0 })
    }
    const client = { fetchIndex: vi.fn().mockRejectedValue(new Error('GitHub down')) }
    const svc = new AxibridgeService({ cache, client, repos: () => [repo] } as any)

    const { runs, errors } = await svc.runsList({})
    expect(runs).toEqual([])
    expect(errors[0]).toMatch(/GitHub down/) // error isolated per repo, not thrown
  })
```

> Match the exact `AxibridgeServiceDeps` shape the file expects; the stubs above mirror the fields used by `indexFor` / `runsList` / `repoStats`. `repoKey({owner:'o',repo:'r'})` yields `'o/r'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --maxWorkers=2 src/main/axibridgeService.test.ts`
Expected: FAIL — `runsList` has no `staleRepos`; `indexFor` currently rethrows on live failure instead of falling back.

- [ ] **Step 3: Write minimal implementation**

Replace `indexFor` (lines 51-58):

```ts
  /** index.json per repo, cache-first (5 min TTL). On live failure, falls back to
   *  the past-TTL copy tagged stale. Errors isolated per repo by callers. */
  private async indexFor(
    repo: RepoRef
  ): Promise<{ entries: ReportIndexEntry[]; stale: boolean; fetchedAt: number | null }> {
    const cached = this.deps.cache.readMeta(repo, 'index')
    if (cached) return { entries: JSON.parse(cached) as ReportIndexEntry[], stale: false, fetchedAt: null }
    try {
      const entries = await this.deps.client.fetchIndex(repo)
      this.deps.cache.putMeta(repo, 'index', JSON.stringify(entries))
      return { entries, stale: false, fetchedAt: null }
    } catch (err) {
      const stale = this.deps.cache.readMetaStale(repo, 'index')
      if (stale) {
        return { entries: JSON.parse(stale.body) as ReportIndexEntry[], stale: true, fetchedAt: stale.fetchedAt }
      }
      throw err
    }
  }
```

Update the caller in `reposStatus` (line 67) — it only needs entries:

```ts
        const { entries } = await this.indexFor(repo)
```

Update the caller in `rollupFor` (line 163):

```ts
      const { entries } = await this.indexFor(repo)
```

Replace `runsList` (lines 85-106) to thread staleness:

```ts
  async runsList(
    filter: DateRange & { repo?: string }
  ): Promise<{ runs: RunListEntry[]; errors: string[]; staleRepos: string[] }> {
    const repos = this.requireRepos().filter((r) => !filter.repo || repoKey(r) === filter.repo)
    const runs: RunListEntry[] = []
    const errors: string[] = []
    const staleRepos: string[] = []
    for (const repo of repos) {
      try {
        const { entries, stale } = await this.indexFor(repo)
        if (stale) staleRepos.push(repoKey(repo))
        for (const entry of entries) {
          if (inRange(entry, filter)) runs.push({ ...entry, repo: repoKey(repo) })
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err)) // other repos unaffected
      }
    }
    runs.sort((a, b) => {
      const da = localRunDate(a.id, a.dateStart) ?? ''
      const db = localRunDate(b.id, b.dateStart) ?? ''
      if (da !== db) return db.localeCompare(da)
      return String(b.id ?? '').localeCompare(String(a.id ?? ''))
    })
    return { runs, errors, staleRepos }
  }
```

Check for other `runsList(` callers that destructure its result and ensure adding a field doesn't break them (line 148 `const { runs, errors } = await this.runsList(args)` keeps working — extra field ignored). No change needed there.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --maxWorkers=2 src/main/axibridgeService.test.ts`
Expected: PASS (new cases + all existing).

- [ ] **Step 5: Commit**

```bash
git add src/main/axibridgeService.ts src/main/axibridgeService.test.ts
git commit -m "feat(axibridge): serve stale index on live failure, flag stale repos"
```

---

### Task 7: `rollupFor` stale-fallback + final full-suite gate

**Files:**
- Modify: `src/main/axibridgeService.ts` — `rollupFor` (lines 153-177)
- Test: `src/main/axibridgeService.test.ts` (add a case)

**Interfaces:**
- Consumes: `AxibridgeCache.readMetaStale` (Task 5).
- Produces: `rollupFor(repo)` return shape gains `stale: boolean` and `fetchedAt: number | null` alongside its existing `{ rollup, source }`.

- [ ] **Step 1: Write the failing test**

```ts
  it('serves stale rollup when the live rollup fetch fails', async () => {
    const repo = { owner: 'o', repo: 'r' }
    const body = JSON.stringify({ rollup: { playerRows: [] }, source: 'published' })
    const cache = {
      readMeta: vi.fn().mockReturnValue(null),
      putMeta: vi.fn(),
      readMetaStale: vi.fn().mockReturnValue({ body, fetchedAt: 2_000 })
    }
    const client = { fetchRollup: vi.fn().mockRejectedValue(new Error('GitHub down')) }
    const svc = new AxibridgeService({ cache, client, repos: () => [repo] } as any)

    // rollupFor is private; exercise it via the no-range attendance path.
    const out = await (svc as any).rollupFor(repo)
    expect(out.stale).toBe(true)
    expect(out.fetchedAt).toBe(2_000)
    expect(out.source).toBe('published')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --maxWorkers=2 src/main/axibridgeService.test.ts`
Expected: FAIL — `rollupFor` rethrows on live failure and returns no `stale` field.

- [ ] **Step 3: Write minimal implementation** — wrap the live path in `rollupFor` (lines 155-176):

```ts
  private async rollupFor(
    repo: RepoRef
  ): Promise<{ rollup: RollupData; source: 'published' | 'computed-locally'; stale: boolean; fetchedAt: number | null }> {
    const cached = this.deps.cache.readMeta(repo, 'rollup')
    if (cached) {
      const parsed = JSON.parse(cached) as { rollup: RollupData; source: 'published' | 'computed-locally' }
      return { ...parsed, stale: false, fetchedAt: null }
    }
    try {
      const published = await this.deps.client.fetchRollup(repo)
      let result: { rollup: RollupData; source: 'published' | 'computed-locally' }
      if (published) {
        result = { rollup: published.rollup, source: 'published' }
      } else {
        const { entries } = await this.indexFor(repo)
        const sources: RollupReportPayload[] = []
        for (const entry of entries) {
          let body = this.deps.cache.readReport(repo, entry.id)
          if (!body) {
            body = JSON.stringify(await this.deps.client.fetchReport(repo, entry.id))
            this.deps.cache.putReport(repo, entry.id, body)
          }
          sources.push(extractRollupSource(JSON.parse(body) as RollupReportPayload))
        }
        result = { rollup: buildRollupData(sources), source: 'computed-locally' }
      }
      this.deps.cache.putMeta(repo, 'rollup', JSON.stringify(result))
      return { ...result, stale: false, fetchedAt: null }
    } catch (err) {
      const stale = this.deps.cache.readMetaStale(repo, 'rollup')
      if (stale) {
        const parsed = JSON.parse(stale.body) as { rollup: RollupData; source: 'published' | 'computed-locally' }
        return { ...parsed, stale: true, fetchedAt: stale.fetchedAt }
      }
      throw err
    }
  }
```

Confirm `rollupFor`'s callers (in `attendance`) destructure `rollup`/`source` and ignore the two new fields — adding fields is non-breaking. If a caller wants to surface staleness to the agent, it can now read `.stale`/`.fetchedAt`; no caller change is required for this task.

- [ ] **Step 4: Run the full main-process suite to verify nothing regressed**

Run: `npx vitest run --maxWorkers=2 src/main`
Expected: PASS — entire main-process suite green.

- [ ] **Step 5: Commit**

```bash
git add src/main/axibridgeService.ts src/main/axibridgeService.test.ts
git commit -m "feat(axibridge): serve stale rollup on live failure"
```

---

## Self-Review

**Spec coverage:**
- Timeouts on `gw2Client` / `axibridgeClient` / `meta.fetchWiki` / `axitoolsClient` → Tasks 2, 3, 4. ✓
- Shared `resilientFetch` (timeout + opt-in retry) → Task 1. ✓
- `downloadReport` routed through `resilientFetch` (30s) → Task 3. ✓
- AxiBridge `index` stale-fallback → Tasks 5–6. ✓
- AxiBridge `rollup` stale-fallback → Tasks 5, 7. ✓
- `{ stale, fetchedAt }` surfaced to callers → `runsList.staleRepos` (Task 6) + `rollupFor` fields (Task 7). ✓
- Status seam for #4 = reuse existing state → no task, by design. ✓
- Roster snapshot persistence explicitly deferred → not planned, matches spec. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. Two notes ask the executor to match existing mock/var names — these are verification prompts, not placeholders.

**Type consistency:** `indexFor` returns `{ entries, stale, fetchedAt }` in Task 6 and is consumed as `{ entries }` in `reposStatus`/`rollupFor` (same task) and `{ entries, stale }` in `runsList`. `readMetaStale` returns `{ body, fetchedAt }` (Task 5) and is consumed as such in Tasks 6–7. `FetchTimeoutError` / `resilientFetch` signatures consistent across Tasks 1–4. ✓

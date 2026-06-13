# GitHub Pages SPA Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users share a full conversation or a single AI response as a public link, served by a GitHub Pages SPA that AxiVale creates and manages in the user's own GitHub account.

**Architecture:** A pure sanitizer turns a stored `Conversation` into a redacted `ShareDoc` (strips raw tool inputs/results). A local `ShareStore` tracks created shares. A `SharePublisher` (talking to GitHub through an injectable `GithubShareClient`) ensures a public `axivale-shares` repo exists, pushes a prebuilt static **share-viewer SPA**, enables GitHub Pages, and writes/deletes per-share `shares/<id>.json` files. The viewer is a small Vite/React app that reuses AxiVale's existing markdown + newspaper rendering. Renderer hover controls + a dialog drive it over new IPC channels.

**Tech Stack:** TypeScript, Electron (main + preload IPC), React 18, Vite/electron-vite, GitHub REST API v3 (`fetch`), vitest (+ @testing-library/react, jsdom).

**Conventions to follow (from the existing codebase):**
- Network modules take an injectable `fetchFn: typeof fetch` so they unit-test with no real network (see `src/main/githubRepos.ts`, `src/main/githubAuth.ts`).
- Stores own a JSON file with atomic tmp+rename writes and debounced scheduling (see `src/main/conversationStore.ts`).
- The GitHub token is read in main via `store.getActiveKey('github')` (a `SettingsStore` method); `'' `/null means "not signed in".
- Renderer talks to main only through `window.officer.*`, typed in `src/preload/index.d.ts`.
- Run tests with `npx vitest run --maxWorkers=2` (machine memory constraint; the repo's `vitest.config.ts` already caps forks at 2).
- Commit after every task.

**Repo constants used throughout:** repo name `axivale-shares`; share-doc path `shares/<id>.json`; viewer marker file `viewer-version`; share URL shape `https://<login>.github.io/axivale-shares/#/s/<id>`.

---

## File Structure

**New (main process):**
- `src/main/shareTypes.ts` — shared `ShareDoc`/`SharedTurn`/`SharedTool` types (imported by sanitizer, publisher, and copied into the viewer).
- `src/main/shareSanitize.ts` — `buildSharePayload()` + `deriveTitle()` (pure).
- `src/main/shareId.ts` — `makeShareId()` (crypto RNG slug).
- `src/main/shareGithub.ts` — `createGithubShareClient(token, fetchFn?)` implementing `GithubShareClient`.
- `src/main/shareStore.ts` — `ShareStore` local registry (`shares.json`).
- `src/main/sharePublisher.ts` — `SharePublisher` orchestration + `GithubShareClient` interface + `ViewerBundle` type.
- `src/main/shareViewerBundle.ts` — `loadViewerBundle(dir)` reads built viewer files from disk + content hash.

**New (viewer SPA):**
- `vite.viewer.config.ts` — standalone Vite build → `out/share-viewer`.
- `src/share-viewer/index.html`
- `src/share-viewer/main.tsx`
- `src/share-viewer/ShareApp.tsx`
- `src/share-viewer/shareTypes.ts` — copy of the doc types (viewer must not import from `src/main`).
- `src/share-viewer/viewer.css`

**New (renderer):**
- `src/renderer/src/components/ShareDialog.tsx`

**New (tests):**
- `src/main/shareSanitize.test.ts`, `src/main/shareId.test.ts`, `src/main/shareGithub.test.ts`, `src/main/shareStore.test.ts`, `src/main/sharePublisher.test.ts`
- `src/renderer/src/components/ShareDialog.test.tsx`

**Modified:**
- `src/main/index.ts` — construct `ShareStore`/`SharePublisher`; add `share:*` IPC handlers.
- `src/preload/index.ts` — expose `share*` methods.
- `src/preload/index.d.ts` — add `share*` to `OfficerApi` + a `ShareListEntry` type.
- `src/renderer/src/components/Article.tsx` — share-response hover button + `conversationId`/`onShare` props.
- `src/renderer/src/components/Editions.tsx` — share-conversation hover action.
- `src/renderer/src/App.tsx` — share dialog state, wire handlers into `Article`/`Editions`, render `ShareDialog`.
- `src/renderer/src/components/Settings.tsx` — "Shared" management list.
- `src/renderer/src/theme.css` — styles for share button, dialog, settings list.
- `package.json` — `build:viewer` script + chain viewer build into `build`.

---

## Task 1: Share doc types

**Files:**
- Create: `src/main/shareTypes.ts`

- [ ] **Step 1: Write the types file**

```ts
// src/main/shareTypes.ts
//
// The on-disk shape written to shares/<id>.json in the user's axivale-shares
// repo, and rendered by the share-viewer SPA. Deliberately self-contained and
// redacted: raw tool inputs/results are NEVER included (see shareSanitize.ts).
// A byte-for-byte copy lives at src/share-viewer/shareTypes.ts because the
// viewer must not import from src/main — keep them in sync.

import type { DisplayPayload } from './providers/types'

export type ShareKind = 'conversation' | 'response'

/** A tool as shown in a share: name + optional visible rich card; no inputs/results. */
export interface SharedTool {
  name: string
  display?: DisplayPayload
}

export interface SharedTurn {
  /** Present for conversation shares; omitted for single-response shares. */
  userText?: string
  agentText: string
  filedAt: string
  tools: SharedTool[]
}

export interface ShareDoc {
  v: 1
  id: string
  kind: ShareKind
  title: string
  createdAt: string
  app: { name: string; version: string }
  turns: SharedTurn[]
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/main/shareTypes.ts
git commit -m "feat(share): add ShareDoc types"
```

---

## Task 2: Sanitizer (`buildSharePayload`)

**Files:**
- Create: `src/main/shareSanitize.ts`
- Test: `src/main/shareSanitize.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/shareSanitize.test.ts
import { describe, it, expect } from 'vitest'
import { buildSharePayload, deriveTitle } from './shareSanitize'
import type { Conversation } from './conversationStore'
import type { Turn } from './providers/types'

function turn(over: Partial<Turn> = {}): Turn {
  return {
    id: 1,
    userText: 'how many members?',
    agentText: '# Roster Report\n\nWe have 42 members.',
    tools: [
      {
        id: 't1',
        name: 'gw2_guild_members',
        input: { guildId: 'SECRET-GUILD', apiKey: 'SECRET' },
        resultText: '{"raw":"sensitive payload"}',
        display: { kind: 'table', data: { columns: [{ key: 'n', label: 'Name' }], rows: [] } }
      }
    ],
    done: true,
    error: null,
    filedAt: '3:45 PM',
    ...over
  }
}

function conv(over: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1',
    title: null,
    createdAt: '2026-06-13T00:00:00Z',
    updatedAt: '2026-06-13T00:00:00Z',
    turns: [turn()],
    provider: 'claude',
    session: {},
    seenTurnCount: 0,
    ...over
  }
}

const OPTS = { id: 'abc', createdAt: '2026-06-13T01:00:00Z', appVersion: '0.3.2' }

describe('buildSharePayload — conversation', () => {
  it('strips raw tool input and resultText but keeps name + display', () => {
    const doc = buildSharePayload(conv(), OPTS)
    expect(doc.kind).toBe('conversation')
    const tool = doc.turns[0].tools[0]
    expect(tool.name).toBe('gw2_guild_members')
    expect(tool.display).toBeDefined()
    expect(JSON.stringify(doc)).not.toContain('SECRET')
    expect(JSON.stringify(doc)).not.toContain('sensitive payload')
  })

  it('includes userText and copies stable metadata', () => {
    const doc = buildSharePayload(conv(), OPTS)
    expect(doc.turns[0].userText).toBe('how many members?')
    expect(doc).toMatchObject({ v: 1, id: 'abc', createdAt: '2026-06-13T01:00:00Z' })
    expect(doc.app).toEqual({ name: 'AxiVale', version: '0.3.2' })
  })

  it('uses conversation.title when set, else derives from first user line', () => {
    expect(buildSharePayload(conv({ title: 'My Title' }), OPTS).title).toBe('My Title')
    expect(buildSharePayload(conv(), OPTS).title).toBe('how many members?')
  })

  it('omits unfinished or errored turns', () => {
    const c = conv({ turns: [turn({ id: 1 }), turn({ id: 2, done: false }), turn({ id: 3, error: 'boom' })] })
    expect(buildSharePayload(c, OPTS).turns).toHaveLength(1)
  })

  it('drops errored tools', () => {
    const c = conv({ turns: [turn({ tools: [{ id: 'e', name: 'bad', input: {}, isError: true }] })] })
    expect(buildSharePayload(c, OPTS).turns[0].tools).toHaveLength(0)
  })
})

describe('buildSharePayload — response', () => {
  it('returns only the target turn, without userText', () => {
    const c = conv({ turns: [turn({ id: 1 }), turn({ id: 2, agentText: '# Second\n\nbody' })] })
    const doc = buildSharePayload(c, { ...OPTS, turnId: 2 })
    expect(doc.kind).toBe('response')
    expect(doc.turns).toHaveLength(1)
    expect(doc.turns[0].userText).toBeUndefined()
    expect(doc.title).toBe('Second')
  })

  it('throws when the turn id is missing', () => {
    expect(() => buildSharePayload(conv(), { ...OPTS, turnId: 999 })).toThrow(/not found/i)
  })
})

describe('deriveTitle', () => {
  it('strips leading markdown heading/bullet markers and takes the first non-empty line', () => {
    expect(deriveTitle('## Hello\n\nworld')).toBe('Hello')
    expect(deriveTitle('\n\n* bullet')).toBe('bullet')
    expect(deriveTitle('   ')).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/shareSanitize.test.ts --maxWorkers=2`
Expected: FAIL — `Cannot find module './shareSanitize'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/shareSanitize.ts
//
// Pure: turns a stored Conversation into a redacted ShareDoc. The only place
// the redaction rule lives — keep tool NAMES and visible display cards, drop
// raw tool `input` and `resultText` (they can carry API keys, guild ids, etc.).

import type { Conversation } from './conversationStore'
import type { Turn } from './providers/types'
import type { ShareDoc, SharedTurn } from './shareTypes'

export interface BuildShareOptions {
  id: string
  createdAt: string
  appVersion: string
  /** When set, share only this turn as a standalone kind:"response". */
  turnId?: number
}

/** First non-empty line, with a leading markdown heading/bullet marker removed. */
export function deriveTitle(text: string): string {
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/^\s*(#{1,6}|[-*])\s*/, '').trim()
    if (line) return line
  }
  return ''
}

function sanitizeTurn(turn: Turn, includeUser: boolean): SharedTurn {
  return {
    ...(includeUser ? { userText: turn.userText } : {}),
    agentText: turn.agentText,
    filedAt: turn.filedAt,
    tools: turn.tools
      .filter((t) => !t.isError)
      .map((t) => ({ name: t.name, ...(t.display ? { display: t.display } : {}) }))
  }
}

export function buildSharePayload(conv: Conversation, opts: BuildShareOptions): ShareDoc {
  const base = {
    v: 1 as const,
    id: opts.id,
    createdAt: opts.createdAt,
    app: { name: 'AxiVale', version: opts.appVersion }
  }

  if (opts.turnId !== undefined) {
    const target = conv.turns.find((t) => t.id === opts.turnId)
    if (!target) throw new Error('Response not found in conversation.')
    return {
      ...base,
      kind: 'response',
      title: deriveTitle(target.agentText) || 'AxiVale dispatch',
      turns: [sanitizeTurn(target, false)]
    }
  }

  const turns = conv.turns.filter((t) => t.done && !t.error)
  return {
    ...base,
    kind: 'conversation',
    title: conv.title?.trim() || deriveTitle(turns[0]?.userText ?? '') || 'AxiVale dispatch',
    turns: turns.map((t) => sanitizeTurn(t, true))
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/shareSanitize.test.ts --maxWorkers=2`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/main/shareSanitize.ts src/main/shareSanitize.test.ts
git commit -m "feat(share): sanitize conversations into redacted ShareDoc"
```

---

## Task 3: Share id generator

**Files:**
- Create: `src/main/shareId.ts`
- Test: `src/main/shareId.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/shareId.test.ts
import { describe, it, expect } from 'vitest'
import { makeShareId } from './shareId'

describe('makeShareId', () => {
  it('defaults to a 20-char base62 string', () => {
    const id = makeShareId()
    expect(id).toHaveLength(20)
    expect(id).toMatch(/^[0-9A-Za-z]+$/)
  })

  it('honors a custom length', () => {
    expect(makeShareId(8)).toHaveLength(8)
  })

  it('is effectively unique across many draws', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => makeShareId()))
    expect(seen.size).toBe(1000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/shareId.test.ts --maxWorkers=2`
Expected: FAIL — `Cannot find module './shareId'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/shareId.ts
import { randomBytes } from 'crypto'

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Unguessable URL-safe slug for a public share (base62, crypto RNG). */
export function makeShareId(len = 20): string {
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/shareId.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/shareId.ts src/main/shareId.test.ts
git commit -m "feat(share): unguessable share id generator"
```

---

## Task 4: GitHub share client

**Files:**
- Create: `src/main/shareGithub.ts`
- Test: `src/main/shareGithub.test.ts`

This module wraps the few GitHub REST calls publishing needs, behind the `GithubShareClient` interface that `sharePublisher.ts` (Task 6) will depend on. `owner` is resolved once via the authenticated user's login. Mirrors header/UA conventions in `githubRepos.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// src/main/shareGithub.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createGithubShareClient } from './shareGithub'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('createGithubShareClient', () => {
  it('login resolves the authenticated user and caches it', async () => {
    const fetchFn = vi.fn(async () => json({ login: 'alice' }))
    const gh = createGithubShareClient('TOKEN', fetchFn as unknown as typeof fetch)
    expect(await gh.login()).toBe('alice')
    expect(await gh.login()).toBe('alice')
    expect(fetchFn).toHaveBeenCalledTimes(1) // cached
  })

  it('ensureRepo creates the repo only when it does not exist', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/user') && !init) return json({ login: 'alice' })
      if (url.includes('/repos/alice/axivale-shares') && (!init || init.method === undefined))
        return json({ message: 'Not Found' }, 404)
      if (url.endsWith('/user/repos') && init?.method === 'POST') return json({}, 201)
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${url}`)
    })
    const gh = createGithubShareClient('TOKEN', fetchFn as unknown as typeof fetch)
    await gh.ensureRepo('axivale-shares')
    const createCall = fetchFn.mock.calls.find(([, i]) => (i as RequestInit)?.method === 'POST')
    expect(createCall).toBeTruthy()
    expect(JSON.parse((createCall![1] as RequestInit).body as string)).toMatchObject({
      name: 'axivale-shares',
      private: false,
      auto_init: true
    })
  })

  it('ensureRepo is a no-op when the repo already exists', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/user')) return json({ login: 'alice' })
      if (url.includes('/repos/alice/axivale-shares')) return json({ name: 'axivale-shares' }, 200)
      throw new Error(`unexpected ${url}`)
    })
    const gh = createGithubShareClient('TOKEN', fetchFn as unknown as typeof fetch)
    await gh.ensureRepo('axivale-shares')
    expect(fetchFn.mock.calls.some(([, i]) => (i as RequestInit)?.method === 'POST')).toBe(false)
  })

  it('getFileSha returns the sha or null on 404', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/user')) return json({ login: 'alice' })
      if (url.includes('/contents/exists')) return json({ sha: 'deadbeef' })
      return json({ message: 'Not Found' }, 404)
    })
    const gh = createGithubShareClient('TOKEN', fetchFn as unknown as typeof fetch)
    expect(await gh.getFileSha('axivale-shares', 'exists')).toBe('deadbeef')
    expect(await gh.getFileSha('axivale-shares', 'missing')).toBeNull()
  })

  it('putFile PUTs base64 content with sha when updating', async () => {
    const fetchFn = vi.fn(async () => json({}, 200))
    const gh = createGithubShareClient('TOKEN', fetchFn as unknown as typeof fetch)
    await gh.ensureRepoOwnerForTest?.('alice') // no-op if undefined
    await gh.putFile('axivale-shares', 'shares/x.json', 'YmFzZTY0', 'add x', 'oldsha')
    const call = fetchFn.mock.calls.at(-1)!
    expect((call[1] as RequestInit).method).toBe('PUT')
    const body = JSON.parse((call[1] as RequestInit).body as string)
    expect(body).toMatchObject({ content: 'YmFzZTY0', message: 'add x', sha: 'oldsha' })
  })

  it('enablePages swallows 409 already-enabled', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/user')) return json({ login: 'alice' })
      return json({ message: 'already exists' }, 409)
    })
    const gh = createGithubShareClient('TOKEN', fetchFn as unknown as typeof fetch)
    await expect(gh.enablePages('axivale-shares')).resolves.toBeUndefined()
  })

  it('pagesUrl returns html_url or null', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/user')) return json({ login: 'alice' })
      if (url.includes('/pages')) return json({ html_url: 'https://alice.github.io/axivale-shares/' })
      throw new Error('x')
    })
    const gh = createGithubShareClient('TOKEN', fetchFn as unknown as typeof fetch)
    expect(await gh.pagesUrl('axivale-shares')).toBe('https://alice.github.io/axivale-shares/')
  })
})
```

> Note: the `ensureRepoOwnerForTest?.` line above is intentionally an optional call that is `undefined` at runtime (a no-op) — it documents that `putFile` does not need a prior `ensureRepo`. Do not implement that method.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/shareGithub.test.ts --maxWorkers=2`
Expected: FAIL — `Cannot find module './shareGithub'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/shareGithub.ts
//
// Thin GitHub REST wrapper for publishing shares. Injectable fetch (no real
// network in tests). All operations target repos owned by the authenticated
// user; the login is resolved once and cached. Mirrors header conventions in
// githubRepos.ts.

import type { GithubShareClient } from './sharePublisher'

const GITHUB_API = 'https://api.github.com'
const UA = 'AxiVale'

function headers(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': UA,
    'X-GitHub-Api-Version': '2022-11-28'
  }
}

export function createGithubShareClient(
  token: string,
  fetchFn: typeof fetch = fetch
): GithubShareClient {
  if (!token) throw new Error('Sign in with GitHub first to share.')

  let cachedLogin: string | null = null
  async function login(): Promise<string> {
    if (cachedLogin) return cachedLogin
    const res = await fetchFn(`${GITHUB_API}/user`, { headers: headers(token) })
    if (res.status === 401) throw new Error('GitHub sign-in expired — sign in again.')
    if (!res.ok) throw new Error(`GitHub could not identify your account (${res.status}).`)
    const data = (await res.json()) as { login?: string }
    if (!data.login) throw new Error('GitHub did not return your login.')
    cachedLogin = data.login
    return cachedLogin
  }

  async function ensureRepo(repo: string): Promise<void> {
    const owner = await login()
    const probe = await fetchFn(`${GITHUB_API}/repos/${owner}/${repo}`, { headers: headers(token) })
    if (probe.ok) return
    if (probe.status !== 404) throw new Error(`GitHub could not check your repo (${probe.status}).`)
    const res = await fetchFn(`${GITHUB_API}/user/repos`, {
      method: 'POST',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: repo,
        private: false,
        auto_init: true,
        description: 'AxiVale shared dispatches'
      })
    })
    if (!res.ok) throw new Error(`GitHub could not create the share repo (${res.status}).`)
  }

  async function getFileSha(repo: string, path: string): Promise<string | null> {
    const owner = await login()
    const res = await fetchFn(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
      headers: headers(token)
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`GitHub could not read ${path} (${res.status}).`)
    const data = (await res.json()) as { sha?: string }
    return data.sha ?? null
  }

  async function getFileContent(repo: string, path: string): Promise<string | null> {
    const owner = await login()
    const res = await fetchFn(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
      headers: headers(token)
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`GitHub could not read ${path} (${res.status}).`)
    const data = (await res.json()) as { content?: string }
    if (!data.content) return null
    return Buffer.from(data.content, 'base64').toString('utf8')
  }

  async function putFile(
    repo: string,
    path: string,
    base64: string,
    message: string,
    sha?: string
  ): Promise<void> {
    const owner = await login()
    const res = await fetchFn(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: base64, ...(sha ? { sha } : {}) })
    })
    if (!res.ok) throw new Error(`GitHub could not write ${path} (${res.status}).`)
  }

  async function deleteFile(
    repo: string,
    path: string,
    message: string,
    sha: string
  ): Promise<void> {
    const owner = await login()
    const res = await fetchFn(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
      method: 'DELETE',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sha })
    })
    if (!res.ok) throw new Error(`GitHub could not delete ${path} (${res.status}).`)
  }

  async function enablePages(repo: string): Promise<void> {
    const owner = await login()
    const res = await fetchFn(`${GITHUB_API}/repos/${owner}/${repo}/pages`, {
      method: 'POST',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: { branch: 'main', path: '/' } })
    })
    if (res.ok || res.status === 409) return // 409 = already enabled
    throw new Error(`GitHub could not enable Pages (${res.status}).`)
  }

  async function pagesUrl(repo: string): Promise<string | null> {
    const owner = await login()
    const res = await fetchFn(`${GITHUB_API}/repos/${owner}/${repo}/pages`, {
      headers: headers(token)
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`GitHub could not read Pages config (${res.status}).`)
    const data = (await res.json()) as { html_url?: string }
    return data.html_url ?? null
  }

  return { login, ensureRepo, getFileSha, getFileContent, putFile, deleteFile, enablePages, pagesUrl }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/shareGithub.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/shareGithub.ts src/main/shareGithub.test.ts
git commit -m "feat(share): GitHub REST client for publishing shares"
```

---

## Task 5: Local share registry (`ShareStore`)

**Files:**
- Create: `src/main/shareStore.ts`
- Test: `src/main/shareStore.test.ts`

Mirrors `ConversationStore`: owns a JSON file, atomic tmp+rename, debounced writes, path-injected for tests.

- [ ] **Step 1: Write the failing test**

```ts
// src/main/shareStore.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ShareStore } from './shareStore'

let dir: string
let path: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sharestore-'))
  path = join(dir, 'shares.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const entry = {
  id: 'abc',
  kind: 'conversation' as const,
  title: 'Hello',
  url: 'https://alice.github.io/axivale-shares/#/s/abc',
  sourceConversationId: 'c1',
  createdAt: '2026-06-13T00:00:00Z'
}

describe('ShareStore', () => {
  it('starts empty and adds entries newest-first', () => {
    const s = new ShareStore(path)
    s.add(entry)
    s.add({ ...entry, id: 'def', createdAt: '2026-06-13T01:00:00Z' })
    expect(s.list().map((e) => e.id)).toEqual(['def', 'abc'])
  })

  it('persists across instances via flush', () => {
    const s = new ShareStore(path)
    s.add(entry)
    s.flush()
    expect(existsSync(path)).toBe(true)
    expect(new ShareStore(path).list().map((e) => e.id)).toEqual(['abc'])
  })

  it('get and remove work by id', () => {
    const s = new ShareStore(path)
    s.add(entry)
    expect(s.get('abc')?.title).toBe('Hello')
    s.remove('abc')
    expect(s.get('abc')).toBeNull()
    expect(s.list()).toHaveLength(0)
  })

  it('returns an empty list for a corrupt file', () => {
    const s = new ShareStore(path)
    s.add(entry)
    s.flush()
    require('fs').writeFileSync(path, 'not json')
    expect(new ShareStore(path).list()).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/shareStore.test.ts --maxWorkers=2`
Expected: FAIL — `Cannot find module './shareStore'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/shareStore.ts
//
// Owns userData/shares.json — the local registry of shares this user created,
// so the UI can list and delete them. Mirrors ConversationStore: atomic
// tmp+rename writes, debounced, path-injected for tests, corrupt-file safe.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import type { ShareKind } from './shareTypes'

export interface ShareEntry {
  id: string
  kind: ShareKind
  title: string
  url: string
  sourceConversationId: string
  createdAt: string
}

interface FileShape {
  shares: ShareEntry[]
}

const DEBOUNCE_MS = 300

export class ShareStore {
  private state: FileShape
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly path: string) {
    this.state = this.read()
  }

  private read(): FileShape {
    if (!existsSync(this.path)) return { shares: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<FileShape>
      return { shares: Array.isArray(parsed.shares) ? parsed.shares : [] }
    } catch {
      return { shares: [] }
    }
  }

  private scheduleWrite(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 })
    renameSync(tmp, this.path)
  }

  list(): ShareEntry[] {
    return [...this.state.shares].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  get(id: string): ShareEntry | null {
    return this.state.shares.find((s) => s.id === id) ?? null
  }

  add(entry: ShareEntry): void {
    this.state.shares.push(entry)
    this.scheduleWrite()
  }

  remove(id: string): void {
    this.state.shares = this.state.shares.filter((s) => s.id !== id)
    this.scheduleWrite()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/shareStore.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/shareStore.ts src/main/shareStore.test.ts
git commit -m "feat(share): local share registry store"
```

---

## Task 6: Publisher orchestration (`SharePublisher`)

**Files:**
- Create: `src/main/sharePublisher.ts`
- Test: `src/main/sharePublisher.test.ts`

`SharePublisher` ties everything together but stays testable by depending on the `GithubShareClient` interface (stubbed in tests) and a `ViewerBundle` value (no disk in tests). It defines both `GithubShareClient` and `ViewerBundle` so other modules import them from here.

- [ ] **Step 1: Write the failing test**

```ts
// src/main/sharePublisher.test.ts
import { describe, it, expect, vi } from 'vitest'
import { SharePublisher, type GithubShareClient, type ViewerBundle } from './sharePublisher'
import type { ShareDoc } from './shareTypes'

function stubClient(over: Partial<GithubShareClient> = {}): GithubShareClient {
  return {
    login: vi.fn(async () => 'alice'),
    ensureRepo: vi.fn(async () => {}),
    getFileSha: vi.fn(async () => null),
    getFileContent: vi.fn(async () => null),
    putFile: vi.fn(async () => {}),
    deleteFile: vi.fn(async () => {}),
    enablePages: vi.fn(async () => {}),
    pagesUrl: vi.fn(async () => 'https://alice.github.io/axivale-shares/'),
    ...over
  }
}

const VIEWER: ViewerBundle = {
  version: 'v1',
  files: [
    { path: 'index.html', base64: 'aHRtbA==' },
    { path: 'assets/app.js', base64: 'anM=' }
  ]
}

const DOC: ShareDoc = {
  v: 1,
  id: 'abc',
  kind: 'conversation',
  title: 'Hello',
  createdAt: '2026-06-13T00:00:00Z',
  app: { name: 'AxiVale', version: '0.3.2' },
  turns: []
}

describe('SharePublisher.publishDoc', () => {
  it('first run: creates repo, pushes viewer + marker, enables Pages, writes the doc', async () => {
    const client = stubClient()
    const pub = new SharePublisher({ client: () => client, viewer: () => VIEWER, repo: 'axivale-shares' })
    const res = await pub.publishDoc(DOC)

    expect(client.ensureRepo).toHaveBeenCalledWith('axivale-shares')
    // viewer files + marker pushed
    const written = (client.putFile as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1])
    expect(written).toContain('index.html')
    expect(written).toContain('assets/app.js')
    expect(written).toContain('viewer-version')
    expect(written).toContain('shares/abc.json')
    expect(client.enablePages).toHaveBeenCalledWith('axivale-shares')
    expect(res.url).toBe('https://alice.github.io/axivale-shares/#/s/abc')
  })

  it('skips viewer push when the marker already matches', async () => {
    const client = stubClient({ getFileContent: vi.fn(async (_r, p) => (p === 'viewer-version' ? 'v1' : null)) })
    const pub = new SharePublisher({ client: () => client, viewer: () => VIEWER, repo: 'axivale-shares' })
    await pub.publishDoc(DOC)
    const written = (client.putFile as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1])
    expect(written).not.toContain('index.html')
    expect(written).toContain('shares/abc.json')
  })

  it('passes the existing sha when overwriting a share doc', async () => {
    const client = stubClient({
      getFileContent: vi.fn(async () => 'v1'),
      getFileSha: vi.fn(async (_r, p) => (p === 'shares/abc.json' ? 'oldsha' : null))
    })
    const pub = new SharePublisher({ client: () => client, viewer: () => VIEWER, repo: 'axivale-shares' })
    await pub.publishDoc(DOC)
    const docCall = (client.putFile as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[1] === 'shares/abc.json')
    expect(docCall![4]).toBe('oldsha')
  })

  it('response shares get the right url', async () => {
    const client = stubClient({ getFileContent: vi.fn(async () => 'v1') })
    const pub = new SharePublisher({ client: () => client, viewer: () => VIEWER, repo: 'axivale-shares' })
    const res = await pub.publishDoc({ ...DOC, id: 'xyz', kind: 'response' })
    expect(res.url).toBe('https://alice.github.io/axivale-shares/#/s/xyz')
  })
})

describe('SharePublisher.deleteDoc', () => {
  it('deletes the doc file using its sha; no-op when already gone', async () => {
    const client = stubClient({ getFileSha: vi.fn(async () => 'sha1') })
    const pub = new SharePublisher({ client: () => client, viewer: () => VIEWER, repo: 'axivale-shares' })
    await pub.deleteDoc('abc')
    expect(client.deleteFile).toHaveBeenCalledWith('axivale-shares', 'shares/abc.json', expect.any(String), 'sha1')

    const gone = stubClient({ getFileSha: vi.fn(async () => null) })
    const pub2 = new SharePublisher({ client: () => gone, viewer: () => VIEWER, repo: 'axivale-shares' })
    await pub2.deleteDoc('abc')
    expect(gone.deleteFile).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/sharePublisher.test.ts --maxWorkers=2`
Expected: FAIL — `Cannot find module './sharePublisher'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/sharePublisher.ts
//
// Orchestrates publishing: ensure repo -> ensure viewer SPA present (push when
// the version marker differs) -> enable Pages -> write/delete shares/<id>.json.
// Depends on the GithubShareClient interface (stubbed in tests) and a
// ViewerBundle value (read from disk in production by shareViewerBundle.ts), so
// it needs neither real network nor real filesystem under test.

import type { ShareDoc } from './shareTypes'

export interface GithubShareClient {
  login(): Promise<string>
  ensureRepo(repo: string): Promise<void>
  getFileSha(repo: string, path: string): Promise<string | null>
  getFileContent(repo: string, path: string): Promise<string | null>
  putFile(repo: string, path: string, base64: string, message: string, sha?: string): Promise<void>
  deleteFile(repo: string, path: string, message: string, sha: string): Promise<void>
  enablePages(repo: string): Promise<void>
  pagesUrl(repo: string): Promise<string | null>
}

/** The built share-viewer static files + a content version marker. */
export interface ViewerBundle {
  version: string
  files: Array<{ path: string; base64: string }>
}

const MARKER = 'viewer-version'

export interface SharePublisherDeps {
  /** Build a client for the current GitHub token; throws if not signed in. */
  client: () => GithubShareClient
  /** Load the built viewer bundle (from disk in production). */
  viewer: () => ViewerBundle
  repo: string
}

export interface ShareStatus {
  signedIn: boolean
  repoReady: boolean
  pagesUrl: string | null
}

export class SharePublisher {
  constructor(private readonly deps: SharePublisherDeps) {}

  private async ensureViewer(client: GithubShareClient): Promise<void> {
    const bundle = this.deps.viewer()
    const current = await client.getFileContent(this.deps.repo, MARKER)
    if (current === bundle.version) return
    for (const file of bundle.files) {
      const sha = (await client.getFileSha(this.deps.repo, file.path)) ?? undefined
      await client.putFile(this.deps.repo, file.path, file.base64, `chore: publish share viewer`, sha)
    }
    const markerSha = (await client.getFileSha(this.deps.repo, MARKER)) ?? undefined
    await client.putFile(
      this.deps.repo,
      MARKER,
      Buffer.from(bundle.version, 'utf8').toString('base64'),
      'chore: record share viewer version',
      markerSha
    )
  }

  async publishDoc(doc: ShareDoc): Promise<{ url: string }> {
    const client = this.deps.client()
    const login = await client.login()
    await client.ensureRepo(this.deps.repo)
    await this.ensureViewer(client)
    await client.enablePages(this.deps.repo)

    const path = `shares/${doc.id}.json`
    const base64 = Buffer.from(JSON.stringify(doc), 'utf8').toString('base64')
    const sha = (await client.getFileSha(this.deps.repo, path)) ?? undefined
    await client.putFile(this.deps.repo, path, base64, `share: ${doc.id}`, sha)

    return { url: `https://${login}.github.io/${this.deps.repo}/#/s/${doc.id}` }
  }

  async deleteDoc(id: string): Promise<void> {
    const client = this.deps.client()
    const path = `shares/${id}.json`
    const sha = await client.getFileSha(this.deps.repo, path)
    if (!sha) return // already gone
    await client.deleteFile(this.deps.repo, path, `share: remove ${id}`, sha)
  }

  async status(): Promise<ShareStatus> {
    let client: GithubShareClient
    try {
      client = this.deps.client()
    } catch {
      return { signedIn: false, repoReady: false, pagesUrl: null }
    }
    try {
      const url = await client.pagesUrl(this.deps.repo)
      return { signedIn: true, repoReady: url !== null, pagesUrl: url }
    } catch {
      return { signedIn: true, repoReady: false, pagesUrl: null }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/sharePublisher.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/sharePublisher.ts src/main/sharePublisher.test.ts
git commit -m "feat(share): publisher orchestration"
```

---

## Task 7: Viewer bundle loader

**Files:**
- Create: `src/main/shareViewerBundle.ts`
- Test: `src/main/shareViewerBundle.test.ts`

Reads the built viewer files from `out/share-viewer` at runtime, base64-encodes them, and derives a content hash as the version marker.

- [ ] **Step 1: Write the failing test**

```ts
// src/main/shareViewerBundle.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadViewerBundle } from './shareViewerBundle'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'viewer-'))
  writeFileSync(join(dir, 'index.html'), '<html></html>')
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('loadViewerBundle', () => {
  it('collects all files with forward-slash relative paths and base64 content', () => {
    const bundle = loadViewerBundle(dir)
    const paths = bundle.files.map((f) => f.path).sort()
    expect(paths).toEqual(['assets/app.js', 'index.html'])
    const idx = bundle.files.find((f) => f.path === 'index.html')!
    expect(Buffer.from(idx.base64, 'base64').toString('utf8')).toBe('<html></html>')
  })

  it('version is stable for identical content and changes when content changes', () => {
    const v1 = loadViewerBundle(dir).version
    expect(loadViewerBundle(dir).version).toBe(v1)
    writeFileSync(join(dir, 'index.html'), '<html>changed</html>')
    expect(loadViewerBundle(dir).version).not.toBe(v1)
  })

  it('throws a clear error when the viewer was never built', () => {
    expect(() => loadViewerBundle(join(dir, 'missing'))).toThrow(/share viewer/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/shareViewerBundle.test.ts --maxWorkers=2`
Expected: FAIL — `Cannot find module './shareViewerBundle'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/shareViewerBundle.ts
//
// Reads the built share-viewer SPA (out/share-viewer) into a ViewerBundle for
// the publisher. The version marker is a content hash so the publisher re-pushes
// only when the viewer actually changes.

import { readdirSync, readFileSync, statSync, existsSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import type { ViewerBundle } from './sharePublisher'

function walk(dir: string, base = ''): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const rel = base ? `${base}/${name}` : name
    if (statSync(abs).isDirectory()) out.push(...walk(abs, rel))
    else out.push(rel)
  }
  return out
}

export function loadViewerBundle(dir: string): ViewerBundle {
  if (!existsSync(join(dir, 'index.html'))) {
    throw new Error(
      'Share viewer not built. Run `npm run build:viewer` (or `npm run build`) before sharing.'
    )
  }
  const relPaths = walk(dir).sort()
  const hash = createHash('sha256')
  const files = relPaths.map((rel) => {
    const buf = readFileSync(join(dir, rel))
    hash.update(rel)
    hash.update(buf)
    return { path: rel, base64: buf.toString('base64') }
  })
  return { version: hash.digest('hex').slice(0, 12), files }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/shareViewerBundle.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/shareViewerBundle.ts src/main/shareViewerBundle.test.ts
git commit -m "feat(share): load built viewer bundle from disk"
```

---

## Task 8: The share-viewer SPA

**Files:**
- Create: `src/share-viewer/shareTypes.ts`
- Create: `src/share-viewer/viewer.css`
- Create: `src/share-viewer/ShareApp.tsx`
- Create: `src/share-viewer/main.tsx`
- Create: `src/share-viewer/index.html`
- Create: `vite.viewer.config.ts`
- Modify: `package.json`

The viewer reuses AxiVale's existing rendering by importing from `src/renderer/src/components/*` (same markdown pipeline + `RichDisplay` + `theme.css`), so a shared page looks identical to the app. It must NOT import from `src/main` (renderer/main isolation), so the doc types are duplicated here.

- [ ] **Step 1: Copy the doc types (viewer-local)**

```ts
// src/share-viewer/shareTypes.ts
// Byte-for-byte copy of src/main/shareTypes.ts (the viewer must not import from
// src/main). The renderer already duplicates DisplayPayload in state.ts; reuse it.
import type { DisplayPayload } from '../renderer/src/state'

export type ShareKind = 'conversation' | 'response'
export interface SharedTool {
  name: string
  display?: DisplayPayload
}
export interface SharedTurn {
  userText?: string
  agentText: string
  filedAt: string
  tools: SharedTool[]
}
export interface ShareDoc {
  v: 1
  id: string
  kind: ShareKind
  title: string
  createdAt: string
  app: { name: string; version: string }
  turns: SharedTurn[]
}
```

- [ ] **Step 2: Write the viewer chrome CSS**

```css
/* src/share-viewer/viewer.css
   Centers the shared article(s) inside AxiVale's newspaper theme (theme.css is
   imported in main.tsx, supplying .msg.off / .lede / .byline / .prose etc.). */
body {
  margin: 0;
  background: var(--bg, #16171a);
  color: var(--ink, #e9e6df);
}
.share-page {
  max-width: 820px;
  margin: 0 auto;
  padding: 40px 24px 80px;
}
.share-masthead {
  text-align: center;
  border-bottom: 3px double var(--rule, #3a3a3a);
  padding-bottom: 12px;
  margin-bottom: 28px;
}
.share-masthead .title {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 40px;
  font-weight: 900;
  letter-spacing: 0.5px;
}
.share-masthead .dateline {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 2px;
  opacity: 0.7;
  margin-top: 6px;
}
.share-state {
  text-align: center;
  font-family: Georgia, serif;
  opacity: 0.8;
  padding: 80px 20px;
}
.share-footer {
  text-align: center;
  font-size: 12px;
  opacity: 0.6;
  margin-top: 40px;
}
```

- [ ] **Step 3: Write the viewer App**

```tsx
// src/share-viewer/ShareApp.tsx
//
// Standalone reader for a single share. Resolves the id from the hash route
// (#/s/<id>), fetches shares/<id>.json relative to the page, and renders each
// turn with the SAME markdown + figure pipeline AxiVale uses (imported from the
// renderer components), so it looks identical to the app.
import { Fragment, useEffect, useState, type ReactElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { rehypeEmojiIcons } from '../renderer/src/components/rehypeEmojiIcons'
import { renderEmojiSpan } from '../renderer/src/components/emojiIcons'
import { splitHeadline, stripMarkdown } from '../renderer/src/components/headline'
import { couponLabel } from '../renderer/src/components/ToolCoupon'
import RichDisplay from '../renderer/src/components/rich/RichDisplay'
import type { ShareDoc, SharedTurn } from './shareTypes'

function shareIdFromHash(): string | null {
  const m = window.location.hash.match(/^#\/s\/([0-9A-Za-z]+)/)
  return m ? m[1] : null
}

function docUrl(id: string): string {
  // Page lives at /<repo>/ (hash route); the doc sits next to it under shares/.
  const base = window.location.href.split('#')[0]
  return new URL(`shares/${id}.json`, base).toString()
}

function ArticleView({ turn }: { turn: SharedTurn }): ReactElement {
  const { headline, rest } = splitHeadline(turn.agentText)
  const figures = turn.tools.filter((t) => t.display)
  const segments = rest.split(/\{\{\s*figure\s*\}\}/i)
  const renderFigure = (t: (typeof figures)[number], key: number): ReactElement => (
    <figure className="post-figure" key={key}>
      <RichDisplay display={t.display!} />
      <figcaption>{couponLabel(t.name)}</figcaption>
    </figure>
  )
  return (
    <>
      {turn.userText && (
        <>
          <div className="msg user">
            <div className="kick">From the Commander&apos;s Desk</div>
            <div className="body">{turn.userText}</div>
          </div>
          <div className="rip">
            <span className="t"></span>
            <span className="lbl">AxiVale Reports</span>
            <span className="t"></span>
          </div>
        </>
      )}
      <div className="msg off" style={{ position: 'relative' }}>
        <div className="lede">{stripMarkdown(headline)}</div>
        <div className="byline">
          By <b>AxiVale</b> · filed {turn.filedAt} · {turn.tools.length} action
          {turn.tools.length === 1 ? '' : 's'} taken
        </div>
        <div className="prose">
          {segments.map((seg, i) => (
            <Fragment key={i}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeEmojiIcons]}
                components={{ span: renderEmojiSpan }}
              >
                {seg}
              </ReactMarkdown>
              {i < segments.length - 1 && figures[i] && renderFigure(figures[i], i)}
            </Fragment>
          ))}
          {figures.slice(Math.max(0, segments.length - 1)).map((t, i) => renderFigure(t, 1000 + i))}
          <span className="endmark"> ∎</span>
        </div>
      </div>
    </>
  )
}

export default function ShareApp(): ReactElement {
  const [doc, setDoc] = useState<ShareDoc | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const id = shareIdFromHash()
    if (!id) {
      setError('No share specified.')
      return
    }
    fetch(docUrl(id))
      .then((r) => {
        if (!r.ok) throw new Error('not found')
        return r.json()
      })
      .then((d: ShareDoc) => setDoc(d))
      .catch(() => setError('This share could not be found. It may have been deleted.'))
  }, [])

  if (error) return <div className="share-state">{error}</div>
  if (!doc) return <div className="share-state">Loading dispatch…</div>

  const dateline = new Date(doc.createdAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })

  return (
    <div className="share-page">
      <div className="share-masthead">
        <div className="title">AxiVale</div>
        <div className="dateline">Filed {dateline}</div>
      </div>
      {doc.turns.map((turn, i) => (
        <ArticleView key={i} turn={turn} />
      ))}
      <div className="share-footer">Shared from AxiVale · {doc.app.name} v{doc.app.version}</div>
    </div>
  )
}
```

- [ ] **Step 4: Write the entry point and HTML**

```tsx
// src/share-viewer/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../renderer/src/theme.css'
import '@axiapps/forge-render/forge-render.css'
import './viewer.css'
import ShareApp from './ShareApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShareApp />
  </StrictMode>
)
```

```html
<!-- src/share-viewer/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AxiVale — Shared Dispatch</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Write the viewer Vite config**

```ts
// vite.viewer.config.ts
// Standalone build for the public share-viewer SPA. Relative base so assets load
// under https://<user>.github.io/axivale-shares/. Output lands in out/share-viewer
// (packaged via the existing electron-builder `files: ["out/**/*"]`).
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/share-viewer',
  base: './',
  plugins: [react()],
  // forge-render ships ?raw SVG imports that esbuild pre-bundling chokes on
  // (same reason electron.vite.config.ts excludes it for the renderer).
  optimizeDeps: { exclude: ['@axiapps/forge-render'] },
  build: {
    outDir: '../../out/share-viewer',
    emptyOutDir: true
  }
})
```

- [ ] **Step 6: Wire build scripts in package.json**

In `package.json`, change the `build` script and add `build:viewer`. The viewer builds AFTER `electron-vite build` so it isn't wiped (each emits to its own `out/<sub>` dir):

```jsonc
// package.json "scripts" — change these two lines:
"build": "electron-vite build && vite build --config vite.viewer.config.ts",
"build:viewer": "vite build --config vite.viewer.config.ts",
```

- [ ] **Step 7: Build the viewer to verify it compiles**

Run: `npm run build:viewer`
Expected: completes; `out/share-viewer/index.html` and `out/share-viewer/assets/*` exist.

(If the forge-render `?raw` import errors, confirm `optimizeDeps.exclude` includes `@axiapps/forge-render` exactly as in the renderer config.)

- [ ] **Step 8: Typecheck the renderer project (now includes share-viewer)**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: PASS. If `src/share-viewer` is not covered by `tsconfig.web.json`'s `include`, add `"src/share-viewer"` to its `include` array so the viewer is typechecked with the renderer.

- [ ] **Step 9: Commit**

```bash
git add src/share-viewer vite.viewer.config.ts package.json tsconfig.web.json
git commit -m "feat(share): static share-viewer SPA reusing newspaper rendering"
```

---

## Task 9: IPC handlers + preload API

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: Add the preload bridge methods**

In `src/preload/index.ts`, add these inside the `exposeInMainWorld('officer', { ... })` object (e.g. after the `githubDiscoverRepos` line):

```ts
  shareConversation: (conversationId: string) =>
    ipcRenderer.invoke('share:createConversation', conversationId),
  shareResponse: (conversationId: string, turnId: number) =>
    ipcRenderer.invoke('share:createResponse', conversationId, turnId),
  shareList: () => ipcRenderer.invoke('share:list'),
  shareDelete: (id: string) => ipcRenderer.invoke('share:delete', id),
  shareStatus: () => ipcRenderer.invoke('share:status'),
```

- [ ] **Step 2: Add the OfficerApi types**

In `src/preload/index.d.ts`, add a `ShareListEntry` export and the five methods to `OfficerApi` (e.g. after `githubDiscoverRepos`):

```ts
export interface ShareListEntry {
  id: string
  kind: 'conversation' | 'response'
  title: string
  url: string
  sourceConversationId: string
  createdAt: string
}
```

```ts
  /** Publish a full conversation; returns its public URL. */
  shareConversation(conversationId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }>
  /** Publish a single AI response; returns its public URL. */
  shareResponse(conversationId: string, turnId: number): Promise<{ ok: true; url: string } | { ok: false; error: string }>
  shareList(): Promise<ShareListEntry[]>
  shareDelete(id: string): Promise<{ ok: boolean; error?: string }>
  shareStatus(): Promise<{ signedIn: boolean; repoReady: boolean; pagesUrl: string | null }>
```

- [ ] **Step 3: Wire main-process construction + handlers**

In `src/main/index.ts`:

(a) Add imports near the other store imports (after the `githubRepos` import on line 30):

```ts
import { ShareStore } from './shareStore'
import { SharePublisher } from './sharePublisher'
import { createGithubShareClient } from './shareGithub'
import { loadViewerBundle } from './shareViewerBundle'
import { buildSharePayload } from './shareSanitize'
import { makeShareId } from './shareId'
```

(b) After the `conversations` store is constructed (line ~94), add:

```ts
  const shares = new ShareStore(join(app.getPath('userData'), 'shares.json'))
  const SHARE_REPO = 'axivale-shares'
  // Built viewer ships in out/share-viewer; __dirname is out/main at runtime.
  const viewerDir = join(__dirname, '../share-viewer')
  const sharePublisher = new SharePublisher({
    client: () => createGithubShareClient(store.getActiveKey('github') ?? ''),
    viewer: () => loadViewerBundle(viewerDir),
    repo: SHARE_REPO
  })
```

(c) Add the handlers near the other `ipcMain.handle` calls (e.g. after the `github:discover-repos` handler ~line 343). Use the app version via `app.getVersion()`:

```ts
  ipcMain.handle('share:createConversation', async (_event, conversationId: string) => {
    try {
      const conv = conversations.get(conversationId)
      if (!conv) return { ok: false as const, error: 'Conversation not found.' }
      const id = makeShareId()
      const doc = buildSharePayload(conv, {
        id,
        createdAt: new Date().toISOString(),
        appVersion: app.getVersion()
      })
      const { url } = await sharePublisher.publishDoc(doc)
      shares.add({
        id,
        kind: 'conversation',
        title: doc.title,
        url,
        sourceConversationId: conversationId,
        createdAt: doc.createdAt
      })
      return { ok: true as const, url }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : 'Share failed.' }
    }
  })

  ipcMain.handle('share:createResponse', async (_event, conversationId: string, turnId: number) => {
    try {
      const conv = conversations.get(conversationId)
      if (!conv) return { ok: false as const, error: 'Conversation not found.' }
      const id = makeShareId()
      const doc = buildSharePayload(conv, {
        id,
        createdAt: new Date().toISOString(),
        appVersion: app.getVersion(),
        turnId
      })
      const { url } = await sharePublisher.publishDoc(doc)
      shares.add({
        id,
        kind: 'response',
        title: doc.title,
        url,
        sourceConversationId: conversationId,
        createdAt: doc.createdAt
      })
      return { ok: true as const, url }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : 'Share failed.' }
    }
  })

  ipcMain.handle('share:list', () => shares.list())

  ipcMain.handle('share:delete', async (_event, id: string) => {
    try {
      await sharePublisher.deleteDoc(id)
      shares.remove(id)
      return { ok: true as const }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : 'Delete failed.' }
    }
  })

  ipcMain.handle('share:status', () => sharePublisher.status())
```

- [ ] **Step 4: Typecheck both projects**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json`
Expected: PASS.

- [ ] **Step 5: Run the full main test suite (nothing regressed)**

Run: `npx vitest run src/main --maxWorkers=2`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(share): IPC handlers and preload API for sharing"
```

---

## Task 10: Share dialog component

**Files:**
- Create: `src/renderer/src/components/ShareDialog.tsx`
- Test: `src/renderer/src/components/ShareDialog.test.tsx`

A presentational dialog driven by a `ShareState` union (the publish lifecycle). It does not call IPC itself — App owns the calls (Task 12) — keeping it pure and easy to test.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// src/renderer/src/components/ShareDialog.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ShareDialog, { type ShareState } from './ShareDialog'

describe('ShareDialog', () => {
  it('renders nothing when idle', () => {
    const { container } = render(<ShareDialog state={{ status: 'idle' }} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows a publishing message', () => {
    render(<ShareDialog state={{ status: 'publishing' }} onClose={() => {}} />)
    expect(screen.getByText(/publishing/i)).toBeTruthy()
  })

  it('shows the url and copies it on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const state: ShareState = { status: 'done', url: 'https://x.github.io/axivale-shares/#/s/abc' }
    render(<ShareDialog state={state} onClose={() => {}} />)
    expect(screen.getByDisplayValue(state.url!)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }))
    expect(writeText).toHaveBeenCalledWith(state.url)
  })

  it('shows an error and a close button', () => {
    const onClose = vi.fn()
    render(<ShareDialog state={{ status: 'error', error: 'nope' }} onClose={onClose} />)
    expect(screen.getByText('nope')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/ShareDialog.test.tsx --maxWorkers=2`
Expected: FAIL — `Cannot find module './ShareDialog'`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/renderer/src/components/ShareDialog.tsx
import { useState, type ReactElement } from 'react'

export type ShareState =
  | { status: 'idle' }
  | { status: 'publishing' }
  | { status: 'done'; url: string }
  | { status: 'error'; error: string }

export default function ShareDialog({
  state,
  onClose
}: {
  state: ShareState
  onClose: () => void
}): ReactElement | null {
  const [copied, setCopied] = useState(false)
  if (state.status === 'idle') return null

  function copy(url: string): void {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="share-overlay" onClick={onClose}>
      <div className="share-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="kick">AxiVale Press</div>
        {state.status === 'publishing' && (
          <div className="share-dialog-body">Publishing… your link will be live shortly.</div>
        )}
        {state.status === 'done' && (
          <div className="share-dialog-body">
            <div className="h">Filed for the public record</div>
            <div className="share-url-row">
              <input className="share-url" readOnly value={state.url} onFocus={(e) => e.target.select()} />
              <button className="folio-act" onClick={() => copy(state.url)}>
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </div>
        )}
        {state.status === 'error' && (
          <div className="share-dialog-body">
            <div className="h">Could not file this share</div>
            <div className="errnotice">{state.error}</div>
          </div>
        )}
        <div className="share-dialog-acts">
          <button className="folio-act" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/ShareDialog.test.tsx --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ShareDialog.tsx src/renderer/src/components/ShareDialog.test.tsx
git commit -m "feat(share): ShareDialog component"
```

---

## Task 11: Share-response button in Article

**Files:**
- Modify: `src/renderer/src/components/Article.tsx`

Add a `Share2` hover button next to the existing camera button, plus `conversationId` + `onShare` props. The button calls `onShare` only when `turn.done`.

- [ ] **Step 1: Update the import line for the icon**

Change line 4 of `src/renderer/src/components/Article.tsx`:

```ts
import { Camera, Check, X, Share2 } from 'lucide-react'
```

- [ ] **Step 2: Update the component signature**

Change the function signature (line 76):

```tsx
export default function Article({
  turn,
  conversationId,
  onShare
}: {
  turn: Turn
  conversationId: string | null
  onShare?: (conversationId: string, turnId: number) => void
}): ReactElement {
```

- [ ] **Step 3: Add the share button next to the camera button**

Immediately after the closing `</button>` of the existing `clip-img-btn` block (after line 125, inside the `{turn.done && (...)}` region — wrap both buttons in a fragment if needed), add:

```tsx
              {onShare && conversationId && (
                <button
                  className="share-msg-btn"
                  data-copy-btn="1"
                  onClick={() => onShare(conversationId, turn.id)}
                  aria-label="Share this response"
                  title="Share this response"
                >
                  <Share2 size={12} />
                </button>
              )}
```

Note: `data-copy-btn="1"` makes the screenshot capture exclude this button too (the existing `filter` in `copyArticleAsImage` drops elements with that attribute).

If the existing camera button is the sole child of `{turn.done && (...)}`, wrap the camera button and this new button together:

```tsx
            {turn.done && (
              <>
                {/* existing clip-img-btn button unchanged */}
                {/* new share-msg-btn button here */}
              </>
            )}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: PASS. (App.tsx will be updated in Task 12 to pass the new props; until then TS may flag the missing required `conversationId` prop at the `<Article>` call site — that's expected and fixed in Task 12. If you want a green typecheck now, do Task 12 before re-running.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Article.tsx
git commit -m "feat(share): share-response hover button in Article"
```

---

## Task 12: Wire share state + handlers in App

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add imports**

Add near the other component imports (after the `Article` import on line 11):

```ts
import ShareDialog, { type ShareState } from './components/ShareDialog'
```

- [ ] **Step 2: Add share state + handlers**

Inside the `App` component body (near other `useState` declarations), add:

```ts
  const [shareState, setShareState] = useState<ShareState>({ status: 'idle' })

  async function shareResponse(conversationId: string, turnId: number): Promise<void> {
    setShareState({ status: 'publishing' })
    const res = await window.officer.shareResponse(conversationId, turnId)
    setShareState(res.ok ? { status: 'done', url: res.url } : { status: 'error', error: res.error })
  }

  async function shareConversation(conversationId: string): Promise<void> {
    setShareState({ status: 'publishing' })
    const res = await window.officer.shareConversation(conversationId)
    setShareState(res.ok ? { status: 'done', url: res.url } : { status: 'error', error: res.error })
  }
```

- [ ] **Step 3: Pass props to Article**

Change the `Article` render (line ~401) to pass the new props:

```tsx
                turns.map((turn) => (
                  <Article
                    key={turn.id}
                    turn={turn}
                    conversationId={activeId}
                    onShare={(cid, tid) => void shareResponse(cid, tid)}
                  />
                ))
```

- [ ] **Step 4: Pass the conversation-share handler to Editions**

Add an `onShare` prop to the `<Editions ... />` element (after `onDelete`):

```tsx
          onShare={(id) => void shareConversation(id)}
```

- [ ] **Step 5: Render the dialog**

Just before the final closing tag of the App's returned JSX (e.g. after the `</div>` that closes `.sheet`, alongside the other top-level overlays), add:

```tsx
      <ShareDialog state={shareState} onClose={() => setShareState({ status: 'idle' })} />
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: PASS (Editions `onShare` is added in Task 13; if TS flags an unknown prop on `Editions`, do Task 13 next, then re-run — or add the prop to `EditionsProps` first).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(share): wire share handlers and dialog in App"
```

---

## Task 13: Share-conversation action in Editions

**Files:**
- Modify: `src/renderer/src/components/Editions.tsx`

- [ ] **Step 1: Add `onShare` to the props interfaces**

In `EditionsProps` (line ~14), add:

```ts
  onShare: (id: string) => void
```

In the `Row` component's prop type (line ~54) and destructuring, add `onShare: (id: string) => void` / `onShare`.

- [ ] **Step 2: Add a share handler in Row**

Inside `Row`, next to `remove` (line ~91), add:

```tsx
  function share(e: React.MouseEvent): void {
    e.stopPropagation()
    onShare(item.id)
  }
```

- [ ] **Step 3: Add the share button to the row actions**

In the `.ed-acts` block (line ~123), add a button before the delete button:

```tsx
        <button title="Share conversation" onClick={share}>
          ↗
        </button>
```

- [ ] **Step 4: Pass `onShare` down to each `Row`**

In the `Editions` component, add `onShare` to the destructured props (line ~135) and pass it to both `<Row ... />` usages:

```tsx
          onShare={onShare}
```

- [ ] **Step 5: Typecheck + run renderer tests**

Run: `npx tsc --noEmit -p tsconfig.web.json && npx vitest run src/renderer --maxWorkers=2`
Expected: PASS. (If `App.test.tsx`'s officer mock now misses `share*` methods and a test exercises them, add the five `share*` mocks returning resolved defaults — `shareList: vi.fn().mockResolvedValue([])`, etc. The app constructor does not call them, so this is only needed if a test does.)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/Editions.tsx
git commit -m "feat(share): share-conversation action in Editions"
```

---

## Task 14: Shared-shares management list in Settings

**Files:**
- Modify: `src/renderer/src/components/Settings.tsx`

Add a "Shared" section listing active shares with open + delete. Follow the existing Settings section structure (read the file's section markup, e.g. the AxiBridge repos list, and mirror its classes).

- [ ] **Step 1: Add state + loaders**

Near the other `useState`/loader functions in `Settings` (after the GitHub state ~line 174), add:

```ts
  const [shareEntries, setShareEntries] = useState<
    Array<{ id: string; kind: string; title: string; url: string; createdAt: string }>
  >([])

  async function refreshShares(): Promise<void> {
    setShareEntries(await window.officer.shareList())
  }

  async function deleteShare(id: string): Promise<void> {
    if (!window.confirm('Delete this share? The public link will stop working.')) return
    const res = await window.officer.shareDelete(id)
    if (res.ok) await refreshShares()
    else window.alert(res.error ?? 'Could not delete the share.')
  }
```

- [ ] **Step 2: Load shares on mount**

Find the existing mount `useEffect` that calls the other refresh functions (e.g. `refreshKeyLists`) and add `void refreshShares()` to it. If there is no suitable combined effect, add:

```ts
  useEffect(() => {
    void refreshShares()
  }, [])
```

(Match the file's existing import of `useEffect`; it is already imported if other effects exist.)

- [ ] **Step 3: Render the section**

Add a new section in the returned JSX, mirroring the surrounding section markup (use the same wrapper classes the file already uses for a settings group — e.g. `<section className="set-group">` or whatever the file uses; check an adjacent section):

```tsx
      <section className="set-group">
        <div className="set-h">Shared dispatches</div>
        <div className="set-note">
          Public links you have published to your GitHub Pages share site. Deleting one removes it
          from the web.
        </div>
        {shareEntries.length === 0 ? (
          <div className="set-empty">You haven&apos;t shared anything yet.</div>
        ) : (
          <ul className="share-list">
            {shareEntries.map((s) => (
              <li key={s.id} className="share-list-row">
                <div className="share-list-meta">
                  <span className="share-list-title">{s.title || 'Untitled'}</span>
                  <span className="share-list-kind">{s.kind}</span>
                </div>
                <div className="share-list-acts">
                  <a className="folio-act" href={s.url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                  <button className="folio-act" onClick={() => void deleteShare(s.id)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Settings.tsx
git commit -m "feat(share): manage and delete shares in Settings"
```

---

## Task 15: Styles

**Files:**
- Modify: `src/renderer/src/theme.css`

Add styles for the share button (mirroring `.clip-img-btn`), the dialog overlay, and the settings list. First read `.clip-img-btn` in `theme.css` to match positioning, then add the rules below at the end of the file.

- [ ] **Step 1: Add the CSS**

```css
/* ---- Share controls ---- */
/* Sits left of the camera button; mirror .clip-img-btn sizing/positioning.
   Adjust `right` to clear the camera button per the existing .clip-img-btn rule. */
.share-msg-btn {
  position: absolute;
  top: 0;
  right: 22px;
  width: 12px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--muted, #8a8a8a);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
}
.msg.off:hover .share-msg-btn {
  opacity: 1;
}
.share-msg-btn:hover {
  color: var(--accent, #c9a86a);
}

/* Editions row share button uses the existing .ed-acts button styling — no new
   rule needed beyond what .ed-acts button already provides. */

/* ---- Share dialog ---- */
.share-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.share-dialog {
  background: var(--paper, #1d1e22);
  border: 1px solid var(--rule, #3a3a3a);
  border-radius: 4px;
  padding: 22px 26px;
  width: min(560px, 90vw);
  font-family: Georgia, serif;
}
.share-dialog .kick {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 2px;
  opacity: 0.7;
  margin-bottom: 8px;
}
.share-dialog .h {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 12px;
}
.share-dialog-body {
  margin-bottom: 16px;
}
.share-url-row {
  display: flex;
  gap: 8px;
}
.share-url {
  flex: 1;
  background: var(--bg, #16171a);
  border: 1px solid var(--rule, #3a3a3a);
  color: var(--ink, #e9e6df);
  padding: 8px 10px;
  border-radius: 3px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.share-dialog-acts {
  display: flex;
  justify-content: flex-end;
}

/* ---- Shared list in Settings ---- */
.share-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}
.share-list-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--rule, #3a3a3a);
}
.share-list-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.share-list-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 360px;
}
.share-list-kind {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
  opacity: 0.6;
}
.share-list-acts {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
```

- [ ] **Step 2: Verify the app still builds**

Run: `npm run build`
Expected: completes (electron-vite build + viewer build), no CSS/TS errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/theme.css
git commit -m "style(share): share button, dialog, and settings list styles"
```

---

## Task 16: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the entire test suite**

Run: `npx vitest run --maxWorkers=2`
Expected: PASS (all suites, including the new share tests).

- [ ] **Step 2: Typecheck both projects**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Build everything**

Run: `npm run build`
Expected: `out/main`, `out/preload`, `out/renderer`, and `out/share-viewer` all produced.

- [ ] **Step 4: Manual smoke test (requires a GitHub account)**

Run: `npm run dev`, then in the app:
1. Sign in with GitHub (Settings) if not already.
2. Hover an AI response → click the share (↗) button → dialog shows "publishing" then a URL. Open it; it should render as a newspaper article. (First publish: the Pages build can take ~30–60s before the URL serves; refresh after a moment.)
3. Hover a conversation in Editions → share → open the URL → full transcript renders.
4. Open the shared URL and confirm no raw tool inputs/results/API keys appear in the page or its `shares/<id>.json`.
5. Settings → Shared dispatches → Delete one → confirm the link 404s after the next Pages build.

- [ ] **Step 5: Final commit (if any docs/notes changed)**

```bash
git add -A
git commit -m "chore(share): verification pass" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage:** repo strategy (Task 4/6), public-by-obscurity slug (Task 3), sanitization keep/strip rule (Task 2), conversation vs response granularity (Task 2/11/13), newspaper viewer reuse (Task 8), data model (Task 1), main modules (Tasks 2–7), IPC/preload (Task 9), renderer UI placement — response button (11), conversation action (13), dialog (10/12), manage+delete (14), error handling (handlers in 9 + dialog states in 10), first-Pages-build latency message (10/16), testing (each task) — all mapped.
- **Type consistency:** `ShareDoc`/`SharedTurn`/`SharedTool` defined once (Task 1), re-declared verbatim for the viewer (Task 8) with a sync note; `GithubShareClient`/`ViewerBundle` defined in `sharePublisher.ts` (Task 6) and imported by `shareGithub.ts` (Task 4) and `shareViewerBundle.ts` (Task 7); `ShareEntry` (store) vs `ShareListEntry` (preload) intentionally mirror each other across the IPC boundary; `ShareState` defined in `ShareDialog.tsx` (Task 10) and imported by App (Task 12).
- **Cross-task prop threading:** Article props (Task 11) are satisfied by App (Task 12); Editions `onShare` (Task 13) by App (Task 12) — the plan flags the transient typecheck states and the order to resolve them.

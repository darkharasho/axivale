# Editions — Multi-Conversation History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep all past conversations and let several run at once, presented as a newspaper "Editions" feed that replaces the old static left rail, with background-completion ("Hot off the press") markers.
**Working directory:** /var/home/mstephens/Documents/GitHub/axivale
**Architecture:** A new main-process `ConversationStore` owns `userData/conversations.json` (atomic + debounced, mirrors the `SettingsStore` pattern). `AgentService` becomes conversation-aware, holding one live `ProviderAdapter` per conversation id and persisting each adapter's serialized session through an injected callback. New IPC channels (`conversations:*`) expose the store; the `agent:event` payload gains a `conversationId`. The renderer replaces `LeftRail` with an `Editions` component and `App.tsx` tracks `conversations` + `activeId` + the active conversation's turns, migrating the legacy `localStorage['axivale.turns']` once.
**Tech Stack:** Electron + React + TypeScript, electron-vite, vitest (--maxWorkers=2)
---

## File Structure

**Created**
- `src/main/conversationStore.ts` — `Conversation` type + `ConversationStore` (atomic/debounced JSON persistence of all conversations, active id, seen counts).
- `src/main/conversationStore.test.ts` — CRUD, atomic write, debounce flush, corrupt-file tolerance, active-id, markSeen.
- `src/renderer/src/components/Editions.tsx` — the left-rail Editions feed (header, New dispatch, search, date-grouped rows, rename, delete, active state, hot-off-the-press marker).
- `src/renderer/src/components/Editions.test.tsx` — grouping, search, rename, delete, active fallback wiring, fresh marker.

**Modified**
- `src/main/providers/types.ts` — add `SessionState` type + `serializeSession()`/`restoreSession()` to `ProviderAdapter`; `AgentEvent` is unchanged here (conversationId is added only in the IPC envelope).
- `src/main/providers/claude.ts` — implement `serializeSession`/`restoreSession` over `sessionId`.
- `src/main/providers/openaiCompat.ts` — implement `serializeSession`/`restoreSession` over `history`.
- `src/main/providers/gemini.ts` — implement `serializeSession`/`restoreSession` over `history` (and `callSeq`).
- `src/main/providers/claude.test.ts`, `openaiCompat.test.ts`, `gemini.test.ts` — round-trip tests (created if absent).
- `src/main/agent.ts` — `runTurn(conversationId, prompt, onEvent)`; per-conversation adapter `Map`; per-conversation running `Set`; restore-from / persist-on-done via injected deps.
- `src/main/agent.test.ts` — update existing serialization test to the new signature; add per-conversation guard + persistence tests.
- `src/main/index.ts` — construct `ConversationStore`; wire `conversations:*` IPC; pass session getter + persist callback into `AgentService`; change `agent:send` to take `conversationId` and forward it on `agent:event`.
- `src/preload/index.ts` + `src/preload/index.d.ts` — `conversations*` wrappers + types; `sendMessage(conversationId, text)`.
- `src/renderer/src/App.tsx` — conversations/activeId/turns state, store load, localStorage migration, new dispatch, switching + mark-seen, conversation-scoped submit + save-turns, fresh-edition tracking, render `Editions`.
- `src/renderer/src/components/Rails.tsx` — remove `LeftRail` (keep `RightRail`); narrow `RailsProps` consumers.
- `src/renderer/src/App.test.tsx` — extend `makeOfficer` mock with the new `conversations*` methods and `sendMessage(id, text)` signature.

---

## Task 1 — ConversationStore (main process)

**Files:**
- Create `src/main/conversationStore.ts`
- Create `src/main/conversationStore.test.ts`
- Reference (pattern source): `src/main/secrets.ts` lines 76-98 (atomic-ish write), `src/main/secrets.test.ts` lines 1-15 (temp-dir setup)

The store mirrors `SettingsStore`: constructor takes the file path (injectable for tests). Writes are atomic (tmp file + rename) and debounced; a `flush()` forces a synchronous write (used by tests and before shutdown). Corrupt/missing file → empty state, never throws.

- [ ] Write the failing test file `src/main/conversationStore.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ConversationStore, type Conversation } from './conversationStore'
import type { Turn } from '../renderer/src/state'

function makePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'axivale-conv-'))
  return join(dir, 'conversations.json')
}

function turn(id: number, userText: string, agentText = '', done = true): Turn {
  return { id, userText, agentText, tools: [], done, error: null, filedAt: '12:00' }
}

describe('ConversationStore', () => {
  it('starts empty for a missing file', () => {
    const store = new ConversationStore(makePath())
    expect(store.list()).toEqual([])
    expect(store.getActiveId()).toBeNull()
  })

  it('creates a conversation with defaults and returns it', () => {
    const store = new ConversationStore(makePath())
    const conv = store.create()
    expect(conv.id).toBeTruthy()
    expect(conv.title).toBeNull()
    expect(conv.turns).toEqual([])
    expect(conv.provider).toBe('claude')
    expect(conv.session).toEqual({})
    expect(conv.seenTurnCount).toBe(0)
    expect(store.list()).toHaveLength(1)
    expect(store.get(conv.id)).toMatchObject({ id: conv.id })
  })

  it('honours a seed on create', () => {
    const store = new ConversationStore(makePath())
    const conv = store.create({ provider: 'openai', turns: [turn(1, 'hi')] })
    expect(conv.provider).toBe('openai')
    expect(conv.turns).toHaveLength(1)
  })

  it('saves turns and bumps updatedAt', () => {
    const store = new ConversationStore(makePath())
    const conv = store.create()
    const before = store.get(conv.id)!.updatedAt
    store.saveTurns(conv.id, [turn(1, 'hello', 'hi there')])
    const after = store.get(conv.id)!
    expect(after.turns).toHaveLength(1)
    expect(after.updatedAt >= before).toBe(true)
  })

  it('saves a provider session', () => {
    const store = new ConversationStore(makePath())
    const conv = store.create()
    store.saveSession(conv.id, 'claude', { claudeSessionId: 'sess-1' })
    expect(store.get(conv.id)!.session).toEqual({ claudeSessionId: 'sess-1' })
    expect(store.get(conv.id)!.provider).toBe('claude')
  })

  it('renames and removes', () => {
    const store = new ConversationStore(makePath())
    const a = store.create()
    const b = store.create()
    store.rename(a.id, 'Weekly muster')
    expect(store.get(a.id)!.title).toBe('Weekly muster')
    store.remove(b.id)
    expect(store.list().map((c) => c.id)).toEqual([a.id])
  })

  it('tracks the active id and markSeen', () => {
    const store = new ConversationStore(makePath())
    const a = store.create()
    store.setActive(a.id)
    expect(store.getActiveId()).toBe(a.id)
    store.markSeen(a.id, 3)
    expect(store.get(a.id)!.seenTurnCount).toBe(3)
  })

  it('persists across instances after flush', () => {
    const path = makePath()
    const s1 = new ConversationStore(path)
    const conv = s1.create({ turns: [turn(1, 'q', 'a')] })
    s1.rename(conv.id, 'Filed')
    s1.setActive(conv.id)
    s1.flush()
    const s2 = new ConversationStore(path)
    expect(s2.list()).toHaveLength(1)
    expect(s2.get(conv.id)!.title).toBe('Filed')
    expect(s2.getActiveId()).toBe(conv.id)
  })

  it('debounces writes but flush forces them to disk', () => {
    const path = makePath()
    const store = new ConversationStore(path)
    store.create()
    // Debounced — nothing on disk yet.
    expect(existsSync(path)).toBe(false)
    store.flush()
    expect(existsSync(path)).toBe(true)
  })

  it('tolerates a corrupt file', () => {
    const path = makePath()
    writeFileSync(path, '{ this is not json')
    const store = new ConversationStore(path)
    expect(store.list()).toEqual([])
    // A subsequent write recreates a valid file.
    store.create()
    store.flush()
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    expect(Array.isArray(parsed.conversations)).toBe(true)
  })

  it('list() returns newest-updated first', () => {
    const store = new ConversationStore(makePath())
    const a = store.create()
    const b = store.create()
    store.saveTurns(a.id, [turn(1, 'newer')])
    expect(store.list()[0].id).toBe(a.id)
    expect(store.list()[1].id).toBe(b.id)
  })
})
```

- [ ] Run expecting failure: `npx vitest run src/main/conversationStore.test.ts --maxWorkers=2`
  Expected: `Failed to resolve import "./conversationStore"` (module does not exist yet).

- [ ] Create `src/main/conversationStore.ts` with the minimal implementation:

```ts
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'
import type { ProviderName } from './providers/types'
import type { SessionState } from './providers/types'
import type { Turn } from '../renderer/src/state'

export interface Conversation {
  id: string
  title: string | null
  createdAt: string
  updatedAt: string
  turns: Turn[]
  provider: ProviderName
  session: SessionState
  seenTurnCount: number
}

interface FileShape {
  conversations: Conversation[]
  activeId: string | null
}

/** Fields a caller may seed into a new conversation. */
export type ConversationSeed = Partial<
  Pick<Conversation, 'title' | 'turns' | 'provider' | 'session' | 'seenTurnCount'>
>

const DEBOUNCE_MS = 300

/**
 * Owns userData/conversations.json. Mirrors SettingsStore's path-injection so
 * it is unit-testable against a temp file. Writes are atomic (tmp + rename)
 * and debounced; flush() forces a synchronous write. A corrupt or missing
 * file yields an empty list — never throws.
 */
export class ConversationStore {
  private state: FileShape
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly path: string) {
    this.state = this.read()
  }

  private read(): FileShape {
    if (!existsSync(this.path)) return { conversations: [], activeId: null }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<FileShape>
      return {
        conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
        activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null
      }
    } catch {
      return { conversations: [], activeId: null }
    }
  }

  private scheduleWrite(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS)
  }

  /** Force the pending write to disk now (atomic tmp + rename). */
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

  list(): Conversation[] {
    return [...this.state.conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  get(id: string): Conversation | null {
    return this.state.conversations.find((c) => c.id === id) ?? null
  }

  create(seed: ConversationSeed = {}): Conversation {
    const now = new Date().toISOString()
    const conv: Conversation = {
      id: randomUUID(),
      title: seed.title ?? null,
      createdAt: now,
      updatedAt: now,
      turns: seed.turns ?? [],
      provider: seed.provider ?? 'claude',
      session: seed.session ?? {},
      seenTurnCount: seed.seenTurnCount ?? 0
    }
    this.state.conversations.push(conv)
    this.scheduleWrite()
    return conv
  }

  saveTurns(id: string, turns: Turn[]): void {
    const conv = this.get(id)
    if (!conv) return
    conv.turns = turns
    conv.updatedAt = new Date().toISOString()
    this.scheduleWrite()
  }

  saveSession(id: string, provider: ProviderName, session: SessionState): void {
    const conv = this.get(id)
    if (!conv) return
    conv.provider = provider
    conv.session = session
    this.scheduleWrite()
  }

  rename(id: string, title: string | null): void {
    const conv = this.get(id)
    if (!conv) return
    conv.title = title
    conv.updatedAt = new Date().toISOString()
    this.scheduleWrite()
  }

  remove(id: string): void {
    this.state.conversations = this.state.conversations.filter((c) => c.id !== id)
    if (this.state.activeId === id) this.state.activeId = null
    this.scheduleWrite()
  }

  setActive(id: string): void {
    this.state.activeId = id
    this.scheduleWrite()
  }

  getActiveId(): string | null {
    return this.state.activeId
  }

  markSeen(id: string, count: number): void {
    const conv = this.get(id)
    if (!conv) return
    conv.seenTurnCount = count
    this.scheduleWrite()
  }
}
```

> NOTE: `SessionState` is defined in Task 2. To keep Task 1 independently runnable, add the `SessionState` export to `src/main/providers/types.ts` as the FIRST step of Task 2 before this file typechecks in `npm run typecheck`. The vitest run for Task 1 only executes the test file and its imports; if the run fails to resolve `SessionState`, do Task 2's type addition first, then return here. (The two tasks are otherwise independent.)

- [ ] Run expecting pass: `npx vitest run src/main/conversationStore.test.ts --maxWorkers=2`
  Expected: all 11 tests pass.

- [ ] Commit:
  `git add src/main/conversationStore.ts src/main/conversationStore.test.ts && git commit -m "feat(editions): ConversationStore for persisted multi-conversation history"`

---

## Task 2 — Adapter session serialize/restore

**Files:**
- Modify `src/main/providers/types.ts` (interface `ProviderAdapter` at lines 75-81; add `SessionState`)
- Modify `src/main/providers/claude.ts` (class `ClaudeAdapter`, `sessionId` at line 141, `reset` at 145-147)
- Modify `src/main/providers/openaiCompat.ts` (class `OpenAIChatAdapter`, `history` at line 22, `reset` at 30-32)
- Modify `src/main/providers/gemini.ts` (class `GeminiAdapter`, `history`/`callSeq` at lines 61-63, `reset` at 70-73)
- Create `src/main/providers/claude.test.ts`, `src/main/providers/openaiCompat.test.ts`, `src/main/providers/gemini.test.ts`

`SessionState` is a single shared shape so the store stores `unknown[]` history without provider-specific typing.

- [ ] Add the type + interface methods to `src/main/providers/types.ts`. Replace the `ProviderAdapter` interface (lines 75-81) with:

```ts
/** Serialized per-conversation session, persisted by the ConversationStore. */
export interface SessionState {
  /** Claude resumes via this id. */
  claudeSessionId?: string
  /** OpenAI/Gemini replay this message history. */
  history?: unknown[]
}

export interface ProviderAdapter {
  /** Streams renderer events for one user turn. Throws on provider errors;
   *  AgentService catches and emits the final done event. */
  runTurn(input: TurnInput): AsyncGenerator<AgentEvent>
  /** Clears conversation state (new conversation). */
  reset(): void
  /** Snapshot of this adapter's session for persistence. */
  serializeSession(): SessionState
  /** Restore a previously-serialized session (best-effort resume). */
  restoreSession(state: SessionState): void
}
```

- [ ] Write the failing test `src/main/providers/claude.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ClaudeAdapter } from './claude'
import type { ProviderConfig } from './types'

const config = (): ProviderConfig => ({
  provider: 'claude',
  model: null,
  oauthToken: null,
  apiKey: null,
  endpoint: null
})

describe('ClaudeAdapter session', () => {
  it('round-trips the session id', () => {
    const a = new ClaudeAdapter(config)
    a.restoreSession({ claudeSessionId: 'sess-42' })
    expect(a.serializeSession()).toEqual({ claudeSessionId: 'sess-42' })
  })

  it('serializes empty before any turn', () => {
    expect(new ClaudeAdapter(config).serializeSession()).toEqual({})
  })

  it('reset clears the restored session', () => {
    const a = new ClaudeAdapter(config)
    a.restoreSession({ claudeSessionId: 'sess-42' })
    a.reset()
    expect(a.serializeSession()).toEqual({})
  })

  it('ignores history-only state', () => {
    const a = new ClaudeAdapter(config)
    a.restoreSession({ history: [{ role: 'user' }] })
    expect(a.serializeSession()).toEqual({})
  })
})
```

- [ ] Write the failing test `src/main/providers/openaiCompat.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { OpenAIChatAdapter } from './openaiCompat'
import type { ProviderConfig } from './types'

const config = (): ProviderConfig => ({
  provider: 'openai',
  model: null,
  oauthToken: null,
  apiKey: 'k',
  endpoint: null
})

describe('OpenAIChatAdapter session', () => {
  it('round-trips message history', () => {
    const a = new OpenAIChatAdapter(config)
    const history = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' }
    ]
    a.restoreSession({ history })
    expect(a.serializeSession()).toEqual({ history })
  })

  it('serializes empty history before any turn', () => {
    expect(new OpenAIChatAdapter(config).serializeSession()).toEqual({ history: [] })
  })

  it('reset clears the restored history', () => {
    const a = new OpenAIChatAdapter(config)
    a.restoreSession({ history: [{ role: 'user', content: 'hi' }] })
    a.reset()
    expect(a.serializeSession()).toEqual({ history: [] })
  })
})
```

- [ ] Write the failing test `src/main/providers/gemini.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { GeminiAdapter, sanitizeForGemini } from './gemini'
import type { ProviderConfig } from './types'

const config = (): ProviderConfig => ({
  provider: 'gemini',
  model: null,
  oauthToken: null,
  apiKey: 'k',
  endpoint: null
})

describe('GeminiAdapter session', () => {
  it('round-trips content history', () => {
    const a = new GeminiAdapter(config)
    const history = [{ role: 'user', parts: [{ text: 'hi' }] }]
    a.restoreSession({ history })
    expect(a.serializeSession()).toEqual({ history })
  })

  it('serializes empty history before any turn', () => {
    expect(new GeminiAdapter(config).serializeSession()).toEqual({ history: [] })
  })

  it('reset clears the restored history', () => {
    const a = new GeminiAdapter(config)
    a.restoreSession({ history: [{ role: 'user', parts: [{ text: 'hi' }] }] })
    a.reset()
    expect(a.serializeSession()).toEqual({ history: [] })
  })
})

describe('sanitizeForGemini', () => {
  it('drops keys Gemini rejects', () => {
    expect(sanitizeForGemini({ type: 'string', title: 'x' })).toEqual({ type: 'string' })
  })
})
```

- [ ] Run expecting failure: `npx vitest run src/main/providers/claude.test.ts src/main/providers/openaiCompat.test.ts src/main/providers/gemini.test.ts --maxWorkers=2`
  Expected: failures like `a.serializeSession is not a function` / `a.restoreSession is not a function`.

- [ ] Implement in `src/main/providers/claude.ts`. Update the import (lines 5-11) to include `SessionState`:

```ts
import {
  MCP_PREFIX,
  type AgentEvent,
  type ProviderAdapter,
  type ProviderConfig,
  type SessionState,
  type TurnInput
} from './types'
```

  And replace `reset` (lines 145-147) with:

```ts
  reset(): void {
    this.sessionId = null
  }

  serializeSession(): SessionState {
    return this.sessionId ? { claudeSessionId: this.sessionId } : {}
  }

  restoreSession(state: SessionState): void {
    this.sessionId = state.claudeSessionId ?? null
  }
```

- [ ] Implement in `src/main/providers/openaiCompat.ts`. Update the import (line 1) to include `SessionState`:

```ts
import type { AgentEvent, ProviderAdapter, ProviderConfig, SessionState, TurnInput } from './types'
```

  And replace `reset` (lines 30-32) with:

```ts
  reset(): void {
    this.history = []
  }

  serializeSession(): SessionState {
    return { history: [...this.history] }
  }

  restoreSession(state: SessionState): void {
    this.history = Array.isArray(state.history) ? (state.history as ChatMessage[]) : []
  }
```

- [ ] Implement in `src/main/providers/gemini.ts`. Update the import (line 1) to include `SessionState`:

```ts
import type { AgentEvent, ProviderAdapter, ProviderConfig, SessionState, TurnInput } from './types'
```

  And replace `reset` (lines 70-73) with:

```ts
  reset(): void {
    this.history = []
    this.callSeq = 0
  }

  serializeSession(): SessionState {
    return { history: [...this.history] }
  }

  restoreSession(state: SessionState): void {
    this.history = Array.isArray(state.history) ? (state.history as GeminiContent[]) : []
    this.callSeq = 0
  }
```

- [ ] Run expecting pass: `npx vitest run src/main/providers/claude.test.ts src/main/providers/openaiCompat.test.ts src/main/providers/gemini.test.ts --maxWorkers=2`
  Expected: all tests pass.

- [ ] Commit:
  `git add src/main/providers/types.ts src/main/providers/claude.ts src/main/providers/openaiCompat.ts src/main/providers/gemini.ts src/main/providers/claude.test.ts src/main/providers/openaiCompat.test.ts src/main/providers/gemini.test.ts && git commit -m "feat(editions): adapter serializeSession/restoreSession for per-conversation resume"`

---

## Task 3 — AgentService conversation-awareness

**Files:**
- Modify `src/main/agent.ts` (`AgentDeps` at lines 79-84, class fields at 87-90, `currentAdapter` 94-102, `resetSession` 104-108, `cancelTurn` 110-113, `runTurn` 115-150)
- Modify `src/main/agent.test.ts` (existing serialization test at lines 126-182 uses the old `runTurn` signature)

`AgentService` now keeps one adapter per conversation, restores its session on first use via an injected `loadSession`, persists it on `done` via an injected `saveSession`, and guards concurrency per conversation. `cancelTurn`/`resetSession` take a `conversationId`.

- [ ] Update the existing serialization test in `src/main/agent.test.ts`. Replace the body of the `'emits a done error when a second turn is started while one is already running'` test (the two `agent.runTurn(...)` calls at lines 160-163 and the `mockDeps` object at 134-152) so it uses the new deps + signature. Replace lines 134-181 with:

```ts
    const mockDeps = {
      toolDeps: () => ({
        axitools: {} as never,
        gw2: {} as never,
        discordGuildId: () => '1',
        gw2GuildId: () => 'g1',
        axiforge: {} as never,
        axiforgeLauncher: { ensureRunning: async () => {} },
        axibridge: () => ({}) as never
      }),
      config: () => ({
        provider: 'claude' as const,
        model: null,
        oauthToken: null,
        apiKey: null,
        endpoint: null
      }),
      confirm: vi.fn().mockResolvedValue(true),
      loadSession: () => ({}),
      saveSession: vi.fn()
    }

    const agent = new AgentService(mockDeps)

    const events1: import('./agent').AgentEvent[] = []
    const events2: import('./agent').AgentEvent[] = []

    // Start turn 1 on conversation "c1" — it blocks until _releaseTurn()
    const turn1 = agent.runTurn('c1', 'first prompt', (e) => events1.push(e))

    // A second turn on the SAME conversation must be rejected.
    const turn2 = agent.runTurn('c1', 'second prompt', (e) => events2.push(e))

    await Promise.resolve()
    await Promise.resolve()

    expect(events2).toHaveLength(1)
    expect(events2[0]).toMatchObject({
      kind: 'done',
      error: expect.stringContaining('already in progress')
    })

    _releaseTurn!()
    _turnGate.held = null
    await turn1
    await turn2
  })

  it('allows concurrent turns on different conversations', async () => {
    _turnGate.held = new Promise<void>((resolve) => { _releaseTurn = resolve })

    const { AgentService } = await import('./agent')
    vi.spyOn(await import('./tools'), 'buildOfficerTools').mockReturnValue([])

    const deps = {
      toolDeps: () => ({
        axitools: {} as never,
        gw2: {} as never,
        discordGuildId: () => '1',
        gw2GuildId: () => 'g1',
        axiforge: {} as never,
        axiforgeLauncher: { ensureRunning: async () => {} },
        axibridge: () => ({}) as never
      }),
      config: () => ({
        provider: 'claude' as const,
        model: null,
        oauthToken: null,
        apiKey: null,
        endpoint: null
      }),
      confirm: vi.fn().mockResolvedValue(true),
      loadSession: () => ({}),
      saveSession: vi.fn()
    }
    const agent = new AgentService(deps)

    const eventsB: import('./agent').AgentEvent[] = []
    const turnA = agent.runTurn('cA', 'a', () => {})
    const turnB = agent.runTurn('cB', 'b', (e) => eventsB.push(e))

    await Promise.resolve()
    await Promise.resolve()

    // cB was NOT rejected — no early "already in progress" done event.
    expect(eventsB).toHaveLength(0)

    _releaseTurn!()
    _turnGate.held = null
    await turnA
    await turnB
  })
})

describe('AgentService persistence', () => {
  it('persists the conversation session after a turn completes', async () => {
    const { AgentService } = await import('./agent')
    vi.spyOn(await import('./tools'), 'buildOfficerTools').mockReturnValue([])

    const saveSession = vi.fn()
    const deps = {
      toolDeps: () => ({
        axitools: {} as never,
        gw2: {} as never,
        discordGuildId: () => '1',
        gw2GuildId: () => 'g1',
        axiforge: {} as never,
        axiforgeLauncher: { ensureRunning: async () => {} },
        axibridge: () => ({}) as never
      }),
      config: () => ({
        provider: 'claude' as const,
        model: null,
        oauthToken: null,
        apiKey: null,
        endpoint: null
      }),
      confirm: vi.fn().mockResolvedValue(true),
      loadSession: () => ({}),
      saveSession
    }
    const agent = new AgentService(deps)
    await agent.runTurn('c9', 'hello', () => {})
    expect(saveSession).toHaveBeenCalledWith('c9', 'claude', expect.any(Object))
  })
})
```

  (Note: `_turnGate.held` is null in the persistence test, so the mocked `query` generator finishes immediately and the turn resolves.)

- [ ] Run expecting failure: `npx vitest run src/main/agent.test.ts --maxWorkers=2`
  Expected: failures — `runTurn` is called with 3 args but the current signature takes 2; `saveSession`/`loadSession` are not used; `allows concurrent turns` will hang or fail because the current global `running` flag rejects the second turn.

- [ ] Rewrite `src/main/agent.ts`. Replace `AgentDeps` (lines 79-84) and the entire `AgentService` class (lines 86-151) with:

```ts
export interface AgentDeps {
  toolDeps: () => ToolDeps
  /** Provider, model, and credentials — read fresh at the start of every turn. */
  config: () => ProviderConfig
  confirm: (toolName: string, input: Record<string, unknown>) => Promise<boolean>
  /** Persisted session for a conversation, used to restore an adapter on first use. */
  loadSession: (conversationId: string) => SessionState
  /** Persist a conversation's session after each completed turn. */
  saveSession: (conversationId: string, provider: ProviderName, session: SessionState) => void
}

interface LiveAdapter {
  adapter: ProviderAdapter
  provider: ProviderName
}

export class AgentService {
  private adapters = new Map<string, LiveAdapter>()
  private running = new Set<string>()
  private aborts = new Map<string, AbortController>()

  constructor(private readonly deps: AgentDeps) {}

  /**
   * Returns the live adapter for a conversation, creating + restoring it on
   * first use. Switching providers for a conversation starts a fresh adapter
   * (transcript is preserved by the store; model context resets).
   */
  private adapterFor(conversationId: string): ProviderAdapter {
    const provider = this.deps.config().provider
    const existing = this.adapters.get(conversationId)
    if (existing && existing.provider === provider) return existing.adapter
    const adapter = createAdapter(provider, this.deps.config)
    adapter.restoreSession(this.deps.loadSession(conversationId))
    this.adapters.set(conversationId, { adapter, provider })
    return adapter
  }

  /** Drop a conversation's live adapter + session (new conversation / delete). */
  resetSession(conversationId: string): void {
    this.adapters.get(conversationId)?.adapter.reset()
    this.adapters.delete(conversationId)
  }

  /** Abort the in-flight turn for a conversation, if any. */
  cancelTurn(conversationId: string): void {
    this.aborts.get(conversationId)?.abort()
  }

  async runTurn(
    conversationId: string,
    promptText: string,
    onEvent: (e: AgentEvent) => void
  ): Promise<void> {
    if (this.running.has(conversationId)) {
      onEvent({
        kind: 'done',
        sessionId: null,
        error: 'A turn is already in progress — wait for it to finish.'
      })
      return
    }

    this.running.add(conversationId)
    const abort = new AbortController()
    this.aborts.set(conversationId, abort)
    const adapter = this.adapterFor(conversationId)
    try {
      const tools = buildOfficerTools(this.deps.toolDeps())
      const turn = adapter.runTurn({
        prompt: promptText,
        systemPrompt: AXIVALE_SYSTEM_PROMPT,
        tools,
        confirm: this.deps.confirm,
        signal: abort.signal
      })
      for await (const event of turn) onEvent(event)
    } catch (err) {
      // A user-initiated cancel ends the turn cleanly, not as an error.
      onEvent({
        kind: 'done',
        sessionId: null,
        error: abort.signal.aborted ? null : err instanceof Error ? err.message : String(err)
      })
    } finally {
      this.running.delete(conversationId)
      this.aborts.delete(conversationId)
      // Persist the (possibly updated) session for restart resume.
      const live = this.adapters.get(conversationId)
      if (live) this.deps.saveSession(conversationId, live.provider, live.adapter.serializeSession())
    }
  }
}
```

  Also update the imports at the top of the file (lines 2-5) to include `SessionState`:

```ts
import { MCP_PREFIX, type AgentEvent, type ProviderConfig, type ProviderName } from './providers/types'
import { evaluateToolPermission } from './providers/permission'
import { createAdapter } from './providers'
import type { ProviderAdapter, SessionState } from './providers/types'
```

- [ ] Run expecting pass: `npx vitest run src/main/agent.test.ts --maxWorkers=2`
  Expected: all tests pass (including the new concurrency + persistence tests).

- [ ] Commit:
  `git add src/main/agent.ts src/main/agent.test.ts && git commit -m "feat(editions): per-conversation adapters, guard, and session persistence in AgentService"`

---

## Task 4 — IPC + preload + d.ts wiring

**Files:**
- Modify `src/main/index.ts` (imports at lines 1-33; `agent` construction at 162-185; `agent:send` at 437-441; `agent:reset` at 448-451; `agent:cancel` at 453-456)
- Modify `src/preload/index.ts` (the exposed object at lines 3-61)
- Modify `src/preload/index.d.ts` (`OfficerApi` interface at lines 1-89)

This wiring is exercised by the already-unit-tested store/service plus a typecheck. The `agent:event` envelope gains `conversationId` so the renderer can attribute background completions. Steps not unit-testable here are verified by `npm run typecheck` and the manual smoke checklist in Task 7.

- [ ] In `src/main/index.ts`, add the import after line 31 (`import { AgentService } from './agent'`):

```ts
import { ConversationStore, type Conversation } from './conversationStore'
import type { SessionState } from './providers/types'
```

- [ ] In `src/main/index.ts`, construct the store inside `app.whenReady().then(...)`, immediately after the `SettingsStore` is created (after line 90):

```ts
  const conversations = new ConversationStore(join(app.getPath('userData'), 'conversations.json'))
```

- [ ] In `src/main/index.ts`, extend the `AgentService` deps object (lines 162-185) by adding `loadSession`/`saveSession` after the `config` line (line 173):

```ts
    loadSession: (conversationId: string): SessionState =>
      conversations.get(conversationId)?.session ?? {},
    saveSession: (conversationId, provider, session) =>
      conversations.saveSession(conversationId, provider, session),
```

- [ ] In `src/main/index.ts`, replace the `agent:send` handler (lines 437-441) with a conversation-scoped one that stamps the event with the conversation id:

```ts
  ipcMain.handle('agent:send', async (event, conversationId: string, prompt: string) => {
    await agent.runTurn(conversationId, prompt, (agentEvent) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('agent:event', { ...agentEvent, conversationId })
      }
    })
  })
```

- [ ] In `src/main/index.ts`, replace the `agent:reset` and `agent:cancel` handlers (lines 448-456) with conversation-scoped versions:

```ts
  ipcMain.handle('agent:reset', (_event, conversationId: string) => {
    drainConfirms()
    agent.resetSession(conversationId)
  })

  ipcMain.handle('agent:cancel', (_event, conversationId: string) => {
    drainConfirms()
    agent.cancelTurn(conversationId)
  })
```

- [ ] In `src/main/index.ts`, add the `conversations:*` handlers (place them next to the other `ipcMain.handle` calls, e.g. after the `agent:cancel` block):

```ts
  ipcMain.handle('conversations:list', () => conversations.list())
  ipcMain.handle('conversations:get', (_event, id: string) => conversations.get(id))
  ipcMain.handle('conversations:create', (_event, seed?: Partial<Conversation>) =>
    conversations.create(seed)
  )
  ipcMain.handle('conversations:save-turns', (_event, id: string, turns: Conversation['turns']) => {
    conversations.saveTurns(id, turns)
  })
  ipcMain.handle('conversations:rename', (_event, id: string, title: string | null) => {
    conversations.rename(id, title)
  })
  ipcMain.handle('conversations:delete', (_event, id: string) => {
    conversations.remove(id)
    agent.resetSession(id)
  })
  ipcMain.handle('conversations:set-active', (_event, id: string) => {
    conversations.setActive(id)
  })
  ipcMain.handle('conversations:mark-seen', (_event, id: string, count: number) => {
    conversations.markSeen(id, count)
  })
```

- [ ] In `src/preload/index.ts`, replace the `sendMessage`/`resetSession`/`cancelTurn` lines (lines 21-23) with conversation-scoped wrappers and add the `conversations*` wrappers:

```ts
  sendMessage: (conversationId: string, text: string) =>
    ipcRenderer.invoke('agent:send', conversationId, text),
  resetSession: (conversationId: string) => ipcRenderer.invoke('agent:reset', conversationId),
  cancelTurn: (conversationId: string) => ipcRenderer.invoke('agent:cancel', conversationId),
  listConversations: () => ipcRenderer.invoke('conversations:list'),
  getConversation: (id: string) => ipcRenderer.invoke('conversations:get', id),
  createConversation: (seed?: unknown) => ipcRenderer.invoke('conversations:create', seed),
  saveTurns: (id: string, turns: unknown) =>
    ipcRenderer.invoke('conversations:save-turns', id, turns),
  renameConversation: (id: string, title: string | null) =>
    ipcRenderer.invoke('conversations:rename', id, title),
  deleteConversation: (id: string) => ipcRenderer.invoke('conversations:delete', id),
  setActiveConversation: (id: string) => ipcRenderer.invoke('conversations:set-active', id),
  markConversationSeen: (id: string, count: number) =>
    ipcRenderer.invoke('conversations:mark-seen', id, count),
```

- [ ] In `src/preload/index.d.ts`, add a `RendererConversation` type and the new method signatures. Add this type above `OfficerApi` (before line 1):

```ts
export interface RendererSessionState {
  claudeSessionId?: string
  history?: unknown[]
}

export interface RendererConversation {
  id: string
  title: string | null
  createdAt: string
  updatedAt: string
  turns: unknown[]
  provider: 'claude' | 'gemini' | 'openai' | 'local'
  session: RendererSessionState
  seenTurnCount: number
}
```

  Replace the `sendMessage`/`resetSession`/`cancelTurn` lines (lines 65-67) with:

```ts
  sendMessage(conversationId: string, text: string): Promise<void>
  resetSession(conversationId: string): Promise<void>
  cancelTurn(conversationId: string): Promise<void>
  listConversations(): Promise<RendererConversation[]>
  getConversation(id: string): Promise<RendererConversation | null>
  createConversation(seed?: Partial<RendererConversation>): Promise<RendererConversation>
  saveTurns(id: string, turns: unknown[]): Promise<void>
  renameConversation(id: string, title: string | null): Promise<void>
  deleteConversation(id: string): Promise<void>
  setActiveConversation(id: string): Promise<void>
  markConversationSeen(id: string, count: number): Promise<void>
```

- [ ] Run the typecheck (no unit test for IPC wiring): `npm run typecheck`
  Expected: passes. (If it reports renderer errors, those are fixed in Tasks 6; run typecheck again at the end of Task 6.)

> NOTE: `npm run typecheck` covers both `tsconfig.node.json` (main + preload) and `tsconfig.web.json` (renderer). The renderer side still references the old `sendMessage(text)` until Task 6, so expect renderer-only errors here; the main/preload halves must be clean. Defer the full green typecheck to Task 6.

- [ ] Commit:
  `git add src/main/index.ts src/preload/index.ts src/preload/index.d.ts && git commit -m "feat(editions): conversations IPC, conversation-scoped agent IPC, conversationId on events"`

---

## Task 5 — Renderer Editions component

**Files:**
- Create `src/renderer/src/components/Editions.tsx`
- Create `src/renderer/src/components/Editions.test.tsx`
- Reference: `src/renderer/src/components/headline.ts` (`splitHeadline`, `stripMarkdown`), `src/renderer/src/components/Rails.test.tsx` (jsdom test style), `src/renderer/src/theme.css` rail classes (`.rail`, `.rail.left`, `.rail .h`, `.rail .item`, `--accent`, `--accent-b`, `--faint`).

`Editions` is presentational: it receives `conversations`, `activeId`, the `freshIds` set, and callbacks. Auto headline = `splitHeadline(stripMarkdown(firstDoneAiTurn.agentText)).headline`, else first user line, else "Untitled dispatch". Grouping by `updatedAt`: Today vs Earlier. Rename is an inline text input; delete confirms via `window.confirm`.

- [ ] Write the failing test `src/renderer/src/components/Editions.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, within } from '@testing-library/react'
import Editions from './Editions'
import type { EditionItem } from './Editions'

function conv(over: Partial<EditionItem> = {}): EditionItem {
  return {
    id: 'c1',
    title: null,
    updatedAt: new Date().toISOString(),
    turns: [],
    dispatchCount: 0,
    fresh: false,
    ...over
  }
}

const noop = (): void => {}

function baseProps(items: EditionItem[]) {
  return {
    items,
    activeId: null as string | null,
    onSelect: vi.fn(),
    onNew: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn()
  }
}

describe('Editions', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('groups by Today and Earlier from updatedAt', () => {
    const today = conv({ id: 'a', updatedAt: new Date().toISOString() })
    const earlier = conv({ id: 'b', updatedAt: '2020-01-01T00:00:00.000Z' })
    const { getByText } = render(<Editions {...baseProps([today, earlier])} />)
    expect(getByText('Today')).toBeTruthy()
    expect(getByText('Earlier')).toBeTruthy()
  })

  it('shows an auto headline from the first done AI turn', () => {
    const item = conv({
      turns: [
        {
          id: 1,
          userText: 'how many?',
          agentText: 'Twelve members are on the books. The rest are details.',
          tools: [],
          done: true,
          error: null,
          filedAt: '12:00'
        }
      ],
      dispatchCount: 1
    })
    const { getByText } = render(<Editions {...baseProps([item])} />)
    expect(getByText('Twelve members are on the books.')).toBeTruthy()
  })

  it('falls back to the first user line, then Untitled dispatch', () => {
    const userOnly = conv({
      id: 'u',
      turns: [
        { id: 1, userText: 'roster please', agentText: '', tools: [], done: false, error: null, filedAt: '1' }
      ]
    })
    const empty = conv({ id: 'e', turns: [] })
    const { getByText } = render(<Editions {...baseProps([userOnly, empty])} />)
    expect(getByText('roster please')).toBeTruthy()
    expect(getByText('Untitled dispatch')).toBeTruthy()
  })

  it('prefers an explicit title over the auto headline', () => {
    const item = conv({ title: 'Weekly muster', turns: [] })
    const { getByText } = render(<Editions {...baseProps([item])} />)
    expect(getByText('Weekly muster')).toBeTruthy()
  })

  it('filters by the search box', () => {
    const a = conv({ id: 'a', title: 'Roster review' })
    const b = conv({ id: 'b', title: 'Build audit' })
    const { getByPlaceholderText, queryByText } = render(<Editions {...baseProps([a, b])} />)
    fireEvent.change(getByPlaceholderText('Search editions'), { target: { value: 'build' } })
    expect(queryByText('Build audit')).toBeTruthy()
    expect(queryByText('Roster review')).toBeNull()
  })

  it('marks the active row', () => {
    const a = conv({ id: 'a', title: 'A' })
    const props = { ...baseProps([a]), activeId: 'a' }
    const { container } = render(<Editions {...props} />)
    expect(container.querySelector('.edition.active')).toBeTruthy()
  })

  it('calls onSelect when a row is clicked', () => {
    const a = conv({ id: 'a', title: 'A' })
    const props = baseProps([a])
    const { getByText } = render(<Editions {...props} />)
    fireEvent.click(getByText('A'))
    expect(props.onSelect).toHaveBeenCalledWith('a')
  })

  it('calls onNew when New dispatch is clicked', () => {
    const props = baseProps([])
    const { getByText } = render(<Editions {...props} />)
    fireEvent.click(getByText('+ New dispatch'))
    expect(props.onNew).toHaveBeenCalled()
  })

  it('renames inline on submit', () => {
    const a = conv({ id: 'a', title: 'Old' })
    const props = baseProps([a])
    const { container, getByDisplayValue } = render(<Editions {...props} />)
    fireEvent.click(within(container.querySelector('.edition') as HTMLElement).getByTitle('Rename'))
    const input = getByDisplayValue('Old') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'New name' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onRename).toHaveBeenCalledWith('a', 'New name')
  })

  it('confirms before delete', () => {
    const a = conv({ id: 'a', title: 'A' })
    const props = baseProps([a])
    const { container } = render(<Editions {...props} />)
    fireEvent.click(within(container.querySelector('.edition') as HTMLElement).getByTitle('Delete'))
    expect(window.confirm).toHaveBeenCalled()
    expect(props.onDelete).toHaveBeenCalledWith('a')
  })

  it('shows the hot-off-the-press kicker for fresh editions', () => {
    const a = conv({ id: 'a', title: 'A', fresh: true })
    const { getByText } = render(<Editions {...baseProps([a])} />)
    expect(getByText('✦ Hot off the press')).toBeTruthy()
  })
})
```

- [ ] Run expecting failure: `npx vitest run src/renderer/src/components/Editions.test.tsx --maxWorkers=2`
  Expected: `Failed to resolve import "./Editions"`.

- [ ] Create `src/renderer/src/components/Editions.tsx`:

```tsx
import { useMemo, useState, type ReactElement } from 'react'
import type { Turn } from '../state'
import { splitHeadline, stripMarkdown } from './headline'

export interface EditionItem {
  id: string
  title: string | null
  updatedAt: string
  turns: Turn[]
  dispatchCount: number
  fresh: boolean
}

interface EditionsProps {
  items: EditionItem[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}

/** Auto headline: first done AI turn, else first user line, else fallback. */
function autoHeadline(item: EditionItem): string {
  if (item.title && item.title.trim()) return item.title
  const aiTurn = item.turns.find((t) => t.done && t.agentText.trim())
  if (aiTurn) {
    const { headline } = splitHeadline(stripMarkdown(aiTurn.agentText))
    if (headline.trim()) return headline
  }
  const userTurn = item.turns.find((t) => t.userText.trim())
  if (userTurn) return userTurn.userText.split('\n')[0].trim()
  return 'Untitled dispatch'
}

function isToday(iso: string): boolean {
  const d = new Date(iso)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

function metaLine(item: EditionItem): string {
  const d = new Date(item.updatedAt)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const n = item.dispatchCount
  return `${date} · ${time} · ${n} ${n === 1 ? 'dispatch' : 'dispatches'}`
}

function Row({
  item,
  active,
  onSelect,
  onRename,
  onDelete
}: {
  item: EditionItem
  active: boolean
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}): ReactElement {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const headline = autoHeadline(item)

  function startEdit(e: React.MouseEvent): void {
    e.stopPropagation()
    setDraft(item.title ?? headline)
    setEditing(true)
  }

  function commit(): void {
    const trimmed = draft.trim()
    if (trimmed) onRename(item.id, trimmed)
    setEditing(false)
  }

  function remove(e: React.MouseEvent): void {
    e.stopPropagation()
    if (window.confirm('Delete this edition? The transcript will be lost.')) onDelete(item.id)
  }

  return (
    <div
      className={`edition${active ? ' active' : ''}${item.fresh ? ' fresh' : ''}`}
      onClick={() => onSelect(item.id)}
      role="button"
    >
      {item.fresh && <div className="kick">✦ Hot off the press</div>}
      {editing ? (
        <input
          className="ed-rename"
          autoFocus
          value={draft}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
          onBlur={commit}
        />
      ) : (
        <div className="ed-headline">{headline}</div>
      )}
      <div className="ed-meta">{metaLine(item)}</div>
      <div className="ed-acts">
        <button title="Rename" onClick={startEdit}>
          ✎
        </button>
        <button title="Delete" onClick={remove}>
          ✕
        </button>
      </div>
    </div>
  )
}

export default function Editions({
  items,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete
}: EditionsProps): ReactElement {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((it) => autoHeadline(it).toLowerCase().includes(q))
  }, [items, query])

  const today = filtered.filter((it) => isToday(it.updatedAt))
  const earlier = filtered.filter((it) => !isToday(it.updatedAt))

  return (
    <div className="rail left editions">
      <div className="ed-head">
        <div className="h">Editions</div>
        <button className="ed-new" onClick={onNew}>
          + New dispatch
        </button>
      </div>
      <input
        className="ed-search"
        placeholder="Search editions"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {today.length > 0 && <div className="ed-group">Today</div>}
      {today.map((it) => (
        <Row
          key={it.id}
          item={it}
          active={it.id === activeId}
          onSelect={onSelect}
          onRename={onRename}
          onDelete={onDelete}
        />
      ))}
      {earlier.length > 0 && <div className="ed-group">Earlier</div>}
      {earlier.map((it) => (
        <Row
          key={it.id}
          item={it}
          active={it.id === activeId}
          onSelect={onSelect}
          onRename={onRename}
          onDelete={onDelete}
        />
      ))}
    </div>
  )
}
```

- [ ] Run expecting pass: `npx vitest run src/renderer/src/components/Editions.test.tsx --maxWorkers=2`
  Expected: all 12 tests pass.

- [ ] Add styling to `src/renderer/src/theme.css` (append near the existing `.rail` block, after line 213). These reuse existing variables:

```css
.editions{overflow-y:auto}
.ed-head{display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px dashed var(--rule2);padding-bottom:6px;margin-bottom:10px}
.ed-head .h{border:none;padding:0;margin:0}
.ed-new{font-family:'IBM Plex Mono',monospace;font-size:8.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent-b);background:none;border:none;cursor:pointer;padding:0}
.ed-new:hover{color:var(--ink)}
.ed-search{width:100%;background:rgba(0,0,0,.2);border:1px solid var(--line);color:var(--ink);font-family:'IBM Plex Mono',monospace;font-size:10px;padding:5px 7px;margin-bottom:12px;box-sizing:border-box}
.ed-group{font-family:'IBM Plex Mono',monospace;font-size:8px;letter-spacing:.24em;text-transform:uppercase;color:var(--faint);margin:10px 0 6px}
.edition{position:relative;padding:9px 24px 9px 9px;margin-bottom:6px;border-left:2px solid transparent;cursor:pointer}
.edition:hover{background:rgba(228,227,220,.05)}
.edition.active{border-left-color:var(--accent);background:rgba(200,66,58,.08)}
.edition .ed-headline{font-family:'Playfair Display',serif;font-style:italic;font-size:13px;line-height:1.3;color:var(--ink-dim);margin-bottom:3px}
.edition.active .ed-headline,.edition.fresh .ed-headline{color:var(--ink)}
.edition .ed-meta{font-family:'IBM Plex Mono',monospace;font-size:8px;letter-spacing:.1em;color:var(--faint)}
.edition .kick{font-family:'IBM Plex Mono',monospace;font-size:8px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent-b);margin-bottom:3px}
.edition .ed-rename{width:100%;background:var(--paper);border:1px solid var(--rule2);color:var(--ink);font-family:'Playfair Display',serif;font-style:italic;font-size:13px;padding:2px 4px;margin-bottom:3px;box-sizing:border-box}
.edition .ed-acts{position:absolute;top:8px;right:6px;display:none;gap:4px}
.edition:hover .ed-acts{display:flex}
.edition .ed-acts button{background:none;border:none;color:var(--faint);cursor:pointer;font-size:11px;padding:0 2px;line-height:1}
.edition .ed-acts button:hover{color:var(--accent-b)}
```

- [ ] Commit:
  `git add src/renderer/src/components/Editions.tsx src/renderer/src/components/Editions.test.tsx src/renderer/src/theme.css && git commit -m "feat(editions): Editions feed component (grouping, search, rename, delete, fresh marker)"`

---

## Task 6 — App.tsx wiring + Rails cleanup

**Files:**
- Modify `src/renderer/src/App.tsx` (imports at 1-14; `loadTurns`/`TURNS_KEY` at 31-46; state at 48-64; agent-event subscription at 102-130; persistence effect at 138-145; `newConversation` at 147-153; `submit` at 160-177; `stopTurn` at 155-158; render block at 187-251)
- Modify `src/renderer/src/components/Rails.tsx` (remove `LeftRail` at lines 11-28; keep `RailsProps` + `RightRail`)
- Modify `src/renderer/src/App.test.tsx` (`makeOfficer` at 7-52: add `conversations*` methods, change `sendMessage`; the `vi.mock('./components/Rails', ...)` at 67-70)

App now owns `conversations` (the list), `activeId`, and the active conversation's `turns`. On mount it loads conversations, migrates the legacy `localStorage` once, and selects the active/most-recent. Background `done` events for non-active conversations set a `freshIds` set; opening an edition clears it via `markConversationSeen`. The `agent:event` payload now carries `conversationId`.

- [ ] Update `src/renderer/src/App.test.tsx`. In `makeOfficer` (after the `cancelTurn` line ~33), add the conversation methods and change `sendMessage`:

```ts
    sendMessage: vi.fn().mockResolvedValue(undefined),
    resetSession: vi.fn().mockResolvedValue(undefined),
    cancelTurn: vi.fn(),
    listConversations: vi.fn().mockResolvedValue([]),
    getConversation: vi.fn().mockResolvedValue(null),
    createConversation: vi.fn().mockResolvedValue({
      id: 'c1',
      title: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      turns: [],
      provider: 'claude',
      session: {},
      seenTurnCount: 0
    }),
    saveTurns: vi.fn().mockResolvedValue(undefined),
    renameConversation: vi.fn().mockResolvedValue(undefined),
    deleteConversation: vi.fn().mockResolvedValue(undefined),
    setActiveConversation: vi.fn().mockResolvedValue(undefined),
    markConversationSeen: vi.fn().mockResolvedValue(undefined),
```

  And change the Rails mock (lines 67-70) to drop `LeftRail`:

```ts
vi.mock('./components/Rails', () => ({
  RightRail: () => null
}))
vi.mock('./components/Editions', () => ({ default: () => null }))
```

  The existing three `bridgeProgress` tests still pass: `submit()` now needs an active conversation, so add a default in `makeOfficer` by having `listConversations` return one edition. Update `listConversations` in `makeOfficer` to:

```ts
    listConversations: vi.fn().mockResolvedValue([
      {
        id: 'c1',
        title: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        turns: [],
        provider: 'claude',
        session: {},
        seenTurnCount: 0
      }
    ]),
```

  Wrap the initial `render(<App />)` mounts so the async load settles — change each `render(<App />)` in the three tests to:

```ts
    await act(async () => {
      render(<App />)
    })
```

- [ ] Run expecting failure: `npx vitest run src/renderer/src/App.test.tsx --maxWorkers=2`
  Expected: failures — `App` still imports `LeftRail` from Rails (now removed in the mock) / calls `sendMessage(text)`, and the agent-event handler doesn't yet filter by `conversationId`. (Some assertions may still pass; the suite as a whole must fail to compile/run until App is rewritten.)

- [ ] Rewrite `src/renderer/src/App.tsx`. Replace the imports (lines 1-14) with:

```tsx
import { useEffect, useRef, useState, type ReactElement } from 'react'
import './theme.css'
import { applyEvent, type AgentEvent, type Turn } from './state'
import Masthead, { type Section } from './components/Masthead'
import Builds from './components/panels/Builds'
import Comps from './components/panels/Comps'
import Roster from './components/panels/Roster'
import Bureau from './components/panels/Bureau'
import { RightRail } from './components/Rails'
import Editions, { type EditionItem } from './components/Editions'
import Article from './components/Article'
import InputBar from './components/InputBar'
import ConfirmDialog, { type ConfirmReq } from './components/ConfirmDialog'
import Settings from './components/Settings'
import UpdateBanner from './components/UpdateBanner'
import type { RendererConversation } from '../../preload/index.d'
```

  Replace `loadTurns`/`TURNS_KEY` (lines 31-46) and the legacy-restore logic with a migration helper:

```tsx
const TURNS_KEY = 'axivale.turns'

// Legacy single conversation persisted under localStorage; migrated once.
function legacyTurns(): Turn[] {
  try {
    const raw = localStorage.getItem(TURNS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Turn[]
    return Array.isArray(parsed) ? parsed.map((t) => (t.done ? t : { ...t, done: true })) : []
  } catch {
    return []
  }
}

function completedTurnCount(turns: Turn[]): number {
  return turns.filter((t) => t.done).length
}
```

  Replace the App state block (lines 48-64) with:

```tsx
export default function App(): ReactElement {
  const [conversations, setConversations] = useState<RendererConversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set())
  const [section, setSection] = useState<Section>('dispatches')
  const [running, setRunning] = useState(false)
  const [bridgeProgress, setBridgeProgress] = useState<string | null>(null)
  const [confirmQueue, setConfirmQueue] = useState<ConfirmReq[]>([])

  // status surfaced in masthead / rails
  const [axiConnected, setAxiConnected] = useState(false)
  const [guildName, setGuildName] = useState<string | null>(null)
  const [gw2AccountName, setGw2AccountName] = useState<string | null>(null)
  const [claudeTokenSaved, setClaudeTokenSaved] = useState(false)
  const [providerNote, setProviderNote] = useState<string | null>(null)

  const chatRef = useRef<HTMLDivElement>(null)
  const nextId = useRef(1)
  // The active id seen by event handlers (avoids stale closures in subscriptions).
  const activeIdRef = useRef<string | null>(null)
  activeIdRef.current = activeId
```

  Add a mount effect that loads + migrates conversations. Place it right after `refreshStatus`'s `useEffect` (which is currently at lines 97-99). Insert:

```tsx
  // Load conversations on mount; migrate the legacy localStorage transcript once.
  useEffect(() => {
    void (async () => {
      let list = await window.officer.listConversations()
      const legacy = legacyTurns()
      if (list.length === 0 && legacy.length > 0) {
        const provider = (await window.officer.getSetting('provider')) as
          | RendererConversation['provider']
          | null
        const created = await window.officer.createConversation({
          turns: legacy,
          provider: provider ?? 'claude',
          seenTurnCount: completedTurnCount(legacy)
        })
        await window.officer.setActiveConversation(created.id)
        localStorage.removeItem(TURNS_KEY)
        list = await window.officer.listConversations()
      }
      setConversations(list)
      const stored = list[0] ?? null
      if (stored) {
        await openConversation(stored.id, list)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

  Add the `openConversation` helper inside the component (before the return):

```tsx
  async function openConversation(id: string, knownList?: RendererConversation[]): Promise<void> {
    const conv = await window.officer.getConversation(id)
    if (!conv) return
    setActiveId(id)
    setTurns(conv.turns as Turn[])
    nextId.current = (conv.turns as Turn[]).reduce((m, t) => Math.max(m, t.id), 0) + 1
    void window.officer.setActiveConversation(id)
    const seen = completedTurnCount(conv.turns as Turn[])
    void window.officer.markConversationSeen(id, seen)
    setFreshIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    // Reflect the up-to-date seenTurnCount/turns into the cached list.
    const list = knownList ?? conversations
    setConversations(list.map((c) => (c.id === id ? { ...c, seenTurnCount: seen, turns: conv.turns } : c)))
  }
```

  Replace the agent-event subscription effect (lines 102-130) with a conversation-aware one:

```tsx
  // Subscribe once; fold events into the active conversation, flag background completions.
  useEffect(() => {
    const offEvent = window.officer.onAgentEvent((raw) => {
      const event = raw as AgentEvent & { conversationId?: string }
      const convId = event.conversationId ?? activeIdRef.current
      if (convId && convId === activeIdRef.current) {
        setTurns((prev) => {
          if (prev.length === 0) return prev
          const last = prev[prev.length - 1]
          const updated = applyEvent(last, event)
          return [...prev.slice(0, -1), updated]
        })
        if (event.kind === 'done') {
          setRunning(false)
          setBridgeProgress(null)
        }
      } else if (event.kind === 'done' && convId) {
        // Background conversation finished — mark it fresh and refresh the list.
        setFreshIds((prev) => new Set(prev).add(convId))
        void window.officer.listConversations().then(setConversations)
      }
    })
    const offConfirm = window.officer.onConfirmRequest((raw) => {
      setConfirmQueue((prev) => [...prev, raw as ConfirmReq])
    })
    const offProgress = window.officer.onAxibridgeProgress((raw) => {
      setBridgeProgress(raw as string)
    })
    return () => {
      offEvent()
      offConfirm()
      offProgress()
    }
  }, [])
```

  Replace the localStorage persistence effect (lines 138-145) with a debounced save-turns to the store:

```tsx
  // Persist the active conversation's turns (debounced) to the store.
  useEffect(() => {
    if (!activeId) return
    const id = activeId
    const handle = setTimeout(() => {
      void window.officer.saveTurns(id, turns)
      setConversations((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, turns, updatedAt: new Date().toISOString() } : c
        )
      )
    }, 300)
    return () => clearTimeout(handle)
  }, [turns, activeId])
```

  Replace `newConversation` (lines 147-153) and `stopTurn` (155-158):

```tsx
  async function newConversation(): Promise<void> {
    const provider = (await window.officer.getSetting('provider')) as
      | RendererConversation['provider']
      | null
    const created = await window.officer.createConversation({ provider: provider ?? 'claude' })
    const list = await window.officer.listConversations()
    setConversations(list)
    setActiveId(created.id)
    setTurns([])
    nextId.current = 1
    setRunning(false)
    setConfirmQueue([])
    void window.officer.setActiveConversation(created.id)
  }

  function stopTurn(): void {
    if (activeId) void window.officer.cancelTurn(activeId)
    setConfirmQueue([])
  }
```

  Replace `submit` (lines 160-177):

```tsx
  function submit(text: string): void {
    if (!activeId) return
    const id = activeId
    const turn: Turn = {
      id: nextId.current++,
      userText: text,
      agentText: '',
      tools: [],
      done: false,
      error: null,
      filedAt: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    }
    setTurns((prev) => [...prev, turn])
    setRunning(true)
    setBridgeProgress(null)
    void window.officer.sendMessage(id, text).catch(() => setRunning(false))
  }
```

  Build the `EditionItem[]` for the rail just before the return (after the `respondConfirm` function, replacing the `memberCount`/`buildsCount` consts at lines 184-185 — keep those two consts, they're used by RightRail):

```tsx
  const editionItems: EditionItem[] = conversations.map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt,
    turns: c.turns as Turn[],
    dispatchCount: (c.turns as Turn[]).filter((t) => t.userText.trim()).length,
    fresh: freshIds.has(c.id)
  }))

  const memberCount: number | null = null
  const buildsCount: number | null = null
```

  Replace the render `<LeftRail .../>` line (line 203) with:

```tsx
        <Editions
          items={editionItems}
          activeId={activeId}
          onSelect={(id) => void openConversation(id)}
          onNew={() => void newConversation()}
          onRename={(id, title) => {
            void window.officer.renameConversation(id, title)
            setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)))
          }}
          onDelete={(id) => {
            void window.officer.deleteConversation(id).then(async () => {
              const list = await window.officer.listConversations()
              setConversations(list)
              if (id === activeId) {
                const fallback = list[0]
                if (fallback) await openConversation(fallback.id, list)
                else await newConversation()
              }
            })
          }}
        />
```

  Replace the folio "New dispatch" button block (lines 207-211) — it's now in the rail, so remove it:

```tsx
            <h1>{SECTION_TITLES[section]}</h1>
            <span className="d">{dateline}</span>
```

  (i.e. delete the `{section === 'dispatches' && turns.length > 0 && (<button .../>)}` block.)

  Update the Settings provider-change handler (line 214) — `onProviderChanged={newConversation}` still works since `newConversation` is now async; React accepts an async void handler. Leave it as:

```tsx
          {section === 'settings' && <Settings onChanged={refreshStatus} onProviderChanged={() => void newConversation()} />}
```

- [ ] Remove `LeftRail` from `src/renderer/src/components/Rails.tsx`. Delete the `LeftRail` function (lines 11-28). Keep the `RailsProps` interface, `Notice`, `NoticeCard`, and `RightRail`. The `import { useState, type ReactElement }` and the `ToolCall, Turn` import stay (still used by `RightRail`/`NoticeCard`).

- [ ] Run expecting pass: `npx vitest run src/renderer/src/App.test.tsx src/renderer/src/components/Editions.test.tsx src/renderer/src/components/Rails.test.tsx --maxWorkers=2`
  Expected: all pass.

- [ ] Run the full typecheck (should now be fully green): `npm run typecheck`
  Expected: passes for both tsconfigs.

- [ ] Commit:
  `git add src/renderer/src/App.tsx src/renderer/src/components/Rails.tsx src/renderer/src/App.test.tsx && git commit -m "feat(editions): wire App to conversations, migrate localStorage, replace LeftRail with Editions"`

---

## Task 7 — Final verification

**Files:** none (verification only)

- [ ] Run the full test suite: `npx vitest run --maxWorkers=2`
  Expected: all suites pass (new: conversationStore, provider session tests, Editions; updated: agent, App).

- [ ] Run the typecheck: `npm run typecheck`
  Expected: clean.

- [ ] Run the build: `npm run build`
  Expected: succeeds (main, preload, renderer bundles).

- [ ] Manual smoke checklist (run `npm run dev`):
  - [ ] Create two conversations via "+ New dispatch"; each starts empty and is selectable.
  - [ ] Send a prompt in one, switch to the other, switch back — each retains its own transcript and continues with context while the app runs.
  - [ ] Start a turn in conversation A, switch to B; when A's reply finishes, A's row shows "✦ Hot off the press". Opening A clears the marker.
  - [ ] Rename an edition (✎ → type → Enter); the headline updates and persists.
  - [ ] Delete the active edition (✕ → confirm); focus falls back to the newest remaining, or a fresh empty one if none remain.
  - [ ] Quit and relaunch: conversations persist; if a pre-upgrade `localStorage['axivale.turns']` existed, it appears as one edition and the key is gone.

- [ ] Final commit if any verification fixes were needed:
  `git add -A && git commit -m "chore(editions): final verification fixes"`

---

## Cross-task type/method index (every referenced symbol is defined)

- `Conversation`, `ConversationSeed`, `ConversationStore` + methods (`list`, `get`, `create`, `saveTurns`, `saveSession`, `rename`, `remove`, `setActive`, `getActiveId`, `markSeen`, `flush`) — Task 1.
- `SessionState`, `ProviderAdapter.serializeSession/restoreSession` — Task 2.
- `AgentDeps.loadSession/saveSession`, `AgentService.runTurn(conversationId, ...)`, `resetSession(id)`, `cancelTurn(id)` — Task 3.
- `conversations:*` IPC, `agent:send(conversationId, prompt)`, event envelope `{ ...event, conversationId }` — Task 4.
- `RendererConversation`, `RendererSessionState`, preload wrappers — Task 4.
- `EditionItem`, `Editions` component + props — Task 5.
- `editionItems`, `openConversation`, `freshIds`, `legacyTurns`, `completedTurnCount` — Task 6.

# Editions — Multi-Conversation History — Design

**Date:** 2026-06-12
**Status:** Approved for planning
**Repo:** `axivale`

## Goal

Keep past conversations and let the user run several at once. The left rail becomes an **Editions** feed — a newspaper-styled list of all conversations (new and old). Click an edition to switch to it and keep chatting; "New dispatch" starts another instead of wiping the current one. A conversation that finishes a reply while it isn't the focused one shows a "Hot off the press" marker.

## Context (current state)

- A single conversation lives in renderer React state and `localStorage` under `axivale.turns`. `newConversation()` clears it.
- `LeftRail` (in `src/renderer/src/components/Rails.tsx`) is a static "In this issue" panel (roster count, builds filed, weekly reset). `RightRail` already shows roster + builds counts, so the left stats are redundant.
- `AgentService` (`src/main/agent.ts`) holds **one** adapter with one session: Claude keeps a `sessionId` (resumes via SDK `resume`); `OpenAIChatAdapter`/`GeminiAdapter` keep an in-memory `history[]`. A `running` flag rejects a second concurrent turn app-wide.
- `Turn` type and `applyEvent` live in `src/renderer/src/state.ts`. Agent events reach the renderer via the `agent:event` IPC; turns are persisted to `localStorage` on change.

## Decisions (from brainstorming)

1. **Multiple conversations, switchable and continuable** (ChatGPT-style), themed as newspaper "editions".
2. **Continuation:** live full (switching between conversations continues each with full context while the app runs); **restart best-effort** (transcripts always restored/readable; continuing resumes via Claude `sessionId` or replayed OpenAI/Gemini history; worst case the model context resets but the transcript is intact).
3. **Editions list features:** auto headline + date, rename, delete, search/filter.
4. **Layout:** left rail fully replaced by the Editions feed; old roster/builds/reset stats dropped (RightRail keeps counts); date-grouped (Today / Earlier); header with "+ New dispatch"; active row = red left border; hover reveals rename (✎) + delete (✕).
5. **Background-completion marker:** "✦ Hot off the press" kicker above the headline (option C), brightened title; clears on open.
6. **Storage:** single `conversations.json` in `userData` (file-per-conversation deferred unless scale demands it).

## Architecture

### 1. Data model

```ts
interface Conversation {
  id: string                 // uuid
  title: string | null       // null → use auto headline
  createdAt: string          // ISO
  updatedAt: string          // ISO
  turns: Turn[]              // transcript (existing Turn type, reused)
  provider: ProviderName     // provider that owns `session`
  session: {                 // for restart best-effort resume
    claudeSessionId?: string
    history?: unknown[]      // serialized OpenAI/Gemini message history
  }
  seenTurnCount: number      // completed turns the user has seen (marker logic)
}
```

**Auto headline:** lead headline (`splitHeadline(firstDoneAiTurn.agentText)`), else the first user line, else "Untitled dispatch". Display shows headline + `updatedAt` formatted date.

### 2. ConversationStore (main process) — `src/main/conversationStore.ts`

Owns `userData/conversations.json`. Atomic writes (tmp + rename), debounced. Pure of Electron beyond the path (constructor takes the file path) so it is unit-testable against a temp file.

API: `list()`, `get(id)`, `create(seed?)`, `saveTurns(id, turns)`, `saveSession(id, provider, session)`, `rename(id, title)`, `remove(id)`, `setActive(id)` / `getActiveId()`, `markSeen(id, count)`. Corrupt/missing file → empty list (never throws).

IPC (in `src/main/index.ts`, preload + `index.d.ts`): `conversations:list`, `:get`, `:create`, `:save-turns`, `:rename`, `:delete`, `:set-active`, `:mark-seen`. Search/filter is renderer-side over the listed records.

### 3. AgentService becomes conversation-aware — `src/main/agent.ts`

- `runTurn(conversationId, promptText, onEvent)`.
- Holds `Map<conversationId, ProviderAdapter>` — one live session per conversation. Get-or-create on demand; creation restores persisted `session` via `adapter.restoreSession(state)`.
- `ProviderAdapter` interface gains `serializeSession(): SessionState` and `restoreSession(state: SessionState): void`. Claude → `{ claudeSessionId }`; OpenAI/Gemini → `{ history }`. (`reset()` stays.)
- After each turn completes, AgentService persists that conversation's session via the store (`saveSession`), and the renderer persists the updated turns (`save-turns`).
- The `running` guard becomes **per-conversation** (`Set<conversationId>`), so a background conversation can finish while another is focused. (Optional: a global concurrency note — multiple in-flight turns are allowed across conversations.)
- Switching provider for a conversation whose stored session is from another provider → start fresh context for that conversation (documented; transcript preserved).

### 4. Renderer / UI

- **`Editions` component** replaces `LeftRail`: header ("Editions" + "+ New dispatch"), search box, date-grouped list (Today / Earlier via `updatedAt`). Row = serif-italic headline (auto or renamed) + `date · time · N dispatches` mono meta. Active = red left border + highlight. Hover reveals ✎ rename (inline text edit → `conversations:rename`) and ✕ delete (confirm → `conversations:delete`). "Hot off the press" kicker on rows flagged fresh.
- **App.tsx**: holds `conversations`, `activeId`, and the active conversation's `turns`. On mount, load conversations from the store (migrating `localStorage` once — see below) and select the active/most-recent. "New dispatch" → `conversations:create` then switch. Switching → `conversations:get` → load its turns; call `conversations:mark-seen`. `submit()` sends `runTurn(activeId, text)`. Turn updates persist via `conversations:save-turns` (debounced).
- The old `RailsProps`/`LeftRail` export is removed; `RightRail` unchanged.

### 5. "Hot off the press" marker

- Each conversation has `seenTurnCount`. The `agent:event` IPC payload is extended to carry the originating `conversationId` so the renderer can attribute a `done` event to the right edition even when it isn't active.
- When a `done` event arrives for a **non-active** conversation, its completed-turn count exceeds `seenTurnCount` → mark that edition fresh (kicker shown). Opening it calls `conversations:mark-seen` (set `seenTurnCount` = current completed count) and clears the marker.
- The active conversation is always considered seen.

### 6. Migration

On first load, if `localStorage['axivale.turns']` holds turns and the store is empty, create one conversation from them (title null, provider = current), set it active, then remove the `localStorage` key.

## Error handling

| Failure | Behavior |
|---|---|
| `conversations.json` missing/corrupt | Start with an empty list; next write recreates the file |
| Delete the active conversation | Fall back to the newest remaining; if none, create a fresh empty one |
| Restart resume fails (stale Claude session / provider change) | Transcript still shown; continuing starts fresh model context (no crash) |
| Concurrent turn in the *same* conversation | Rejected with the existing "turn already in progress" message (now per-conversation) |
| Save-turns write error | Logged; in-memory state unaffected; retried on next change |

## Testing

- **ConversationStore:** CRUD, atomic write, debounce flush, corrupt-file tolerance, `localStorage` migration, active-id tracking, `markSeen`.
- **AgentService:** per-conversation adapter map; `serializeSession`/`restoreSession` round-trip per provider; per-conversation running guard; persistence calls on completion.
- **Renderer `Editions`:** date grouping, search filter, rename, delete (+ active fallback), active-state styling, hot-off-the-press set on background `done` and clear on open.
- Vitest with `--maxWorkers=2`.

## Out of scope

- File-per-conversation storage (revisit only if users accumulate hundreds).
- Full faithful resume of OpenAI/Gemini tool-call history after restart beyond replaying stored messages.
- Cross-device / cloud sync of conversations.

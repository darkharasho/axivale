# Discord History + gw2skills Toolset — Design

**Date:** 2026-06-13
**Status:** Approved for planning
**Repos touched:** `axivale`, `axitools` (Python bot), `axiforge`

## Goal

Extend AxiVale's agent toolset so it can: read deep Discord channel/thread history (not just the last 100 messages) and filter it; decode a gw2skills.net link into a structured build **without** saving (to explain/critique/compare); reliably offer to rebuild a pasted gw2skills link in AxiForge; and export an AxiForge build as a shareable in-game chat code (which gw2skills.net accepts).

## Context (what already exists — do not rebuild)

- **Discord reading exists:** `discord_messages(channel_id, limit≤100)` returns the most recent N messages (newest first, no paging); `discord_overview` lists channels/roles/members/threads/events; `discord_action` does 28+ write verbs. AxiTools bot endpoint: `GET /guilds/{id}/discord/messages?channel_id=&limit=` → `channel.history(limit=N)` (`axitools/axitools/api/server.py:651`). Client: `AxitoolsClient.discordMessages(guildId, channelId, limit)`.
- **gw2skills import exists:** `axiforge_import_gw2skills(url)` builds the **complete** build in AxiForge (profession, traits, skills, full gear/runes/sigils/infusions/food/relic, Revenant legends, Ranger pets). AxiForge `importGw2SkillsBuild(url, name, folderId, gameMode)` (`axiforge/src/main/gw2skillsImport.js`) parses the page + db + chat link, then **always saves**. No standalone parse.
- **Chat-link export exists at the API level:** AxiForge local API `POST /builds/:id/chat-link` → `{ chatLink }`; `AxiforgeClient.buildChatLink(id)` exists but no AxiVale tool surfaces it.

## Decisions (from brainstorming)

1. Full feature set, including **AxiTools bot changes** (user implements Python, redeploys bot).
2. Discord **search** is a client-side filter over a bounded fetched window (Discord gives bots no true server search) — the cap is always surfaced, never silent.
3. gw2skills **parse** is read-only (no save); the existing import is unchanged.
4. Build **export** = the existing in-game chat code, which is also the gw2skills-compatible paste format.
5. Two implementation plans: (A) Discord history/search, (B) gw2skills parse + export. (One spec, two plans.)

## Architecture

### Part A — Discord deeper history + search

**A1. AxiTools bot (`axitools/axitools/api/server.py` `_handle_discord_messages`)**
- Accept optional `thread_id` (digits) — resolve via the guild's threads (active + archived as available); when present it is the channel read instead of `channel_id`. One of `channel_id`/`thread_id` required.
- Accept optional `before` and `after`, each either a message-id (digits) or an ISO-8601 date. Convert: id → `discord.Object(id=int)`; date → parsed `datetime` (UTC). Pass to `channel.history(limit=N, before=, after=)`.
- `limit` stays 1–100. Response shape unchanged (`id, author_id, author_name, content, created_at, pinned`) so existing callers keep working.
- Validation: non-digit/garbage `before`/`after` that isn't a parseable date → 400; missing thread/channel → 404.

**A2. AxiVale client (`src/main/axitoolsClient.ts`)**
- `discordMessages(guildId, { channelId?, threadId?, limit?, before?, after? })` — build the query string from the provided fields. (Keep the call ergonomic; the bot validates.)

**A3. AxiVale tools (`src/main/tools/discord.ts`)**
- Extend `discord_messages`: params `channel_id?`, `thread_id?`, `limit?` (≤100), `before?`, `after?` (message id or ISO date). Description explains paging: "to read older messages, call again with `before` set to the oldest id you got."
- New `discord_search`: params `channel_id?`/`thread_id?`, `query?` (substring, case-insensitive), `author?` (name or id), `from?`/`to?` (ISO dates), `max_messages?` (default 500, hard cap 1000). Pages the bot (≤100/page, ≤10 pages bounded by `max_messages`) newest→older, filtering in code. Returns `{ matches, scanned, reachedCap, oldestScannedAt }` so the model can say "scanned the last N; narrow by date for older." A compact result (no rich display — it's a list, per the established rule that listings stay action cards).

### Part B — gw2skills parse (read-only) + build export

**B1. AxiForge (`axiforge/src/main/gw2skillsImport.js`)**
- Refactor: extract `parseGw2Skills(url, { name?, gameMode? }) → build object` (the current lines that fetch/parse/decode/map, up to the normalized build) from the save step. `importGw2SkillsBuild` becomes `parseGw2Skills` + `buildStore.upsertBuild`. No behavior change to import.
- Local API: `POST /import/gw2skills/parse` body `{ url, gameMode? }` → returns the normalized build object (NOT saved). (Sits beside the existing `/import/gw2skills`.)

**B2. AxiVale client (`src/main/axiforgeClient.ts`)**
- `parseGw2Skills({ url, gameMode? })` → build object (uses the API; this is read-only so no auto-spawn-on-write — but it does need AxiForge running for the parse/catalog; on not-running, friendly error suggesting import-which-auto-starts, OR ensureRunning then retry. Decision: parse routes through the write/ensureRunning path since it needs the live catalog).

**B3. AxiVale tools (`src/main/tools/axiforge.ts`)**
- `gw2skills_parse(url, game_mode?)`: returns the structured build for the AI to explain/critique/compare; attaches a `build-card` display (read-only preview). Not destructive (no save).
- `axiforge_build_chat_link(build_id)`: over `AxiforgeClient.buildChatLink(id)` → `{ chatLink }`. Read-only; returns the in-game chat code (also pasteable into gw2skills.net).

### Part C — Discoverability / system prompt (`src/main/agent.ts`)

Add guidance:
- A gw2skills.net link → offer both: `gw2skills_parse` to explain/preview it, and `axiforge_import_gw2skills` to rebuild it in AxiForge (the latter auto-starts AxiForge). Don't silently do one when the user wanted the other.
- Reading Discord context: `discord_messages` returns recent first; to go older, page with `before` set to the oldest id. For "find where X said Y," use `discord_search` and report its scan cap honestly.
- Sharing a build: `axiforge_build_chat_link` produces a chat code the user can paste in-game or into gw2skills.net.

## Error handling

| Failure | Behavior |
|---|---|
| Bot: bad `before`/`after` (not id or ISO date) | 400 with a clear message |
| Bot: missing thread/channel | 404 |
| `discord_search` hits the cap before finding matches | Returns matches so far + `reachedCap: true` + oldest scanned timestamp; model tells the user to narrow by date |
| `gw2skills_parse` on an unsupported/invalid link | Friendly error (the existing importer's parse errors, surfaced — "couldn't read that gw2skills link") |
| AxiForge closed during parse | ensureRunning auto-start then retry (parse needs the live catalog); friendly error if it can't start |
| `axiforge_build_chat_link` on unknown id | 404 → friendly "no such build" |

## Testing

- **AxiTools** (pytest, the repo's runner): messages endpoint with `before`/`after` as id and as date; `thread_id` resolution; invalid params → 400; missing → 404.
- **AxiVale**: `axitoolsClient.discordMessages` query-string building (unit); `discord_search` paging+filter logic over a stubbed client (cap surfaced, author/substring filter, date bounds); `gw2skills_parse` + `axiforge_build_chat_link` tools over a stub client (display payload, never-throw); system-prompt assertions for the new guidance. Vitest `--maxWorkers=2`.
- **AxiForge** (jest): `parseGw2Skills` returns a complete build from the existing gw2skills fixtures **without** writing to the store; the import path stays green (now delegating to parse).

## Out of scope

- True server-side Discord message search (not available to bots).
- gw2skills.net build *directory* search (it's an editor for specific links, not a browsable build site — that's what the meta sources cover).
- Reactions/embeds/attachment metadata in Discord history (only id/author/content/created_at/pinned).

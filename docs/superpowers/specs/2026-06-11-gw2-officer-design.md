# GW2 Officer — Design Spec

**Date:** 2026-06-11
**Status:** Approved pending user review of this document

## Summary

GW2 Officer is a standalone Electron desktop chat app — a "virtual officer" for a
Guild Wars 2 guild and its Discord server. The user chats with a Claude agent that
has real tools: it manages builds and composition presets/schedules through the
axitools Discord bot, and inspects the guild roster and activity log through the
official GW2 API using the user's API key.

Single-user desktop app. Runs on the same machine as the axitools bot (the
integration API is localhost-only).

## Decisions

| Decision | Choice |
|---|---|
| Axitools integration | New local HTTP API inside the axitools bot process (user-selected) |
| Claude auth | Claude subscription OAuth login only (user-selected); no Anthropic API key path |
| MVP scope | Builds + comps management, GW2 roster/log tools, chat UI (user-approved) |
| Later phases | Discord actions (announce, audit, role sync), dashboard panels |
| UI bar | Chat-first experience, GW2-themed, high visual quality (user requirement) |

## Architecture

Three pieces:

### 1. Electron app (`gw2-officer`, this repo)

Stack: Electron + React + TypeScript + Vite. Tests with Vitest (maxWorkers=2).

**Main process**
- Hosts the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`). The agent loop
  runs here; custom MCP tools are registered in-process via `createSdkMcpServer`
  (no separate MCP server process).
- Claude subscription OAuth flow (same mechanism as Claude Code login).
- Secret storage via Electron `safeStorage` (OS keychain-backed): Claude OAuth
  token, GW2 API key, axitools API bearer token.
- HTTP clients: axitools API client (localhost), GW2 API client
  (`https://api.guildwars2.com/v2`).

**Renderer (chat UI)**
- Chat-first: message stream with streaming responses, markdown rendering.
- Tool-call cards: each agent tool invocation renders as a styled card showing
  what happened (e.g. "Updated build: Firebrand — Quickness Support"), with
  expandable detail.
- Confirm dialog before destructive tool calls (delete build / delete preset)
  executes.
- Settings screen: Claude sign-in, GW2 API key entry + validation (shows account
  name and key permissions), axitools API URL + token, guild selection.
- **Visual design requirement:** the app must look and feel like Guild Wars 2 —
  dark fantasy aesthetic, GW2-style accents (parchment/gold/crimson palette,
  profession colors), profession icons (assets available in the sibling
  `gw2-class-icons` repo / axitools `media/gw2classicons/`). Production-grade
  polish, not a generic chat scaffold. The frontend-design skill governs
  implementation.

**IPC:** renderer ↔ main over Electron IPC: send user message, receive streamed
agent events (text deltas, tool start/result), settings get/set, confirm-dialog
resolution.

### 2. Axitools local API (new module in the axitools repo)

A small aiohttp HTTP server running inside the existing bot process:
- Binds to `127.0.0.1` only; bearer-token auth (token generated on first run,
  printed/stored for the user to paste into GW2 Officer's settings).
- Calls axitools' existing `storage.py` layer directly, so reads/writes go
  through the same code paths as the slash commands — no file conflicts with the
  running bot.

MVP endpoints:
- `GET /guilds` — Discord guilds the bot serves
- `GET/POST/PUT/DELETE /guilds/{id}/builds`
- `GET/POST/PUT/DELETE /guilds/{id}/comp-presets`
- `GET/POST/PUT/DELETE /guilds/{id}/comp-schedules`
- `GET /guilds/{id}/config`

Phase 2 endpoints:
- `POST /guilds/{id}/announce` — post to a channel via the bot
- `GET /guilds/{id}/audit` — query Discord/GW2 audit events
- Role-sync operations

Tested with pytest against axitools' existing storage fixtures.

### 3. MCP toolset (registered inside the Electron main process)

Axitools-backed tools:
- `axitools_builds_list / add / edit / delete`
- `axitools_comps_list / create / edit / delete` (presets and schedules)

GW2-API-backed tools (use the stored user key directly):
- `gw2_account_info` — validate key, show account name + permissions
- `gw2_guild_members` — roster with ranks and join dates
- `gw2_guild_log` — invites, kicks, rank changes, stash/treasury activity

The GW2 key needs `account` + `guilds` permissions; the app validates on entry
and reports missing scopes.

## Data flow (example)

User: "swap the Tuesday comp's scourge slot to spellbreaker"
→ agent calls `axitools_comps_edit`
→ main process PUTs to the axitools API
→ axitools updates `comp_presets.json` via its storage layer
→ the bot's next scheduled post reflects the change
→ agent confirms in chat with exactly what changed.

## Error handling

- Axitools API unreachable (bot offline): tools return a structured error; the
  agent tells the user the bot is down rather than guessing.
- GW2 API failures: surface the real reason in chat (invalid key, missing
  permission, HTTP 429 rate limit).
- Destructive writes (deletes) require an in-UI confirmation before the tool
  executes.

## Phases

1. **MVP:** Electron chat app + Claude subscription auth + settings; axitools
   API module (builds/comps/config endpoints); the MCP toolset above; GW2-themed
   chat UI.
2. **Discord actions:** announcements, audit queries, role sync (new axitools
   endpoints + matching MCP tools).
3. **Dashboard panels:** live roster/builds/comps side panels alongside chat.

## Testing

- Vitest (`--maxWorkers=2`) for MCP tools and HTTP clients with mocked servers.
- pytest for the axitools API module.
- Manual end-to-end against the real bot and a real GW2 API key.

## Open assumptions (flag if wrong)

- The axitools bot runs on the same machine as GW2 Officer.
- One primary Discord guild is being managed (the UI has a guild selector, but
  the experience is designed around one).

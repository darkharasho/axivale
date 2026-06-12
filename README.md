# GW2 Officer

A standalone Electron chat app — a **virtual officer** for your Guild Wars 2
guild and Discord. You chat with a Claude agent ("The Officer") that has real
tools: it manages builds and squad-composition presets/schedules through the
[AxiTools](../axitools) Discord bot, and inspects your guild roster and
activity log through the official GW2 API.

The UI is a dark-newsprint broadsheet: your messages are clippings from the
Commander's desk, the agent's replies are filed articles, and every tool call
renders as a clip-out coupon.

## Prerequisites

1. **AxiTools bot** running on the same machine, from a checkout that includes
   the local API module (branch `gw2-officer-api` or later). The bot serves a
   localhost-only API on port 8642 and writes a bearer token to
   `<data root>/api_token` on first run.
2. **Claude subscription auth** — either this machine already has a Claude Code
   login, or run `claude setup-token` and paste the token into Settings.
3. **GW2 API key** with `account` and `guilds` permissions
   (create one at <https://account.arena.net/applications>).

## Setup

```bash
npm install
npm run dev
```

Then in the app, open **05 · Settings**:

1. **Claude** — paste a `claude setup-token` token, or leave empty to use the
   machine's existing Claude Code login.
2. **GW2 API key** — paste and *Save & Verify*; pick your GW2 guild from the
   detected list.
3. **AxiTools** — confirm the URL (`http://127.0.0.1:8642`), paste the token
   from the bot's `data/api_token` file, *Test connection*, and pick the
   Discord guild.

Switch to **01 · Dispatches** and file your orders — e.g. *"list our builds"*,
*"swap the Tuesday comp's scourge slot to spellbreaker"*, or *"who joined the
guild this week?"*. Deleting builds or presets pops a **Notice of Destruction**
that you must approve before the agent proceeds.

All secrets are encrypted at rest with the OS keychain (Electron `safeStorage`).

## Development

```bash
npm test           # vitest (capped at 2 workers)
npm run typecheck  # tsc, main + renderer projects
npm run build      # electron-vite production build
```

Design docs live in `docs/superpowers/specs/` (including the approved UI mock,
`2026-06-11-gazette-mock.html`) and the implementation plan in
`docs/superpowers/plans/`.

## Architecture

- **Main process** hosts the Claude Agent SDK (`query()`); the officer toolset
  is an in-process MCP server (`createSdkMcpServer`). Destructive tools are
  excluded from `allowedTools` so they route through a `canUseTool` confirm
  gate wired to the renderer dialog.
- **AxiTools local API** (in the bot, `axitools/api/server.py`): localhost-only
  aiohttp server over the bot's own storage layer — the app and the Discord
  slash commands share one source of truth.
- **Renderer**: React, no state library; agent events stream over IPC and fold
  into the newspaper article for the active turn.

# Multi-server Discord: agent-routed actions + webhook routing

**Date:** 2026-06-19 (revised — supersedes the earlier swap-based draft)
**Repos:** axiforge (bot/desktop), axivale (officer app)

## Goal

Stop requiring the user to "swap" the active Discord. All saved AxiVale Discord
servers are reachable at once; the agent routes each action to the right server —
inferring from the request, and **asking the user when it's ambiguous**. Sharing a
comp/build posts to the AxiForge webhook(s) tied to the **chosen** server.

## Decisions (settled in brainstorming)

- All guild-scoped Discord/AxiTools tools become **server-targeted** (Discord-only;
  GW2 keeps its current switcher for now).
- Resolution: `server` given → match a saved key; omitted + exactly one server →
  use it; omitted + multiple → **error listing servers** so the agent asks the user.
- Webhook routing per server (comp **and** build), multiple webhooks per server.
- No webhook tied for the chosen server → **fail** with a clear error.
- The header switcher stays only as a **UI viewing selector** for panels
  (Roster/Operations); it no longer constrains the agent. (v0.11.6 masthead fix
  still applies to it.)

## Key fact

Each AxiVale key is bound to one Discord server (its token is guild-scoped). So
"target a server" = "use that server's key." We must build an `AxitoolsClient`
from a *specific* saved key, not just vary the guild id on one client.

## AxiVale

### Server resolution (new, central)
- `ToolDeps.axivaleServers(): Array<{ label, name, guildId }>` — derived from the
  AxiVale keyring (`listKeyLabels('axivale')` + cached `meta {name,id}`).
- `ToolDeps.resolveAxitoolsServer(server?: string): { client: AxitoolsClient; guildId: string; name: string; label: string }`
  - `server` set: match against saved keys by `label` or `meta.name`
    (case-insensitive, trimmed). 0 matches → throw listing valid servers; >1 → throw
    listing the matches.
  - `server` unset: 1 saved key → use it; 0 → throw "no Discord server configured";
    >1 → throw `Multiple Discord servers connected (DEFI, EWW). Pass `server` to pick one.`
  - Builds the client from that key (`buildAxitoolsFor(keyMaterial)` in index.js).
- `buildAxitools()` (active-key) is kept only for the masthead/status path; tools
  use `resolveAxitoolsServer`.

### Tool changes
- Every guild-scoped tool gains optional `server: z.string()` and replaces
  `requireDiscordGuild(deps)` + `deps.axitools` with
  `const { client, guildId } = deps.resolveAxitoolsServer(server)`:
  `discord_action`, `discord_messages`, `discord_overview`, `axitools_builds_*`,
  `axitools_comp_presets_*`, `axitools_comp_schedules_*`, `axitools_audit`,
  `axitools_rss`, `axitools_streams`, `axitools_alliance`, `axitools_guild_roles`,
  `axitools_members`, `axitools_config`, `axitools_key_holders`.
- New `discord_servers` tool → `deps.axivaleServers()` so the agent can enumerate
  servers to ask the user. (Read-only.)
- Agent guidance (`agent.ts`): "Each Discord tool takes a `server`. Infer it from
  the request; if multiple servers are connected and the user didn't say which,
  ask them (use `discord_servers`). One server → it's automatic."

### Webhook tie + sharing
- AxiForge side (multi-webhook + HTTP) per "AxiForge" section below.
- AxiVale client: `listDiscordWebhooks()` → `{ comp: WebhookRef[]; build: WebhookRef[] }`
  (`GET /discord/webhooks`); `shareCompToDiscord(id, webhookIds?)` /
  `shareBuildToDiscord(id, webhookIds?)` (POST `{ webhook_ids }`).
- Tie storage: AxiVale setting `discordWebhookTie` =
  `{ [keyLabel]: { comp: string[]; build: string[] } }`. IPC `discord-tie:get/set`.
  `ToolDeps.discordWebhookTie(label)` reads one entry.
- `axiforge_comp_share_discord` / `axiforge_build_share_discord` gain `server`:
  1. `{ label } = deps.resolveAxitoolsServer(server)`.
  2. `ids = deps.discordWebhookTie(label).{comp|build}`.
  3. empty → throw "No Discord webhook is tied to '<name>' — set one in Settings (05)."
  4. else `write(() => deps.axiforge.shareCompToDiscord(comp_id, ids))`; return
     `{ success, results }` so the agent reports which servers got it.
  Still non-destructive + confirmation-gated.
- Settings UI: per AxiVale key, two multiselects (comp / build webhooks) from
  `listDiscordWebhooks()`, saved into `discordWebhookTie[label]`. If the list call
  fails (AxiForge closed/old), show a hint instead of selectors.

## AxiForge

### Webhook model (generalize the started comp-webhook work)
- `compWebhooks.js` → `discordWebhooks.js`, kind = `comp | build`:
  - settings `discord.compWebhooks` and new `discord.buildWebhooks`: arrays of
    `{ id, name, url, threadMode, threadId }`.
  - `getWebhooks(store, kind)` migrates that kind's legacy single webhook into a
    one-entry `[{ id, name: "Default", … }]` list, persisted (idempotent):
    - comp: `discord.webhookUrl` (+ `discord.threadMode` / `discord.threadId`)
    - build: `discord.buildWebhookUrl` (+ `discord.buildThreadMode` / `discord.buildThreadId`)
  - `shareToWebhooks(webhooks, ids, shareOne)` → `{ success, results: [{id,name,success,error?}] }`.
- `discord:share-build(buildId, webhookIds)` → multi-webhook; add `discord:list-build-webhooks`.

### HTTP API
- `GET /discord/webhooks` → `{ comp: [{id,name}], build: [{id,name}] }`.
- `POST /comps/:id/share-discord` and `/builds/:id/share-discord` read
  `{ webhook_ids?: string[] }` → forward via `invokeLocal(..., id, webhook_ids)`.
- ops: `listDiscordWebhooks()` + the two share ops forward `webhook_ids`.

## Error handling / edges
- Ambiguous/unknown server → thrown error names the valid servers (agent asks/retries).
- Old AxiForge (no `/discord/webhooks`) → 404 → "update AxiForge to the build with
  webhook routing."
- Tied webhook id removed in AxiForge → filtered out; if none remain, share returns
  `{ success:false }`, surfaced to the agent.
- A server whose live key is offline → its tool calls surface AxitoolsError as today.

## Testing
- **AxiVale:** `resolveAxitoolsServer` (given/one/zero/multiple, label vs name match,
  unknown); `axivaleServers`; one representative guild-scoped tool threading `server`
  end-to-end (e.g. `discord_overview`); `discord_servers`; webhook tie resolution
  (chosen server → ids; empty → throw); client `listDiscordWebhooks` + share-with-ids;
  inventory snapshot (new `discord_servers`, `server` params), destructive list
  unchanged.
- **AxiForge:** `discordWebhooks` module (per-kind migration + multi targeting); the
  HTTP routes (forward `webhook_ids`, `GET /discord/webhooks` shape); share-build multi.

## Out of scope
- GW2 accounts/guilds keep the current switcher (could adopt the same pattern later).
- No free-form per-message webhook override (the tie drives targets).

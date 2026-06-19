# Per-server Discord webhook routing for AxiForge shares

**Date:** 2026-06-19
**Repos:** axiforge (bot/desktop), axivale (officer app)

## Goal

AxiForge can hold multiple Discord webhooks so a comp/build can be posted to
several Discord servers. AxiVale ties each of its Discord keys (DEFI, EWW, …) to
a specific webhook (or webhooks). When the agent shares a comp/build, it posts to
the webhook(s) tied to the **currently-active** AxiVale Discord server.

## Decisions

- **Tie location:** per AxiVale key, configured in AxiVale (option 1).
- **Scope:** comps **and** builds.
- **No tie configured for the active key:** fail with a clear error (do not post).
- **Cardinality:** a key may map to **multiple** webhooks per kind.

## AxiForge changes

### Webhook model (already started, generalize)
- `compWebhooks.js` → `discordWebhooks.js`, parameterized by kind `comp | build`:
  - settings `discord.compWebhooks` and new `discord.buildWebhooks`, each an array
    of `{ id, name, url, threadMode, threadId }`.
  - `getWebhooks(store, kind)` migrates that kind's legacy single webhook into a
    one-entry `[{ id, name: "Default", … }]` list, persisted (idempotent):
    - comp: `discord.webhookUrl` (+ `discord.threadMode` / `discord.threadId`)
    - build: `discord.buildWebhookUrl` (+ `discord.buildThreadMode` / `discord.buildThreadId`)
  - `shareToWebhooks(webhooks, ids, shareOne)` (existing `shareCompToWebhooks`,
    renamed/kind-agnostic): targets `ids` (or all when null/empty), returns
    `{ success, results: [{ id, name, success, error? }] }`.

### IPC
- `discord:share-build(buildId, webhookIds)` → multi-webhook (mirror share-comp).
- `discord:list-build-webhooks()` → `[{ id, name }]`.

### HTTP API (the surface AxiVale uses)
- `GET /discord/webhooks` → `{ comp: [{id,name}], build: [{id,name}] }`.
- `POST /comps/:id/share-discord` reads `{ webhook_ids?: string[] }` →
  `invokeLocal("discord:share-comp", id, webhook_ids)`.
- `POST /builds/:id/share-discord` reads `{ webhook_ids?: string[] }` →
  `invokeLocal("discord:share-build", id, webhook_ids)`.
- ops: `listDiscordWebhooks()`, and the two share ops forward `webhook_ids`.

## AxiVale changes

### Client (`axiforgeClient.ts`)
- `listDiscordWebhooks(): Promise<{ comp: WebhookRef[]; build: WebhookRef[] }>` —
  `GET /discord/webhooks` (timeout ~10s). `WebhookRef = { id, name }`.
- `shareCompToDiscord(id, webhookIds?: string[])` / `shareBuildToDiscord(id, webhookIds?)`
  — POST `{ webhook_ids }` (existing SHARE_TIMEOUT_MS). Resolves
  `{ success, results }`; non-2xx surfaces AxiforgeError as today.

### The tie (storage + IPC)
- New AxiVale setting `discordWebhookTie`:
  `{ [axivaleKeyLabel]: { comp: string[]; build: string[] } }`, keyed by the
  AxiVale Discord key label (what the user switches between).
- IPC `discord-tie:get` / `discord-tie:set` (whole-map get; set one key's entry).

### Settings UI
- In the AxiVale-key section of Settings, each saved key shows two multiselects —
  **comp webhooks** and **build webhooks** — populated from `listDiscordWebhooks()`.
  Saving writes that key's entry in `discordWebhookTie`. Empty selection = no tie.
- If `listDiscordWebhooks` fails (AxiForge closed/old), show a hint to open/update
  AxiForge instead of the selectors.

### Tools (`tools/axiforge.ts`)
- `axiforge_comp_share_discord` / `axiforge_build_share_discord`:
  1. Resolve the **active** AxiVale key label + its server name.
  2. `ids = discordWebhookTie[activeLabel]?.{comp|build} ?? []`.
  3. If `ids` is empty → throw: *"No Discord webhook is tied to the active server
     '<name>' — tie one in Settings (05)."*
  4. Else `write(() => deps.axiforge.shareCompToDiscord(comp_id, ids))`.
  5. Return the `{ success, results }` so the agent can report which servers got it.
- Still confirmation-gated and **non-destructive** (unchanged lists).
- Agent guidance (`agent.ts`): note that sharing posts to the webhook(s) tied to
  the active Discord server, and that an untied server errors until set in Settings.

## Error handling / edges
- Old AxiForge (no `/discord/webhooks` / ignores `webhook_ids`): list 404 → tools
  report "update AxiForge to the build that adds webhook routing."
- A tied webhook id that no longer exists in AxiForge: AxiForge filters it out;
  if nothing remains it returns `{ success:false, … }`, surfaced to the agent.
- Partial success (some webhooks fail): `results` lists per-webhook outcome.

## Testing
- **AxiForge:** `discordWebhooks` module (per-kind migration + multi targeting),
  the two HTTP routes (forward `webhook_ids`, 404 for unknown id), `GET
  /discord/webhooks` shape, share-build multi.
- **AxiVale:** client `listDiscordWebhooks` + share-with-ids (incl. 400/404
  passthrough); tie resolution (active key → ids; empty → thrown error); settings
  IPC get/set round-trip. Inventory/destructive snapshots unchanged.

## Out of scope
- No per-message webhook override from the agent (tie drives it); the agent always
  posts to the active server's tie. Manual override can come later if needed.

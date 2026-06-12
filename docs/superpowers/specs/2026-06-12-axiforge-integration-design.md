# AxiForge Integration — Design

**Date:** 2026-06-12
**Status:** Approved for planning
**Repos touched:** `axivale` (this repo), `axiforge` (sibling, `../axiforge`)

## Goal

AxiVale's AI can view, edit, create, delete, and publish builds and comps in AxiForge, grounded in current GW2 knowledge (official API, GW2 wiki, and meta sites: gw2mists, guildjen, hardstuck, metabattle), and renders rich inline visuals in chat — real build/comp cards with skill icons, trait lines, and hover cards matching AxiForge's design.

## Context

- AxiVale tools are `SdkMcpToolDefinition`s built in `src/main/tools.ts` (`buildOfficerTools()`), exposed via an in-process MCP server and translated per provider (Claude/Gemini/OpenAI/local). Destructive tools route through a UI confirm dialog (`DESTRUCTIVE_TOOLS`, `src/main/providers/permission.ts`).
- AxiForge is a vanilla-JS Electron app. Builds/comps live in its userData dir (`.../AxiForge/data/builds.json`, `comps.json`, `folders.json`) behind store modules (`src/main/buildStore.js`, `compStore.js`) with atomic writes, write queues, build history, and GitHub publish/sync. All ~76 operations are Electron IPC handlers — no external API today.
- AxiForge's build/comp rendering (`src/site/render-build.js`, `render-comp.js`, `src/renderer/modules/mini-build-card.js`, `detail-panel.js` hover previews) is framework-free vanilla HTML generation taking `(build, catalog)` — reusable outside AxiForge.
- axiom (`../axiom`) contains install-detection (`electron/detect.ts`) and launch logic (`electron/ipc-handlers.ts`) for all Axi apps, per platform.

## Decisions (made during brainstorming)

1. **Transport: local API in AxiForge** (not direct file writes). Reads fall back to direct file reads when AxiForge is closed; writes require the API.
2. **Meta knowledge: live fetch tools** with local cache (no bundled snapshot dataset).
3. **Headless mode** added to AxiForge (`--headless`: services + local API, no window). AxiVale auto-spawns headless AxiForge when a write is requested and the API is down.
4. **Inline rich rendering** via a typed `display` payload on tool results; AxiForge card renderers extracted into a shared package.

## Architecture

### 1. AxiForge side: local API server (changes in `../axiforge`)

New module `src/main/localApi.js`:

- Plain Node `http` server, bound to **127.0.0.1 only**, random free port, started with the app.
- **Auth/discovery:** on startup, write `<userData>/data/local-api.json` containing `{ port, token, exePath, version, pid }`. Token is random per launch. All requests require `Authorization: Bearer <token>`. AxiVale discovers the server by reading this file (zero user setup; the file is only readable by processes that could read `builds.json` anyway). Delete/invalidate the file on clean shutdown.
- Endpoints are thin wrappers over existing stores and handlers (validation, history, write queues, shared-library sync all preserved):
  - **Builds:** `GET /builds`, `GET /builds/:id`, `POST /builds` (create/update via `saveBuild`), `DELETE /builds/:id`, `POST /builds/:id/publish`, `POST /builds/:id/chat-link`
  - **Comps:** `GET /comps`, `GET /comps/:id`, `POST /comps`, `DELETE /comps/:id`, `POST /comps/:id/publish`, `GET /comps/:id/plaintext`
  - **Imports:** `POST /import/chat-link`, `POST /import/gw2skills`
  - **Catalog:** `GET /catalog/professions`, `GET /catalog/professions/:id?gameMode=`, `GET /catalog/upgrades`
  - **Folders:** `GET /folders`
  - **Health:** `GET /health` → `{ ok, version }`
- **Headless mode:** `--headless` CLI flag starts main-process services (stores, local API, shared-library sync) without creating a window. Optional tray icon with "Open AxiForge / Quit". A second non-headless launch (or tray click) opens the window in the same instance (single-instance lock).

### 2. AxiVale side: client + launcher

- `src/main/axiforgeClient.ts` (modeled on `axitoolsClient.ts`): reads the discovery file, typed methods per endpoint, distinguishes "not running" from request errors.
- **Read fallback:** when the API is unreachable, list/get for builds, comps, and folders read AxiForge's JSON files directly (read-only — concurrent reads are safe; writes never touch files directly). Catalog data is cached persistently in AxiVale after any successful API connection so cards/hover data work offline.
- **Write path:** if the API is down when a mutation is requested, auto-spawn headless AxiForge via `src/main/axiAppLauncher.ts`, then retry.
- `src/main/axiAppLauncher.ts`: ported from axiom's `detect.ts` + launch handler. Executable resolution order: (1) `exePath` from the discovery file, (2) axiom-style platform detection (Windows: PowerShell registry query for InstallLocation/DisplayIcon; Linux: `axiom-version` config-dir convention, Gear Lever metadata, AppImage filename scan). Spawn detached with `--headless` and a sanitized env (strip `VITE_DEV_SERVER_URL`, `ELECTRON_*`, `NODE_OPTIONS`; use `systemd-run --user --scope` on Linux where available, per axiom). Poll discovery file + `/health` until up (timeout ~15s) → friendly error if not installed/startable. *Future:* extract this + axiom's copy into a shared package; duplication accepted for v1.

### 3. Tools (registered in `buildOfficerTools()`)

`tools.ts` (~440 lines today) is split into modules as part of this work: `src/main/tools/axitools.ts`, `discord.ts`, `gw2.ts`, `axiforge.ts`, `meta.ts`, `wiki.ts`, with `src/main/tools/index.ts` exporting `buildOfficerTools()` as the composition point (public shape unchanged).

New AxiForge tools:

| Tool | Notes |
|---|---|
| `axiforge_builds_list` | compact listing (id, title, profession, tags, folder, updatedAt) |
| `axiforge_builds_get` | full build; attaches `build-card` display |
| `axiforge_builds_save` | create/update; result attaches updated `build-card` |
| `axiforge_builds_delete` | **destructive** |
| `axiforge_comps_list` / `axiforge_comps_get` | get attaches `comp-card` display |
| `axiforge_comps_save` | |
| `axiforge_comps_delete` | **destructive** |
| `axiforge_build_publish` / `axiforge_comp_publish` | **destructive** (publishes publicly); returns share URL |
| `axiforge_import_chat_link` / `axiforge_import_gw2skills` | |
| `axiforge_catalog` | profession/trait/skill/upgrade lookups for grounding edits |

Deletes and publishes join `DESTRUCTIVE_TOOLS` → existing confirm dialog.

### 4. GW2 meta knowledge tools (live fetch + cache)

`src/main/metaSources/` — one parser module per site behind a common interface `{ search(filters), getBuild(url) }`, plus a shared disk cache (TTL ~12–24h):

- **metabattle** — MediaWiki API (structured; most reliable)
- **gw2mists** — site fetch/parse (WvW builds & ratings)
- **hardstuck**, **guildjen** — HTML fetch + parse of build/guide pages

Tools: `meta_search_builds(profession?, mode?, role?, site?)` → compact listings; `meta_get_build(url)` → normalized summary (traits, skills, gear, role notes, source URL), attaching a `build-card` display when parsed data is complete enough, plain summary otherwise. A broken parser degrades to "site unavailable" for that site only.

### 5. GW2 wiki tool suite

Against `https://wiki.guildwars2.com/api.php` (same approach as AxiForge `src/main/gw2Data/wiki.js`), cached like meta sources:

- `gw2wiki_search(query)`
- `gw2wiki_page(title)` — summary + key facts
- `gw2wiki_lookup(type, name)` — skills/traits/items/relics

Together with the existing `gw2_api` passthrough this forms the base knowledge layer.

### 6. Inline rich rendering (shared infrastructure — also used by AxiBridge spec)

- Extend the `tool-result` `AgentEvent` with optional `display: { kind, data }`. Attached by tool handlers in the main process → provider-agnostic. The model still receives compact JSON text; the renderer receives the rich payload.
- `ToolCoupon.tsx` renders a typed rich block when `display` is present:
  - `build-card` / `comp-card` — AxiForge visuals
  - `chart` — line/bar/area spec rendered with Recharts, styled to the newspaper theme
  - `table` — explicit columns/rows with sorting
- **`@axiapps/forge-render`** — new workspace package in the AxiForge repo (house pattern: `packages/axicode`, `packages/gw2-data`) exporting `renderMiniBuildCard`, the build/comp page renderers, the hover-preview module, and their CSS scoped under a wrapper class. AxiVale consumes it via a `<ForgeCard>` React wrapper rendering into a ref'd div. Icons: bundled profession SVGs (`gw2-class-icons`) + `render.guildwars2.com` URLs, exactly as AxiForge does today.
- Catalog data for cards/hover facts comes from the local API catalog endpoints (cached persistently).

### 7. Error handling & system prompt

- AxiForge unreachable (and unspawnable) → tools return a friendly actionable error string, never throw to the provider.
- System prompt additions: describe AxiForge capabilities; require grounding build choices in catalog/wiki/meta tools rather than model memory (GW2 balance changes invalidate training data); explain that destructive AxiForge actions confirm via dialog.
- Settings UI: AxiForge connection indicator (green when `/health` responds; "file-only" state when reading from disk fallback).

## Error handling summary

| Failure | Behavior |
|---|---|
| AxiForge closed, read requested | Direct file read fallback (silent, indicator shows "file-only") |
| AxiForge closed, write requested | Auto-spawn headless → retry; on failure, actionable error |
| AxiForge not installed | Error suggests installing via axiom |
| Stale discovery file (app crashed) | `/health` fails → treat as closed; overwrite on next AxiForge start |
| Meta site redesign breaks parser | That site returns "unavailable"; others unaffected |
| Wiki/API rate limits | Cache + existing request-queue pattern (max ~3 concurrent) |

## Testing

- `axiforgeClient`: unit tests against a stub HTTP server + fixture discovery file; file-fallback tests against fixture `builds.json`/`comps.json`.
- Meta parsers: fixture HTML/API responses checked in; parser unit tests (no live network in CI).
- Display payloads: unit-test that tool handlers attach well-formed `display` objects; `ToolCoupon` rendering tests for each kind.
- AxiForge local API: tests in the axiforge repo against temp-dir stores.
- Vitest with `--maxWorkers=2` per global instructions.

## Out of scope (this spec)

- AxiBridge integration (separate spec, same date).
- Shared launcher package extraction (axiom + AxiVale dedup) — noted as future work.
- Auto-launching the *windowed* AxiForge UI from chat.

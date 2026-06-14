# Meta Phase 2a — Structured Build Cards (chat-code → ForgeBuild → card) — Design

**Status:** Approved (design)
**Date:** 2026-06-14
**Part of:** Phase 2, final slice (after 2b `gw2_wiki_facts`). 2c/2d were dropped during brainstorming.

## Goal

Let the AI render an **exact build card** for a meta build by decoding the in-game
build-template **chat code** found in scraped meta text (`[&DQ…]`) into a structured
`ForgeBuild` and displaying it with the existing build-card renderer. The AI calls
this when it wants to show a specific recommended build visually, placing the card
inline via the existing `{{figure}}` mechanism.

## Background / grounding

- **Card rendering already exists end-to-end**: `DisplayPayload {kind:'build-card', data:{build}}` → `RichDisplay` → `ForgeCard` → `@axiapps/forge-render`'s `renderMiniBuildCard`. Give it a `ForgeBuild`, it renders. No renderer changes.
- **The decode gap**: AxiForge can turn a chat code into a `ForgeBuild` via `importChatLink` (`POST /import/chat-link`) — but that **saves** it to the user's library. There is a no-save *parse* endpoint only for gw2skills URLs (`POST /import/gw2skills/parse` → `ops.parseGw2Skills`), **not** for raw chat codes. Saving every scraped meta build into the user's AxiForge library is unacceptable, so we add a no-save chat-code parse.
- **Chat codes are present in the corpus for MetaBattle** (confirmed: the rendered scrape of MetaBattle Build: pages contains `[&DQ…]`). Snowcrows hides its code behind a JS button; Hardstuck has none.

## Scope

- **In:** MetaBattle builds (chat codes in scraped text). A no-save chat-code parse endpoint in AxiForge + an AxiVale tool that decodes a chat code and renders the build card.
- **Out:** Snowcrows (code behind a JS "Build Template" button — future), Hardstuck (no codes, ever). No build-name→code lookup/ingestion (the AI passes the code it already has from `meta_search`).

## Architecture (cross-repo)

### Part 1 — AxiForge desktop app (`/home/mstephens/Documents/GitHub/axiforge`)

The chat-code decoder already exists (it backs `importChatLink`). Factor the decode
out of the save path and expose a no-save variant.

- **`ops.parseChatLink(link, gameMode)`** — decode a chat link into a build object
  **without saving** (no id assigned, not persisted). Implemented by reusing the
  existing chat-link decode that `ops.importChatLink` uses, minus the persist step
  (mirrors the `parseGw2Skills`/`importGw2Skills` split). Returns the same build
  shape `parseGw2Skills` returns.
- **Route** in `src/main/localApi.js` (Imports section): `POST /import/chat-link/parse`
  → validates `{ link }` is a non-empty string (400 otherwise, matching
  `/import/chat-link`) → `return ops.parseChatLink(body.link, body.gameMode ?? undefined)`.
- Runs from source in the dev launcher, so no AxiForge release is needed for dev;
  a packaged AxiForge release would be needed before a packaged AxiVale ships this.

### Part 2 — AxiVale (`/home/mstephens/Documents/GitHub/axivale`)

- **`AxiforgeClient.parseChatLink({ link, gameMode? }): Promise<ForgeBuild>`**
  (`src/main/axiforgeClient.ts`) — `POST /import/chat-link/parse` with
  `{ link, gameMode? }`. Mirrors the existing `parseGw2Skills` client method
  (read-only preview; throws `AxiforgeNotRunningError` when AxiForge is down, like
  its sibling).
- **Tool `gw2_build_card({ chat_code, game_mode? })`** in `src/main/tools/axiforge.ts`
  (alongside `gw2skills_parse`, reusing that file's `write` helper + `stripImages`):
  ```
  write(() => deps.axiforge.parseChatLink({ link: chat_code, gameMode: game_mode }))
  ```
  wrapped in `safeRich`:
  ```ts
  { value: stripImages(build), display: { kind: 'build-card', data: { build } } }
  ```
  - `write()` auto-starts AxiForge if it isn't running (existing pattern).
  - Non-destructive (a preview) → NOT added to `DESTRUCTIVE_TOOLS`/`ACTION_GATED_TOOLS`.
  - Registered via `buildAxiforgeTools` (no new `ToolDeps`).
- **Prompt bullet** (`src/main/agent.ts` `AXIVALE_SYSTEM_PROMPT`, sentences single-line
  to protect prompt regex tests):
  > When meta_search surfaces a build that includes an in-game chat code ([&…], common on MetaBattle), you may call gw2_build_card with that code to render the exact build card.
  > Place it inline with a {{figure}} marker to illustrate a specific recommended build; don't dump a card for every build.

## Data flow

AI answers a build question → `meta_search` returns a MetaBattle passage containing
`[&DQ…]` → AI calls `gw2_build_card(code)` → AxiVale `parseChatLink` → AxiForge
`/import/chat-link/parse` decodes (no save) → `ForgeBuild` → `safeRich` emits a
`build-card` display → `ForgeCard`/`renderMiniBuildCard` renders it → AI places it
inline with `{{figure}}`.

## Error handling

- Invalid/garbage chat code → AxiForge decode error → `safeRich()` returns a clean
  tool error; never throws into the turn.
- AxiForge not installed/reachable → `write()` calls `ensureRunning()`; on failure the
  existing friendly `AxiforgeError` surfaces (same as `gw2skills_parse` today).
- `stripImages` keeps the model-context JSON lean; the full build (with images) only
  rides the `display` payload to the renderer.
- AxiForge `parseChatLink` does not persist — no library pollution even on repeated calls.

## Testing

### AxiForge repo
- Unit test for `ops.parseChatLink`: decodes a valid chat link to a build and does
  **not** save (no new entry in the store).
- `localApi.test.js`: `POST /import/chat-link/parse` returns the parsed build (not
  saved) and forwards `link` + `gameMode`; 400 when `link` is missing — mirroring the
  existing `/import/gw2skills/parse` tests.

### AxiVale repo
- `axiforgeClient.test.ts`: `parseChatLink` POSTs to `/import/chat-link/parse` with
  `{ link, gameMode }` and returns the build (mock fetch), mirroring the
  `parseGw2Skills` client test.
- `tools/axiforge.test.ts`: `gw2_build_card` with a fake `axiforge.parseChatLink` →
  asserts the result carries a `build-card` `display` payload with the build, and the
  model `value` is `stripImages`-reduced.
- `tools/inventory.test.ts`: add `gw2_build_card` to the tool-name snapshot.
- The real AxiForge round-trip is covered by the manual smoke test (needs AxiForge
  running), like `gw2skills_parse`.

## Manual smoke test (post-implementation)

With AxiForge installed: ask for a specific MetaBattle build (e.g. "show me the meta
Heal Firebrand build for WvW"). Confirm the AI pulls its `[&…]` code from
`meta_search`, `gw2_build_card` decodes it (AxiForge auto-starts), and a correct
build card renders inline. Confirm a garbage code returns a clean error and that no
new build appears in the AxiForge library.

## Dependencies / release notes

- No new npm dependencies.
- Requires the AxiForge change (the `/import/chat-link/parse` endpoint). In dev the
  launcher runs AxiForge from source so it's picked up immediately; a **packaged
  AxiForge release** is required before a packaged AxiVale build can use this in
  production (flagged for the eventual release, not blocking dev).

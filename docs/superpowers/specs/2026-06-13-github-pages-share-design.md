# GitHub Pages SPA Share — Design

**Date:** 2026-06-13
**Status:** Approved (pending spec review)

## Summary

A "share" feature for AxiVale, similar to how Cursor shares conversations. Users
can share either a **full conversation** or a **single AI response** via a public
link. AxiVale creates and manages a single GitHub Pages SPA in the user's own
GitHub account that renders shared content as a newspaper article. Shares can be
listed and deleted.

## Goals

- One-click share of a conversation or a specific response from hover controls.
- Public, unguessable links (security-through-obscurity, like Cursor / secret Gists).
- Shared pages reuse AxiVale's newspaper theme and read like a newspaper article.
- Users can manage (list + delete) their shares.
- No backend owned by us — everything lives in the sharer's own GitHub account.

## Non-goals

- Private/authenticated shares or access control (free GitHub Pages is public).
- Editing or commenting on shared content.
- Real-time/live-updating shares (a share is a point-in-time snapshot).

## Architecture

On the user's **first** share, AxiVale:

1. Ensures a public repo **`axivale-shares`** exists in the signed-in user's
   account (creates it if missing).
2. Commits the prebuilt **share-viewer SPA** bundle to the repo.
3. Enables GitHub Pages (source: `main` branch, root).

Every share (including the first) writes a single JSON file to
`shares/<id>.json` in that repo. Subsequent shares only add a JSON file — the
repo/Pages/viewer setup happens once.

- **Share URL:** `https://<user>.github.io/axivale-shares/#/s/<id>`
  - Hash routing (`#/s/<id>`) so GitHub Pages needs no SPA 404 fallback.
- **Share id:** ~20-character base62 string from a crypto RNG (unguessable,
  not listed or indexed anywhere).

## Share granularity

Two distinct entry points produce two share kinds:

- **Share conversation** → `kind: "conversation"`: the full transcript. Every
  turn is rendered as a user-prompt + AI-response exchange — a multi-section
  front-page story.
- **Share response** → `kind: "response"`: a single AI message, standalone, with
  no user prompt — a standalone column.

## The share-viewer SPA

A new self-contained source directory **`share-viewer/`** builds a small
Vite/React static bundle.

- **Reuses the newspaper theme**: the relevant article styles from
  `src/renderer/src/theme.css` and the same `react-markdown` rendering pipeline
  AxiVale uses for AI responses, so a share looks like AxiVale.
- **Self-contained**: bundles its own React + markdown deps; no runtime calls to
  AxiVale or any backend. It fetches only `shares/<id>.json` relative to its base.
- **Rendered elements**: masthead (AxiVale), headline (conversation title or the
  response's lede), dateline ("Filed June 13, 2026"), byline ("By AxiVale"),
  article body, end-mark (∎). Conversation shares render multiple article
  sections; response shares render one.
- **Distribution**: built at AxiVale build time and bundled into the app's
  resources. The publisher pushes it to the repo on first share and re-pushes it
  when the bundled viewer version is newer than the version recorded in the repo
  (a `viewer-version` marker file in the repo).

## Data model — sanitized share doc

Written to `shares/<id>.json`:

```jsonc
{
  "v": 1,
  "id": "9fK2…",
  "kind": "conversation",            // or "response"
  "title": "…",                      // conversation title, or response headline
  "createdAt": "2026-06-13T00:00:00Z",
  "app": { "name": "AxiVale", "version": "0.3.2" },
  "turns": [
    {
      "userText": "…",               // omitted when kind === "response"
      "agentText": "…markdown…",
      "filedAt": "3:45 PM",
      "tools": [
        { "name": "axitools_builds_list", "display": { /* chart/table/card */ } }
      ]
    }
  ]
}
```

**Sanitization rule** (applied by `buildSharePayload`):

- **Keep**: `userText`, `agentText`, tool `name`, and the visible `display`
  payloads (charts/tables/cards — the visible newspaper content).
- **Strip**: raw tool `input` and `resultText` (may contain tokens, guild IDs,
  account names, API payloads).
- For `kind: "response"`: a single turn, `userText` omitted, only that AI turn.

## Main-process modules

- **`src/main/shareSanitize.ts`** — `buildSharePayload(conversation, opts)` →
  share doc. Pure function, unit-tested. `opts` selects conversation vs a single
  turn by id.
- **`src/main/shareStore.ts`** — local registry persisted to `shares.json` in
  Electron userData. Entries: `{ id, kind, title, url, sourceConversationId,
  createdAt }`. Backs the manage/list/delete UI. Same atomic-write / debounce
  pattern as `conversationStore.ts`.
- **`src/main/sharePublisher.ts`** — orchestrates publishing:
  ensure repo → ensure viewer assets (push if missing/outdated) → enable Pages →
  put or delete `shares/<id>.json`. Uses the existing GitHub token from
  `githubAuth.ts` and a small REST client (extends the patterns already in
  `githubRepos.ts`).

## IPC / preload API

Added to `src/preload/index.ts` and handled in `src/main/index.ts`:

- `share:createConversation(conversationId)` → `{ url }`
- `share:createResponse(conversationId, turnId)` → `{ url }`
- `share:list()` → registry entries
- `share:delete(id)` → removes repo file + registry entry
- `share:status()` → `{ signedIn, repoReady, pagesUrl }`

## Renderer UI

- **Share response**: a hover button beside the existing 📷 `.clip-img-btn` in
  `src/renderer/src/components/Article.tsx`, shown on completed AI turns.
- **Share conversation**: a hover action in
  `src/renderer/src/components/Editions.tsx`, next to rename/delete per
  conversation.
- **`src/renderer/src/components/ShareDialog.tsx`** — newspaper-styled dialog
  showing the public URL with an auto-copied **Copy link** button. On the first
  share it shows a "publishing… link will be live shortly" state while the
  initial Pages build runs.
- **Shared panel** in `src/renderer/src/components/Settings.tsx` listing active
  shares (title, url) with a delete button.

## Error handling

- **Not signed into GitHub** → prompt the existing device-flow sign-in before
  sharing.
- **Insufficient scope** → clear message. Current scope `repo read:user` covers
  repo create + Pages enable; verify during implementation.
- **First Pages build latency** (~30–60s) → dialog communicates "publishing."
- **Repo/file conflicts, rate limits** → error surfaced in the dialog; the share
  is **not** added to the local registry on failure.
- **Delete** → remove `shares/<id>.json` from the repo (contents API requires the
  file sha) and remove the registry entry; the link then 404s.

## Testing

- `shareSanitize` — strips `input`/`resultText`, keeps `display`/`name`/text;
  `response` kind drops `userText` and includes only the target turn.
- slug generator — length, charset, basic uniqueness.
- `shareStore` — add / list / delete round-trips with atomic persistence.
- `sharePublisher` — against a mocked GitHub REST client: repo exists vs create,
  viewer up-to-date vs needs push, put share, delete share, failure paths.

(Per project/global test config: run vitest with `--maxWorkers=2`.)

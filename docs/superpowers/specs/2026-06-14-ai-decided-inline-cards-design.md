# AI-Decided Inline Build/Comp Cards — Design

**Date:** 2026-06-14
**Status:** Approved (pending spec review)

## Summary

Let the AI render rich `build-card` / `comp-card` (and chart) figures **inline in
the article only where it explicitly places a `{{figure}}` marker** — i.e. when it
deliberately illustrates a point. Tool results it pulled merely to look something
up (a full comp roster, a list of builds) no longer dump into the article; they
remain browsable as cards in the Actions rail (and the expand modal). This
extends the source-based split we already applied to tables.

## Background

- `axiforge_builds_get` / `_save` / `import_chat_link` return a `build-card`
  display; `axiforge_comps_get` returns a `comp-card` (comp + all its builds);
  the `*_list` tools return plain JSON lookups.
- `Article.tsx` currently renders any non-table tool display inline: at each
  `{{figure}}` marker in order, then **dumps the leftover (unmarked) displays at
  the end of the article**. That leftover-dump is what leaks lookups inline.
- Tool **table** displays are already excluded from inline (Actions-only).
- The Actions rail (`Rails.tsx`) and the expand modal (`ActionModal`) already
  render every tool's rich card.

## Decision

Inline figures are **marker-driven only**:

- In the app article, a chart / `build-card` / `comp-card` renders inline **only**
  at an explicit `{{figure}}` marker (in order). Remove the leftover-at-the-end
  dump — unmarked displays do not appear in the article.
- Tool **data tables** stay excluded from inline entirely (Actions-only),
  unchanged.
- Unmarked tool displays are not lost: they remain cards in the Actions rail +
  expand modal.
- The **share viewer is unchanged** — it has no Actions panel, so it keeps
  rendering all displays inline (markers first, then leftovers) so public shares
  stay complete.

Net effect: the AI controls what appears inline by choosing to mark it.

## Implementation

- **`src/renderer/src/components/Article.tsx`:** the inline-figure block already
  filters out `display.kind === 'table'`; additionally **remove the leftover
  render** (`figures.slice(Math.max(0, segments.length - 1)).map(renderFigure)`).
  Keep rendering one figure per `{{figure}}` marker, in order
  (`i < segments.length - 1 && figures[i]`). Update the explanatory comment.
- **`src/main/agent.ts` (system prompt):** clarify the figure rule — only what
  you mark with `{{figure}}` renders inline; render a `build-card`/`comp-card`
  inline (via `{{figure}}`) only to illustrate a specific point; bulk lookups and
  full comp rosters are browsable in the right-hand Actions panel, so don't try
  to surface them inline. Keep the existing `{{figure}}` wording and the
  "do NOT pile every figure at the end" phrase (a systemPrompt test asserts both).
- **No change** to `Rails.tsx` / `ActionModal.tsx` (they already render all tool
  cards) or `ShareApp.tsx` (viewer keeps leftover-inline).

## Error handling / edge cases

- More `{{figure}}` markers than figures → extra markers render nothing (existing
  behavior).
- Fewer markers than figures → the unmarked figures simply don't appear inline
  (they're in Actions). No end-dump.
- A turn with displays but zero markers → no inline figures in the article; all
  are in the Actions rail.

## Testing

- `Article.tsx` tests:
  - A `{{figure}}`-marked chart renders inline at the marker (existing, keep).
  - An unmarked chart/`build-card`/`comp-card` does **NOT** render inline
    (no `.post-figure`) — replaces the current "appends at the end when no
    marker" test.
  - A tool table is never inline (existing, keep).
- `systemPrompt.test.ts` continues to pass (the `{{figure}}` and "do NOT pile
  every figure at the end" assertions remain satisfied).

Run vitest with `--maxWorkers=2`.

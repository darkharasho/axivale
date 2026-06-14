# Action Card Modal — Design

**Date:** 2026-06-14
**Status:** Approved (pending spec review)

## Summary

The Actions rail (`Notices · Actions Filed`) lists each tool call as a `NoticeCard`
that expands inline on click. Inline peeks are cramped for data-heavy results
(full per-player tables, charts). Add an **expand-to-modal** affordance: a ⤢
button on each card opens a roomy overlay showing the full rendered card plus
context (inputs) and the raw result behind a toggle. The lightweight inline peek
stays unchanged.

## Goals

- See the complete tool result (untruncated table/chart) in a large view.
- Keep the quick in-rail peek for scanning.
- Show context (tool + inputs) and raw result for transparency/debugging.

## Non-goals

- Editing or re-running tools from the modal.
- Changing how tool results render inline in the article.

## Decisions

| Axis | Decision |
|------|----------|
| Trigger | Dedicated **⤢ expand** button on each card → modal (inline peek kept) |
| Content | Full rendered card + tool name/status + inputs line + raw result behind a "show raw" toggle |
| Ownership | The Actions rail owns the modal state (no App-level changes) |

## Component: ActionModal

New `src/renderer/src/components/ActionModal.tsx` — an overlay modal mirroring the
existing `ConfirmDialog`/`ShareDialog` pattern (fixed backdrop + centered panel;
closes on backdrop click, Esc, and a ✕). Props: `{ tool: ToolCall | null; onClose: () => void }`.
Returns `null` when `tool` is null.

Renders, for the given `ToolCall`:
- **Header:** `couponLabel(tool.name)` + a status chip (✓ filed / ✗ failed, mirroring `NoticeCard`).
- **Inputs:** `humanInput(tool.input)` (omitted when empty) — "what was asked."
- **Body:** the full rendered result via `renderCouponBody(tool)` (the rich
  `RichDisplay` card when `tool.display` exists, else the generic body). Untruncated.
- **Raw toggle:** a "show raw" button that reveals `tool.resultText` in a `<pre>`
  (collapsed by default; nothing shown if there is no result text).
- Panel width `min(900px, 92vw)` with a scrollable body so wide tables/long
  results fit; wide content scrolls within the panel.

`couponLabel`, `humanInput`, and `renderCouponBody` are reused from
`ToolCoupon.tsx` (already exported).

## Wiring (Rails.tsx)

- `NoticeCard` gains an `onExpand: (tool: ToolCall) => void` prop and renders a
  small **⤢ button** in its `.th` header. Its click calls `onExpand(tool)` and
  `stopPropagation()` so it does not toggle the inline peek.
- `RightRail` holds `const [expanded, setExpanded] = useState<ToolCall | null>(null)`,
  passes `onExpand={setExpanded}` to each `NoticeCard`, and renders
  `<ActionModal tool={expanded} onClose={() => setExpanded(null)} />`.
- No `App.tsx` changes.

## Styles (theme.css)

- `.action-overlay` (fixed, dim backdrop, centered) and `.action-modal` (panel),
  reusing the share-dialog visual language.
- `.action-modal__head` (title + status), `.action-modal__inputs`,
  `.action-modal__body` (scrollable), `.action-raw` (`<pre>` styling), and a
  `.ncard .expand` button style.

## Error handling

- `tool` null → renders nothing.
- No `display` → `renderCouponBody` falls back to the generic body (existing).
- No `resultText` → the "show raw" toggle is not rendered.
- Esc / backdrop / ✕ all close; clicking inside the panel does not.

## Testing

- `ActionModal`: renders nothing for `tool=null`; with a table-display tool shows
  the header, inputs, and the rich card (`.richtable`); the "show raw" toggle
  reveals/hides `resultText`; ✕/backdrop call `onClose`.
- `Rails`: the ⤢ button calls `onExpand` with the tool and does NOT toggle the
  inline peek (the `.nx` body stays closed); selecting a tool renders the modal.

Run vitest with `--maxWorkers=2`.

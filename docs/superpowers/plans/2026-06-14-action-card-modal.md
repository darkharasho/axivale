# Action Card Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a ⤢ expand button to each Actions-rail card that opens a roomy modal showing the full tool result (rendered card + inputs + raw result toggle), keeping the existing inline peek.

**Architecture:** A new `ActionModal` overlay component renders one `ToolCall` using the already-exported `couponLabel`/`humanInput`/`renderCouponBody` from `ToolCoupon`. `Rails.tsx` owns the modal: `NoticeCard` gets an `onExpand` button; `RightRail` tracks the expanded tool and renders the modal. No App-level changes.

**Tech Stack:** React 18, TypeScript, @testing-library/react + jsdom, vitest.

**Conventions:** modal pattern mirrors `ShareDialog`/`ConfirmDialog` (fixed backdrop + centered panel, backdrop-click closes, inner click `stopPropagation`). Run tests with `npx vitest run <file> --maxWorkers=2`. Commit per task.

---

## File Structure
- Create: `src/renderer/src/components/ActionModal.tsx` — the overlay modal for one ToolCall.
- Create: `src/renderer/src/components/ActionModal.test.tsx`
- Modify: `src/renderer/src/components/Rails.tsx` — ⤢ button + modal state.
- Modify: `src/renderer/src/components/Rails.test.tsx` — expand-button behavior.
- Modify: `src/renderer/src/theme.css` — modal + expand-button styles.

---

## Task 1: ActionModal component

**Files:**
- Create: `src/renderer/src/components/ActionModal.tsx`
- Test: `src/renderer/src/components/ActionModal.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// src/renderer/src/components/ActionModal.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ActionModal from './ActionModal'
import type { ToolCall } from '../state'

const tableTool: ToolCall = {
  id: 't1',
  name: 'axibridge_player_stats',
  input: { repo: 'guild/reports', from: 'tonight' },
  resultText: '{"raw":"payload"}',
  isError: false,
  display: {
    kind: 'table',
    data: { title: 'Players', columns: [{ key: 'n', label: 'Name' }], rows: [{ n: 'Tessa' }] }
  }
}

describe('ActionModal', () => {
  it('renders nothing when tool is null', () => {
    const { container } = render(<ActionModal tool={null} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the header, inputs, and the rich card', () => {
    render(<ActionModal tool={tableTool} onClose={() => {}} />)
    expect(screen.getByText(/players/i)).toBeTruthy() // column label from RichTable
    // inputs line includes a humanized input value
    expect(screen.getByText(/guild\/reports/)).toBeTruthy()
    // raw result is NOT shown until toggled
    expect(screen.queryByText('{"raw":"payload"}')).toBeNull()
  })

  it('toggles the raw result', () => {
    render(<ActionModal tool={tableTool} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /show raw/i }))
    expect(screen.getByText('{"raw":"payload"}')).toBeTruthy()
  })

  it('closes on backdrop click and ✕ but not on panel click', () => {
    const onClose = vi.fn()
    const { container } = render(<ActionModal tool={tableTool} onClose={onClose} />)
    fireEvent.click(container.querySelector('.action-modal')!)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(container.querySelector('.action-overlay')!)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/ActionModal.test.tsx --maxWorkers=2`
Expected: FAIL — `Cannot find module './ActionModal'`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/renderer/src/components/ActionModal.tsx
import { useEffect, useState, type ReactElement } from 'react'
import type { ToolCall } from '../state'
import { couponLabel, humanInput, renderCouponBody } from './ToolCoupon'

/** Roomy overlay showing the full result of one Actions-rail tool call. */
export default function ActionModal({
  tool,
  onClose
}: {
  tool: ToolCall | null
  onClose: () => void
}): ReactElement | null {
  const [showRaw, setShowRaw] = useState(false)

  useEffect(() => {
    if (!tool) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [tool, onClose])

  // Reset the raw toggle whenever a different tool is opened.
  useEffect(() => setShowRaw(false), [tool?.id])

  if (!tool) return null
  const gist = humanInput(tool.input, 200)

  return (
    <div className="action-overlay" onClick={onClose}>
      <div className="action-modal" onClick={(e) => e.stopPropagation()}>
        <div className="action-modal__head">
          <span className="nm">{couponLabel(tool.name)}</span>
          {tool.isError ? (
            <span className="st fail">✗ failed</span>
          ) : (
            <span className="st">✓ filed</span>
          )}
          <button className="action-modal__x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        {gist !== '' && <div className="action-modal__inputs">{gist}</div>}
        <div className="action-modal__body">{renderCouponBody(tool)}</div>
        {tool.resultText && (
          <div className="action-modal__raw">
            <button className="sbtn" onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? 'Hide raw' : 'Show raw'}
            </button>
            {showRaw && <pre className="action-raw">{tool.resultText}</pre>}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/ActionModal.test.tsx --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ActionModal.tsx src/renderer/src/components/ActionModal.test.tsx
git commit -m "feat(actions): ActionModal — full tool result overlay"
```

---

## Task 2: Wire the ⤢ expand button + modal into Rails

**Files:**
- Modify: `src/renderer/src/components/Rails.tsx`
- Modify: `src/renderer/src/components/Rails.test.tsx`

- [ ] **Step 1: Add the expand-button test**

Append inside the `describe('RightRail notice cards', …)` block in `src/renderer/src/components/Rails.test.tsx`:

```tsx
  it('the expand button opens the modal without toggling the inline peek', () => {
    const tool: ToolCall = {
      id: 'tx',
      name: 'axibridge_player_stats',
      input: {},
      resultText: '{"ok":true}',
      isError: false,
      display: {
        kind: 'table',
        data: { title: 'Players', columns: [{ key: 'n', label: 'Name' }], rows: [{ n: 'Tessa' }] }
      }
    }
    const { container } = render(
      <RightRail memberCount={null} buildsCount={null} turns={[turnWith(tool)]} />
    )
    fireEvent.click(container.querySelector('.ncard .expand')!)
    // modal opened
    expect(container.querySelector('.action-modal')).toBeTruthy()
    // inline peek did NOT open (no .nx body inside the card)
    expect(container.querySelector('.ncard .nx')).toBeNull()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/Rails.test.tsx --maxWorkers=2`
Expected: FAIL — no `.ncard .expand` element / no `.action-modal`.

- [ ] **Step 3: Implement — import, expand button, modal state**

In `src/renderer/src/components/Rails.tsx`:

(a) Update imports at the top:

```ts
import { useState, type ReactElement } from 'react'
import type { ToolCall, Turn } from '../state'
import { couponLabel, humanInput, renderCouponBody } from './ToolCoupon'
import ActionModal from './ActionModal'
```

(b) Give `NoticeCard` an `onExpand` prop and render the ⤢ button in its `.th` header. Change the `NoticeCard` signature and header block:

```tsx
function NoticeCard({
  notice,
  onExpand
}: {
  notice: Notice
  onExpand: (tool: ToolCall) => void
}): ReactElement {
```

Then in its returned JSX, replace the existing `.th` block with:

```tsx
      <div className="th">
        <span className="nm">{couponLabel(tool.name)}</span>
        {status}
        <button
          className="expand"
          aria-label="Expand action"
          title="Expand"
          onClick={(e) => {
            e.stopPropagation()
            onExpand(tool)
          }}
        >
          ⤢
        </button>
      </div>
```

(c) In `RightRail`, add modal state, pass `onExpand`, and render the modal:

```tsx
export function RightRail({ turns }: RailsProps): ReactElement {
  const [expanded, setExpanded] = useState<ToolCall | null>(null)
  let seq = 0
  const feed: Notice[] = turns
    .flatMap((turn, ti) =>
      turn.tools.map((tool) => ({
        tool,
        seq: ++seq,
        filedAt: turn.filedAt,
        current: ti === turns.length - 1
      }))
    )
    .slice(-FEED_CAP)
    .reverse()

  return (
    <div className="rail right">
      <div className="h">Notices · Actions Filed</div>
      {feed.length === 0 ? (
        <div className="item">
          <b>The wire is quiet</b>no actions filed yet
        </div>
      ) : (
        feed.map((notice) => (
          <NoticeCard key={notice.tool.id} notice={notice} onExpand={setExpanded} />
        ))
      )}
      <ActionModal tool={expanded} onClose={() => setExpanded(null)} />
    </div>
  )
}
```

(Leave the `couponLabel`/`humanInput`/`renderCouponBody` imports — `NoticeCard` still uses `couponLabel`, `humanInput`, and `renderCouponBody`.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/renderer/src/components/Rails.test.tsx --maxWorkers=2`
Expected: PASS (all, including the existing inline-peek tests and the new expand test).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Rails.tsx src/renderer/src/components/Rails.test.tsx
git commit -m "feat(actions): expand button opens the ActionModal from the rail"
```

---

## Task 3: Styles

**Files:**
- Modify: `src/renderer/src/theme.css`

- [ ] **Step 1: Append styles** (match existing tokens; reuse the share-dialog look)

```css
/* ---- Action expand button + modal ---- */
.ncard .expand{margin-left:8px;background:none;border:none;color:var(--faint);cursor:pointer;font-size:12px;line-height:1;padding:0 2px;flex:none}
.ncard .expand:hover{color:var(--accent-b)}
.action-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:1100}
.action-modal{position:relative;display:flex;flex-direction:column;max-height:86vh;width:min(900px,92vw);background:var(--paper);border:1px solid var(--rule);box-shadow:0 18px 50px rgba(0,0,0,.55)}
.action-modal__head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--rule);font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase}
.action-modal__head .nm{color:var(--ink)}
.action-modal__x{margin-left:auto;background:none;border:none;color:var(--ink-dim);cursor:pointer;font-size:14px;line-height:1}
.action-modal__x:hover{color:var(--accent-b)}
.action-modal__inputs{padding:8px 18px;border-bottom:1px dotted var(--line);font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.04em;color:var(--faint);word-break:break-word}
.action-modal__body{padding:16px 18px;overflow:auto}
.action-modal__raw{padding:0 18px 16px}
.action-raw{margin-top:8px;max-height:280px;overflow:auto;background:var(--bg);border:1px solid var(--rule);padding:10px 12px;font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ink-dim);white-space:pre-wrap;word-break:break-word}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: completes, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/theme.css
git commit -m "style(actions): expand button + action modal styles"
```

---

## Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite**

Run: `npx vitest run --maxWorkers=2`
Expected: PASS.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Manual smoke test**

`npm run dev`: run something that produces a per-player table (e.g. a WvW report), open the Actions rail, click ⤢ on the `axibridge_player_stats` card → the modal shows the full table, inputs line, and a "show raw" toggle. Esc / backdrop / ✕ close it; clicking the table does not.

---

## Self-Review Notes

- **Spec coverage:** ActionModal component with header/inputs/body/raw-toggle (Task 1); ⤢ trigger that stops propagation + rail-owned modal state (Task 2); styles reusing share-dialog look (Task 3); error handling (null tool → null, no resultText → no toggle, Esc/backdrop/✕ close) covered in Task 1 impl + tests; testing per task. All mapped.
- **Type consistency:** `ActionModal` props `{ tool: ToolCall | null; onClose: () => void }` match the `<ActionModal tool={expanded} onClose=…>` usage in Task 2; `onExpand: (tool: ToolCall) => void` matches `setExpanded`. `couponLabel`/`humanInput`/`renderCouponBody` are existing exports from `ToolCoupon.tsx`.

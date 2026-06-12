# Inline Rich Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tool results in AxiVale chat can carry a typed `display: { kind, data }` payload that the renderer turns into rich inline blocks — AxiForge build/comp cards (via a new `@axiapps/forge-render` package extracted in the AxiForge repo), Recharts charts, and sortable tables — while the model continues to receive only compact JSON text.

**Working directories:** /var/home/mstephens/Documents/GitHub/axiforge (package extraction), /var/home/mstephens/Documents/GitHub/axivale (everything else)

**Architecture:** Tool handlers in the AxiVale main process attach `display` to their results. For the OpenAI/Gemini/local adapters the payload rides directly on the handler's `ToolResult` → `ToolOutcome` → `AgentEvent`. For the Claude adapter the result text round-trips through the claude subprocess (display would be lost), so a `DisplayCorrelator` wraps the in-process tool handlers, queues displays per tool name, and re-attaches them to the translated `tool-result` events by tool-use id. The renderer's `applyEvent` copies `display` onto the `ToolCall`; `ToolCoupon` renders a typed rich block per kind. `build-card`/`comp-card` render through `<ForgeCard>`, a React wrapper around the framework-free `@axiapps/forge-render` package (vanilla JS string renderers + CSS scoped under `.forge-render`), consumed via a `file:` dependency on the sibling AxiForge repo. Catalog data (rune/relic icons+names) comes from the AxiForge local API catalog endpoints, cached on disk in main and exposed to the renderer over IPC.

**Tech Stack:** TypeScript + React 18 + electron-vite + Vitest (AxiVale); vanilla JS ES modules + Jest + Vite (AxiForge); Recharts ^3; `@testing-library/react` + jsdom (new dev deps in AxiVale); npm workspaces package pattern from `packages/axicode` / `packages/gw2-data`.

---

## Canonical display payload shapes (consumed by this plan AND the AxiBridge plan — do not deviate)

```ts
export interface ChartSeriesSpec {
  key: string
  label: string
  color?: string
}

export type DisplayPayload =
  | { kind: 'build-card'; data: { build: Record<string, unknown> } }
  | {
      kind: 'comp-card'
      data: {
        comp: Record<string, unknown>
        /** Builds referenced by the comp's partyLines/pool, keyed by build id. */
        builds: Record<string, Record<string, unknown>>
      }
    }
  | {
      kind: 'chart'
      data: {
        type: 'line' | 'bar' | 'area'
        title: string
        xKey: string
        series: ChartSeriesSpec[]
        rows: Array<Record<string, string | number>>
      }
    }
  | {
      kind: 'table'
      data: {
        title?: string
        columns: Array<{ key: string; label: string }>
        rows: Array<Record<string, string | number>>
      }
    }
```

`build` / `comp` objects are AxiForge store records as returned by the local API (`comp.partyLines: [{ slots: string[], capacity: number }]`, `comp.buildColors: Record<id, 'normal'|'red'|'blue'>`, build has `profession`, `specializations`, `equipment.{weapons,slots,runes,relic,statPackage}`, `tags`, `gameMode`).

Test commands: AxiVale's `vitest.config.ts` already caps `poolOptions.forks.maxForks` at 2 (≤ the global limit), so plain `npx vitest run <file>` is compliant. AxiForge uses Jest (`npx jest <path>`).

---

## Task 1: Display payload type + event plumbing (main → preload → renderer)

**Files:**
- Modify: `/var/home/mstephens/Documents/GitHub/axivale/src/main/providers/types.ts` (lines 3–7: `AgentEvent`)
- Modify: `/var/home/mstephens/Documents/GitHub/axivale/src/main/providers/toolSchema.ts` (lines 16–19 `ToolOutcome`, 41–59 `executeTool`)
- Create: `/var/home/mstephens/Documents/GitHub/axivale/src/main/providers/displayBus.ts`
- Create: `/var/home/mstephens/Documents/GitHub/axivale/src/main/providers/displayBus.test.ts`
- Modify: `/var/home/mstephens/Documents/GitHub/axivale/src/main/providers/claude.ts` (lines 131–182 `runTurn`)
- Modify: `/var/home/mstephens/Documents/GitHub/axivale/src/main/providers/openaiCompat.ts` (line 154), `/var/home/mstephens/Documents/GitHub/axivale/src/main/providers/gemini.ts` (line 164)
- Modify: `/var/home/mstephens/Documents/GitHub/axivale/src/main/tools.ts` (lines 44–66: `ToolResult`, `ok`, `safe` — add `safeRich`)
- Modify: `/var/home/mstephens/Documents/GitHub/axivale/src/main/providers/toolSchema.test.ts` (add cases)
- Modify: `/var/home/mstephens/Documents/GitHub/axivale/src/renderer/src/state.ts` (whole file is 41 lines)
- Modify: `/var/home/mstephens/Documents/GitHub/axivale/src/renderer/src/state.test.ts` (add cases)

No changes needed in `src/main/index.ts` (line 277 forwards `agentEvent` opaquely over IPC; `display` is plain JSON and survives structured clone) or `src/preload/index.ts` (lines 13–17 forward `unknown`).

### Steps

- [ ] **1.1 Failing test — executeTool surfaces `display` from handlers.** Append to `src/main/providers/toolSchema.test.ts`:

```ts
import { tool } from '@anthropic-ai/claude-agent-sdk'
import type { DisplayPayload } from './types'

describe('display payload passthrough', () => {
  const tableDisplay: DisplayPayload = {
    kind: 'table',
    data: { columns: [{ key: 'n', label: 'Name' }], rows: [{ n: 'Firebrand' }] }
  }

  it('executeTool copies handler display onto the outcome', async () => {
    const tools = [
      tool('rich', 'returns a display', {}, async () => ({
        content: [{ type: 'text' as const, text: '{"ok":true}' }],
        display: tableDisplay
      }))
    ]
    const out = await executeTool(tools, 'rich', {})
    expect(out.isError).toBe(false)
    expect(out.text).toBe('{"ok":true}')
    expect(out.display).toEqual(tableDisplay)
  })

  it('executeTool omits display on error results', async () => {
    const tools = [
      tool('boom', 'fails with display attached', {}, async () => ({
        isError: true,
        content: [{ type: 'text' as const, text: 'nope' }],
        display: tableDisplay
      }))
    ]
    const out = await executeTool(tools, 'boom', {})
    expect(out.isError).toBe(true)
    expect(out.display).toBeUndefined()
  })
})
```

- [ ] **1.2 Run, expect failure:** `cd /var/home/mstephens/Documents/GitHub/axivale && npx vitest run src/main/providers/toolSchema.test.ts` — fails (no `DisplayPayload` export, `out.display` does not exist).

- [ ] **1.3 Implement types.** In `src/main/providers/types.ts`, insert above `AgentEvent` and extend `tool-result` (also export `ChartSeriesSpec`):

```ts
export interface ChartSeriesSpec {
  key: string
  label: string
  color?: string
}

/**
 * Typed rich-render payload attached to tool results by main-process tool
 * handlers. Provider-agnostic: the model only ever sees the compact JSON
 * text; the renderer receives this alongside it. Shapes are shared with the
 * AxiBridge integration — change them only in lockstep with that plan.
 */
export type DisplayPayload =
  | { kind: 'build-card'; data: { build: Record<string, unknown> } }
  | {
      kind: 'comp-card'
      data: {
        comp: Record<string, unknown>
        builds: Record<string, Record<string, unknown>>
      }
    }
  | {
      kind: 'chart'
      data: {
        type: 'line' | 'bar' | 'area'
        title: string
        xKey: string
        series: ChartSeriesSpec[]
        rows: Array<Record<string, string | number>>
      }
    }
  | {
      kind: 'table'
      data: {
        title?: string
        columns: Array<{ key: string; label: string }>
        rows: Array<Record<string, string | number>>
      }
    }

export type AgentEvent =
  | { kind: 'text-delta'; text: string }
  | { kind: 'tool-start'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'tool-result'; id: string; isError: boolean; text: string; display?: DisplayPayload }
  | { kind: 'done'; sessionId: string | null; error: string | null }
```

In `src/main/providers/toolSchema.ts`: import the type, extend the outcome, and read the payload off the handler result:

```ts
import { MCP_PREFIX, type DisplayPayload } from './types'

export interface ToolOutcome {
  text: string
  isError: boolean
  display?: DisplayPayload
}
```

and in `executeTool`, replace the final `return`:

```ts
  const display = (result as { display?: DisplayPayload }).display
  const isError = result.isError === true
  return isError || !display ? { text, isError } : { text, isError, display }
```

In `src/main/tools.ts`, extend `ToolResult` and add the rich helper next to `safe()` (lines 44–66) — the sibling AxiForge-tools plan splits `tools.ts` into `src/main/tools/`; these helpers move with `ok`/`safe` when that happens:

```ts
import type { DisplayPayload } from './providers/types'

interface ToolResult {
  [key: string]: unknown
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
  /** Rich-render payload for the UI; never serialized into model context. */
  display?: DisplayPayload
}

/**
 * Like safe(), for handlers that also produce a rich display payload.
 * The model gets JSON.stringify(value); the renderer gets display.
 */
export function safeRich<A>(
  fn: (args: A) => Promise<{ value: unknown; display?: DisplayPayload }>
): (args: A, extra: unknown) => Promise<ToolResult> {
  return async (args) => {
    try {
      const { value, display } = await fn(args)
      const result = ok(value)
      return display ? { ...result, display } : result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { isError: true, content: [{ type: 'text', text: message }] }
    }
  }
}
```

- [ ] **1.4 Run, expect pass:** `npx vitest run src/main/providers/toolSchema.test.ts`

- [ ] **1.5 Failing test — DisplayCorrelator (Claude path).** Create `src/main/providers/displayBus.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { DisplayCorrelator } from './displayBus'
import type { AgentEvent, DisplayPayload } from './types'

const display: DisplayPayload = { kind: 'build-card', data: { build: { id: 'b1' } } }

function richTool(name: string) {
  return tool(name, 'rich', {}, async () => ({
    content: [{ type: 'text' as const, text: '{"id":"b1"}' }],
    display
  }))
}

describe('DisplayCorrelator', () => {
  it('re-attaches displays to tool-result events by tool-use id', async () => {
    const c = new DisplayCorrelator()
    const [wrapped] = c.wrapTools([richTool('axiforge_builds_get')])
    await wrapped.handler({}, {})

    const start: AgentEvent = {
      kind: 'tool-start', id: 'toolu_1', name: 'axiforge_builds_get', input: {}
    }
    expect(c.observe(start)).toBe(start)
    const result = c.observe({
      kind: 'tool-result', id: 'toolu_1', isError: false, text: '{"id":"b1"}'
    })
    expect(result).toEqual({
      kind: 'tool-result', id: 'toolu_1', isError: false, text: '{"id":"b1"}', display
    })
  })

  it('matches displays FIFO per tool name across interleaved calls', async () => {
    const c = new DisplayCorrelator()
    const [wrapped] = c.wrapTools([richTool('t')])
    await wrapped.handler({}, {})
    await wrapped.handler({}, {})
    c.observe({ kind: 'tool-start', id: 'a', name: 't', input: {} })
    c.observe({ kind: 'tool-start', id: 'b', name: 't', input: {} })
    const ra = c.observe({ kind: 'tool-result', id: 'a', isError: false, text: '1' })
    const rb = c.observe({ kind: 'tool-result', id: 'b', isError: false, text: '2' })
    expect(ra.kind === 'tool-result' && ra.display).toEqual(display)
    expect(rb.kind === 'tool-result' && rb.display).toEqual(display)
  })

  it('does not queue displays for error results and passes other events through', async () => {
    const c = new DisplayCorrelator()
    const [wrapped] = c.wrapTools([
      tool('err', 'fails', {}, async () => ({
        isError: true, content: [{ type: 'text' as const, text: 'nope' }], display
      }))
    ])
    await wrapped.handler({}, {})
    c.observe({ kind: 'tool-start', id: 'x', name: 'err', input: {} })
    const r = c.observe({ kind: 'tool-result', id: 'x', isError: true, text: 'nope' })
    expect(r.kind === 'tool-result' && r.display).toBeUndefined()
    const delta: AgentEvent = { kind: 'text-delta', text: 'hi' }
    expect(c.observe(delta)).toBe(delta)
  })
})
```

- [ ] **1.6 Run, expect failure:** `npx vitest run src/main/providers/displayBus.test.ts` — module not found.

- [ ] **1.7 Implement** `src/main/providers/displayBus.ts`:

```ts
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent, DisplayPayload } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tools = Array<SdkMcpToolDefinition<any>>

/**
 * Side-channel for display payloads on the Claude path.
 *
 * Claude tools run in-process (createSdkMcpServer), but their results are
 * serialized to the claude subprocess and come back as plain tool_result
 * text — any extra keys on the handler's ToolResult are lost. So we wrap
 * each handler to capture `display` into a FIFO queue per tool name, track
 * tool-start id→name, and re-attach the payload to the matching translated
 * tool-result event. FIFO is safe because a tool's handler always completes
 * before the SDK emits its tool_result message.
 *
 * One instance per turn — do not reuse across turns.
 */
export class DisplayCorrelator {
  private pending = new Map<string, DisplayPayload[]>()
  private idToName = new Map<string, string>()

  wrapTools(tools: Tools): Tools {
    return tools.map((t) => ({
      ...t,
      handler: async (args: unknown, extra: unknown) => {
        const result = await t.handler(args, extra)
        const display = (result as { display?: DisplayPayload }).display
        if (display && result.isError !== true) {
          const queue = this.pending.get(t.name) ?? []
          queue.push(display)
          this.pending.set(t.name, queue)
        }
        return result
      }
    }))
  }

  /** Pass every translated event through; tool-results gain their display. */
  observe(event: AgentEvent): AgentEvent {
    if (event.kind === 'tool-start') {
      this.idToName.set(event.id, event.name)
      return event
    }
    if (event.kind !== 'tool-result' || event.isError) return event
    const name = this.idToName.get(event.id)
    if (!name) return event
    const queue = this.pending.get(name)
    const display = queue?.shift()
    return display ? { ...event, display } : event
  }
}
```

- [ ] **1.8 Run, expect pass:** `npx vitest run src/main/providers/displayBus.test.ts`

- [ ] **1.9 Wire the adapters.** In `src/main/providers/claude.ts` `runTurn` (lines 131–132 and 173–178):

```ts
    const correlator = new DisplayCorrelator()
    const server = createSdkMcpServer({
      name: 'officer',
      version: '1.0.0',
      tools: correlator.wrapTools(input.tools)
    })
```

and in the message loop:

```ts
      for await (const msg of q) {
        for (const event of translateSdkMessage(msg)) {
          if (event.kind === 'done' && event.sessionId) this.sessionId = event.sessionId
          yield correlator.observe(event)
        }
      }
```

(add `import { DisplayCorrelator } from './displayBus'`). In `src/main/providers/openaiCompat.ts` line 154 and `src/main/providers/gemini.ts` line 164, spread the display through:

```ts
        yield {
          kind: 'tool-result', id: call.id, isError: outcome.isError, text: outcome.text,
          ...(outcome.display ? { display: outcome.display } : {})
        }
```

- [ ] **1.10 Failing test — renderer state carries display.** Append to `src/renderer/src/state.test.ts`:

```ts
  it('copies display onto the matching tool on tool-result', () => {
    const display = {
      kind: 'table' as const,
      data: { columns: [{ key: 'n', label: 'Name' }], rows: [{ n: 'Firebrand' }] }
    }
    let t = applyEvent(baseTurn(), { kind: 'tool-start', id: 'a', name: 'x', input: {} })
    t = applyEvent(t, { kind: 'tool-result', id: 'a', isError: false, text: '{}', display })
    expect(t.tools[0].display).toEqual(display)
  })

  it('leaves display undefined when the event has none', () => {
    let t = applyEvent(baseTurn(), { kind: 'tool-start', id: 'a', name: 'x', input: {} })
    t = applyEvent(t, { kind: 'tool-result', id: 'a', isError: false, text: '{}' })
    expect(t.tools[0].display).toBeUndefined()
  })
```

- [ ] **1.11 Run, expect failure:** `npx vitest run src/renderer/src/state.test.ts`

- [ ] **1.12 Implement renderer state.** `src/renderer/src/state.ts` duplicates the main-process event type by design (house pattern — the renderer never imports from `src/main`). Add the same `ChartSeriesSpec`/`DisplayPayload` definitions from step 1.3 verbatim (exported), then:

```ts
export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  resultText?: string
  isError?: boolean
  display?: DisplayPayload
}
```

extend the duplicated `AgentEvent`'s `tool-result` member with `display?: DisplayPayload`, and in `applyEvent`:

```ts
    case 'tool-result':
      return {
        ...turn,
        tools: turn.tools.map((t) =>
          t.id === event.id
            ? { ...t, resultText: event.text, isError: event.isError, display: event.display }
            : t
        )
      }
```

- [ ] **1.13 Run full suite + typecheck, expect pass:** `npx vitest run && npm run typecheck`

- [ ] **1.14 Commit** in axivale: `feat: typed display payloads on tool-result events (main→renderer plumbing)`

---

## Task 2: `chart` and `table` rich blocks in ToolCoupon (Recharts, newspaper styling)

**Files:**
- Modify: `/var/home/mstephens/Documents/GitHub/axivale/package.json` (deps), `/var/home/mstephens/Documents/GitHub/axivale/vitest.config.ts` (include `.tsx`)
- Create: `/var/home/mstephens/Documents/GitHub/axivale/src/renderer/src/components/rich/RichTable.tsx`
- Create: `/var/home/mstephens/Documents/GitHub/axivale/src/renderer/src/components/rich/RichChart.tsx`
- Create: `/var/home/mstephens/Documents/GitHub/axivale/src/renderer/src/components/rich/RichTable.test.tsx`
- Create: `/var/home/mstephens/Documents/GitHub/axivale/src/renderer/src/components/rich/RichChart.test.tsx`
- Create: `/var/home/mstephens/Documents/GitHub/axivale/src/renderer/src/components/rich/RichDisplay.tsx`
- Modify: `/var/home/mstephens/Documents/GitHub/axivale/src/renderer/src/components/ToolCoupon.tsx` (lines 166–189, `ToolCoupon` component)
- Create: `/var/home/mstephens/Documents/GitHub/axivale/src/renderer/src/components/ToolCoupon.test.tsx`
- Modify: `/var/home/mstephens/Documents/GitHub/axivale/src/renderer/src/theme.css` (append after line 146, the `.endmark` rule)

### Steps

- [ ] **2.1 Install deps** (recharts is a real runtime dep; testing libs are dev-only — `@testing-library/react` is NOT currently present):

```bash
cd /var/home/mstephens/Documents/GitHub/axivale
npm install recharts@^3.0.0
npm install -D @testing-library/react@^16.0.0 @testing-library/dom@^10.0.0 jsdom@^25.0.0
```

- [ ] **2.2 Widen vitest include** in `vitest.config.ts` (env stays `node`; component tests opt into jsdom with a file pragma):

```ts
    include: ['src/**/*.test.{ts,tsx}'],
```

- [ ] **2.3 Failing test — RichTable.** Create `src/renderer/src/components/rich/RichTable.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import RichTable from './RichTable'

const spec = {
  title: 'WvW Roles',
  columns: [
    { key: 'name', label: 'Build' },
    { key: 'count', label: 'Count' }
  ],
  rows: [
    { name: 'Firebrand', count: 5 },
    { name: 'Scrapper', count: 3 },
    { name: 'Vindicator', count: 8 }
  ]
}

describe('RichTable', () => {
  it('renders title, headers, and all rows', () => {
    const { getByText, getAllByRole } = render(<RichTable spec={spec} />)
    expect(getByText('WvW Roles')).toBeTruthy()
    expect(getByText('Build')).toBeTruthy()
    expect(getAllByRole('row')).toHaveLength(4) // header + 3
  })

  it('sorts by column on header click, toggling direction', () => {
    const { getByText, getAllByRole } = render(<RichTable spec={spec} />)
    const firstCell = (): string => getAllByRole('row')[1].querySelector('td')!.textContent!
    fireEvent.click(getByText('Count'))
    expect(firstCell()).toBe('Scrapper') // ascending by count: 3
    fireEvent.click(getByText('Count'))
    expect(firstCell()).toBe('Vindicator') // descending: 8
  })

  it('renders missing cell values as an em dash', () => {
    const { getAllByRole } = render(
      <RichTable spec={{ columns: spec.columns, rows: [{ name: 'Druid' }] }} />
    )
    expect(getAllByRole('row')[1].textContent).toContain('—')
  })
})
```

- [ ] **2.4 Run, expect failure:** `npx vitest run src/renderer/src/components/rich/RichTable.test.tsx`

- [ ] **2.5 Implement** `src/renderer/src/components/rich/RichTable.tsx`:

```tsx
import { useState, type ReactElement } from 'react'
import type { DisplayPayload } from '../../state'

type TableSpec = Extract<DisplayPayload, { kind: 'table' }>['data']

function cell(v: string | number | undefined): string {
  return v === undefined || v === null || v === '' ? '—' : String(v)
}

/** Sortable explicit-columns table — the box-score block of the gazette. */
export default function RichTable({ spec }: { spec: TableSpec }): ReactElement {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [dir, setDir] = useState<1 | -1>(1)

  const onSort = (key: string): void => {
    if (sortKey === key) setDir((d) => (d === 1 ? -1 : 1))
    else {
      setSortKey(key)
      setDir(1)
    }
  }

  const rows = sortKey
    ? [...spec.rows].sort((a, b) => {
        const av = a[sortKey]
        const bv = b[sortKey]
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
        return String(av ?? '').localeCompare(String(bv ?? '')) * dir
      })
    : spec.rows

  return (
    <div className="rich richtable">
      {spec.title && <div className="rich-title">{spec.title}</div>}
      <table>
        <thead>
          <tr>
            {spec.columns.map((c) => (
              <th key={c.key} onClick={() => onSort(c.key)}>
                {c.label}
                {sortKey === c.key && <span className="arr">{dir === 1 ? '▲' : '▼'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {spec.columns.map((c, j) => (
                <td key={c.key} className={j === 0 ? 'nm2' : undefined}>
                  {cell(row[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **2.6 Run, expect pass:** `npx vitest run src/renderer/src/components/rich/RichTable.test.tsx`

- [ ] **2.7 Failing test — RichChart.** Create `src/renderer/src/components/rich/RichChart.test.tsx` (fixed-size charts, no `ResponsiveContainer` — it renders zero-size in jsdom):

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import RichChart from './RichChart'

const spec = {
  type: 'bar' as const,
  title: 'Boon uptime',
  xKey: 'boon',
  series: [{ key: 'uptime', label: 'Uptime %' }],
  rows: [
    { boon: 'Might', uptime: 92 },
    { boon: 'Quickness', uptime: 71 }
  ]
}

describe('RichChart', () => {
  it('renders the title and an svg chart surface', () => {
    const { getByText, container } = render(<RichChart spec={spec} />)
    expect(getByText('Boon uptime')).toBeTruthy()
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders one series element per series for line charts', () => {
    const { container } = render(
      <RichChart
        spec={{
          ...spec,
          type: 'line',
          series: [
            { key: 'uptime', label: 'Uptime %' },
            { key: 'target', label: 'Target %', color: '#6fae6f' }
          ]
        }}
      />
    )
    expect(container.querySelectorAll('.recharts-line')).toHaveLength(2)
  })
})
```

- [ ] **2.8 Run, expect failure:** `npx vitest run src/renderer/src/components/rich/RichChart.test.tsx`

- [ ] **2.9 Implement** `src/renderer/src/components/rich/RichChart.tsx` — Recharts dressed in the newspaper palette (`theme.css` `:root` lines 2–6: ink `#e4e3dc`, dim `#a6a69e`, faint `#6a6b6e`, rule `#3a3d44`, paper `#1f2025`, accent `#e05a50`, green `#6fae6f`):

```tsx
import type { ReactElement } from 'react'
import {
  LineChart, BarChart, AreaChart, Line, Bar, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts'
import type { DisplayPayload } from '../../state'

type ChartSpec = Extract<DisplayPayload, { kind: 'chart' }>['data']

/** Series fall back to rotating gazette inks when no color is specified. */
const PALETTE = ['#e05a50', '#6fae6f', '#a6a69e', '#c8984a', '#7a9cc6', '#b07ab0']

const MONO = "'IBM Plex Mono', monospace"
const AXIS_TICK = { fill: '#6a6b6e', fontSize: 9, fontFamily: MONO } as const
const TOOLTIP_STYLE = {
  background: '#1f2025',
  border: '1px dashed #46494f',
  borderRadius: 0,
  fontFamily: MONO,
  fontSize: 11,
  color: '#e4e3dc'
} as const

// Fixed canvas: coupons cap at 620px wide; ResponsiveContainer needs a
// measured parent and renders 0×0 in jsdom, so we size explicitly.
const WIDTH = 560
const HEIGHT = 240

export default function RichChart({ spec }: { spec: ChartSpec }): ReactElement {
  const color = (i: number): string => spec.series[i].color ?? PALETTE[i % PALETTE.length]
  const common = { data: spec.rows, width: WIDTH, height: HEIGHT, margin: { top: 8, right: 12, bottom: 4, left: 0 } }
  const axes = (
    <>
      <CartesianGrid stroke="#2e3036" strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey={spec.xKey} tick={AXIS_TICK} stroke="#3a3d44" tickLine={false} />
      <YAxis tick={AXIS_TICK} stroke="#3a3d44" tickLine={false} width={36} />
      <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: '#46494f', fill: 'rgba(255,255,255,.04)' }} />
      <Legend wrapperStyle={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase' }} />
    </>
  )

  let chart: ReactElement
  if (spec.type === 'bar') {
    chart = (
      <BarChart {...common}>
        {axes}
        {spec.series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={color(i)} isAnimationActive={false} />
        ))}
      </BarChart>
    )
  } else if (spec.type === 'area') {
    chart = (
      <AreaChart {...common}>
        {axes}
        {spec.series.map((s, i) => (
          <Area key={s.key} dataKey={s.key} name={s.label} stroke={color(i)}
            fill={color(i)} fillOpacity={0.18} strokeWidth={1.5} isAnimationActive={false} />
        ))}
      </AreaChart>
    )
  } else {
    chart = (
      <LineChart {...common}>
        {axes}
        {spec.series.map((s, i) => (
          <Line key={s.key} dataKey={s.key} name={s.label} stroke={color(i)}
            strokeWidth={1.5} dot={{ r: 2.5, fill: color(i) }} isAnimationActive={false} />
        ))}
      </LineChart>
    )
  }

  return (
    <div className="rich richchart">
      <div className="rich-title">{spec.title}</div>
      {chart}
    </div>
  )
}
```

- [ ] **2.10 Run, expect pass:** `npx vitest run src/renderer/src/components/rich/RichChart.test.tsx`

- [ ] **2.11 Failing test — ToolCoupon renders rich blocks.** Create `src/renderer/src/components/ToolCoupon.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import ToolCoupon from './ToolCoupon'
import type { ToolCall } from '../state'

function doneTool(extra: Partial<ToolCall>): ToolCall {
  return { id: 't1', name: 'gw2_api', input: {}, resultText: '{"ok":true}', isError: false, ...extra }
}

describe('ToolCoupon rich displays', () => {
  it('renders a table block instead of the generic body when display.kind=table', () => {
    const { container, getByText } = render(
      <ToolCoupon
        tool={doneTool({
          display: {
            kind: 'table',
            data: { title: 'Roster', columns: [{ key: 'n', label: 'Name' }], rows: [{ n: 'Tessa' }] }
          }
        })}
      />
    )
    expect(container.querySelector('.richtable')).toBeTruthy()
    expect(getByText('Tessa')).toBeTruthy()
    expect(container.querySelector('.manifest')).toBeNull()
  })

  it('renders a chart block when display.kind=chart', () => {
    const { container } = render(
      <ToolCoupon
        tool={doneTool({
          display: {
            kind: 'chart',
            data: { type: 'bar', title: 'Kills', xKey: 'day', series: [{ key: 'k', label: 'Kills' }], rows: [{ day: 'Mon', k: 4 }] }
          }
        })}
      />
    )
    expect(container.querySelector('.richchart svg')).toBeTruthy()
  })

  it('falls back to the generic body when there is no display', () => {
    const { container } = render(<ToolCoupon tool={doneTool({})} />)
    expect(container.querySelector('.manifest')).toBeTruthy()
  })
})
```

- [ ] **2.12 Run, expect failure:** `npx vitest run src/renderer/src/components/ToolCoupon.test.tsx`

- [ ] **2.13 Implement.** Create `src/renderer/src/components/rich/RichDisplay.tsx` (the kind switch — Task 4 extends it with the card kinds; until then unknown kinds fall back to `null` and ToolCoupon's caller falls back to the generic body):

```tsx
import type { ReactElement } from 'react'
import type { DisplayPayload } from '../../state'
import RichChart from './RichChart'
import RichTable from './RichTable'

/** Returns the rich block for a display payload, or null when this build of
 *  the app has no renderer for the kind (the coupon then shows generic copy). */
export default function RichDisplay({ display }: { display: DisplayPayload }): ReactElement | null {
  switch (display.kind) {
    case 'chart':
      return <RichChart spec={display.data} />
    case 'table':
      return <RichTable spec={display.data} />
    default:
      return null
  }
}
```

In `ToolCoupon.tsx`, import it and replace the body line in the default export (line 184–185 region):

```tsx
import RichDisplay from './rich/RichDisplay'
```

```tsx
      <div className="tb">
        {hasInput && <div className="tin">{humanInput(tool.input)}</div>}
        {!working &&
          (tool.display && !tool.isError ? (
            <RichDisplay display={tool.display} /> ?? renderBody(tool)
          ) : (
            renderBody(tool)
          ))}
      </div>
```

Note: JSX can't `??` a component render result directly — implement as:

```tsx
        {!working && renderCouponBody(tool)}
```

with, above the component:

```tsx
function renderCouponBody(tool: ToolCall): ReactElement {
  if (tool.display && !tool.isError) {
    const rich = RichDisplay({ display: tool.display })
    if (rich !== null) return rich
  }
  return renderBody(tool)
}
```

- [ ] **2.14 Append coupon-block CSS** to `theme.css` after line 146 (`.endmark` rule):

```css
/* rich display blocks inside tool coupons */
.rich{margin-top:6px}
.rich .rich-title{font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-dim);border-bottom:1px solid var(--rule);padding-bottom:5px;margin-bottom:8px}
.richtable th{cursor:pointer;user-select:none}
.richtable th:hover{color:var(--ink)}
.richtable th .arr{color:var(--accent-b);margin-left:5px;font-size:8px}
.richchart{overflow-x:auto}
.richchart .recharts-legend-item-text{color:var(--ink-dim) !important}
.richchart .recharts-text{fill:var(--faint)}
```

- [ ] **2.15 Run, expect pass:** `npx vitest run src/renderer/src/components/ToolCoupon.test.tsx && npx vitest run && npm run typecheck`

- [ ] **2.16 Sanity-check the bundle:** `npm run build` (electron-vite must tree-shake/bundle recharts into the renderer without warnings).

- [ ] **2.17 Commit** in axivale: `feat: chart and table rich blocks in tool coupons (Recharts, newspaper theme)`

---

## Task 3: Extract `@axiapps/forge-render` workspace package in the AxiForge repo

**Files (all under /var/home/mstephens/Documents/GitHub/axiforge):**
- Create: `packages/forge-render/package.json`, `packages/forge-render/src/index.js`
- Move (git mv, then fix imports): `src/renderer/modules/mini-build-card.js` → `packages/forge-render/src/mini-build-card.js`; `src/renderer/modules/build-helpers.js` → `packages/forge-render/src/build-helpers.js`; `src/renderer/modules/profession-icons.js` → `packages/forge-render/src/profession-icons.js`; `src/renderer/modules/weapon-icons.js` → `packages/forge-render/src/weapon-icons.js`
- Create: `packages/forge-render/src/escape.js`, `packages/forge-render/src/weapons.js` (extracted `GW2_WEAPONS` from `src/renderer/modules/constants.js` lines 127–245), `packages/forge-render/src/role-estimator.js` (adapted from `src/renderer/modules/roleEstimator.js`), `packages/forge-render/src/comp-card.js` (new, modeled on `src/site/render-comp.js` lines 40–105), `packages/forge-render/src/hover-preview.js` (new, positioning logic from `src/renderer/modules/detail-panel.js` lines 193–235 and 612–632)
- Create: `scripts/extract-forge-render-css.mjs` (one-shot), producing `packages/forge-render/src/forge-render.css` and `src/renderer/styles/forge-render-bridge.css`
- Replace with re-export shims: `src/renderer/modules/mini-build-card.js`, `build-helpers.js`, `profession-icons.js`, `weapon-icons.js` (kept as 1-line shims so the 12 existing importers, listed below, don't change); modify `src/renderer/modules/constants.js` (weapons re-export) and `src/renderer/modules/roleEstimator.js` (shim)
- Modify: `src/renderer/styles.css` (lines 11, 23, 24), `src/site/styles.css` (lines 12, 14, 15), `src/renderer/renderer.js`, `src/site/main.js` (add body class), `package.json` (jest `transform` block)
- Create: `tests/forge-render/mini-build-card.test.js`, `tests/forge-render/role-estimator.test.js`

Existing importers that keep working via shims: `src/renderer/renderer.js`, `src/site/render-comp.js`, `src/renderer/modules/{detail-modal,render-pages,equipment}.js`, `src/renderer/modules/comps/{comp-detail,comp-list,comp-boon-coverage}.js`, `src/renderer/modules/library/{toolbar,content}.js`.

### Steps

- [ ] **3.1 Failing test first.** Create `tests/forge-render/mini-build-card.test.js` (root Jest config already maps `?raw` imports via `moduleNameMapper` and will get a transform entry in 3.2):

```js
const { renderMiniBuildCard, renderMissingMiniBuildCard } = require("../../packages/forge-render/src/index.js");

const build = {
  id: "b1",
  title: "Quickness Firebrand",
  profession: "Guardian",
  gameMode: "wvw",
  tags: ["meta"],
  specializations: [
    { name: "Radiance" },
    { name: "Honor" },
    { name: "Firebrand", elite: true },
  ],
  equipment: {
    weapons: { mainhand1: "axe", offhand1: "shield", mainhand2: "staff" },
    statPackage: "Celestial",
    runes: { helm: "24836", chest: "24836" },
    relic: "Relic of the Defender",
  },
};

describe("@axiapps/forge-render mini build card", () => {
  test("renders name, profession class, mode, and weapon labels", () => {
    const html = renderMiniBuildCard(build, null, { showActions: false });
    expect(html).toContain("Quickness Firebrand");
    expect(html).toContain("lib-prof--guardian");
    expect(html).toContain("wvw");
    expect(html).toContain("Axe");
    expect(html).toContain("Staff");
    expect(html).toContain("Celestial");
    expect(html).toContain("Relic of the Defender");
  });

  test("escapes html in titles", () => {
    const html = renderMiniBuildCard({ ...build, title: "<img src=x>" }, null, { showActions: false });
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;img");
  });

  test("renders the missing-build placeholder", () => {
    expect(renderMissingMiniBuildCard("deadbeefdeadbeef")).toContain("Missing Build");
  });
});
```

Run, expect failure (package does not exist): `cd /var/home/mstephens/Documents/GitHub/axiforge && npx jest tests/forge-render`

- [ ] **3.2 Scaffold the package** following the `packages/gw2-data` pattern. `packages/forge-render/package.json`:

```json
{
  "name": "@axiapps/forge-render",
  "version": "0.1.0",
  "description": "Framework-free AxiForge build/comp card renderers + scoped CSS, shared with AxiVale and AxiBridge",
  "main": "src/index.js",
  "exports": {
    ".": "./src/index.js",
    "./forge-render.css": "./src/forge-render.css"
  },
  "scripts": {
    "test": "jest"
  },
  "jest": {
    "testEnvironment": "node",
    "testMatch": ["**/packages/forge-render/tests/**/*.test.js"],
    "clearMocks": true
  },
  "license": "MIT",
  "keywords": ["gw2", "guild-wars-2", "build-card", "axiforge", "axivale"],
  "repository": {
    "type": "git",
    "url": "https://github.com/darkharasho/axiforge",
    "directory": "packages/forge-render"
  },
  "dependencies": {
    "@axiapps/gw2-data": "file:../gw2-data",
    "gw2-class-icons": "^0.3.0"
  }
}
```

(`workspaces: ["packages/*"]` in the root `package.json` already picks this up — run `npm install` at the axiforge root after creating it.) Add to the root `package.json` jest `transform` block (the package uses ESM + `?raw` like `src/renderer`):

```json
    "transform": {
      "^.+/src/renderer/.+\\.js$": ["babel-jest", {}],
      "^.+/packages/forge-render/.+\\.js$": ["babel-jest", {}]
    },
```

- [ ] **3.3 Move the modules.**

```bash
cd /var/home/mstephens/Documents/GitHub/axiforge
mkdir -p packages/forge-render/src packages/forge-render/tests
git mv src/renderer/modules/mini-build-card.js packages/forge-render/src/mini-build-card.js
git mv src/renderer/modules/build-helpers.js   packages/forge-render/src/build-helpers.js
git mv src/renderer/modules/profession-icons.js packages/forge-render/src/profession-icons.js
git mv src/renderer/modules/weapon-icons.js     packages/forge-render/src/weapon-icons.js
```

Create `packages/forge-render/src/escape.js` (the only thing mini-build-card uses from `utils.js`):

```js
// HTML escaping for string-template renderers. DOM-free so the package
// works in Node tests and any bundler.
export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

Create `packages/forge-render/src/weapons.js` by cutting `GW2_WEAPONS` (constants.js lines 127–148, including the `_WK` wiki-URL prefix constant it uses) and the `GW2_WEAPONS_BY_ID` map (line 245) out of `src/renderer/modules/constants.js`, then add the re-export in `constants.js` where they were removed:

```js
export { GW2_WEAPONS, GW2_WEAPONS_BY_ID } from "../../../packages/forge-render/src/weapons.js";
```

Fix imports inside the moved files: in `mini-build-card.js` change lines 3–16 to:

```js
import { escapeHtml } from "./escape.js";
import { GW2_WEAPONS_BY_ID } from "./weapons.js";
import { getProfessionSvg, getProfessionSvgColored } from "./profession-icons.js";
import { getWeaponSvg } from "./weapon-icons.js";

import {
  getSpecIcon,
  getSpecIconColored,
  profClass,
  getDisplayName,
  resolveStatPackage,
  getRuneName,
} from "./build-helpers.js";
import { roleBadgeHtml } from "./role-estimator.js";
```

(`build-helpers.js`'s only import, `./profession-icons.js`, is already correct after the move; `profession-icons.js`/`weapon-icons.js` import only from `gw2-class-icons` and need no changes.)

- [ ] **3.4 Adapt the role estimator into the package.** Create `packages/forge-render/src/role-estimator.js` as a copy of `src/renderer/modules/roleEstimator.js` with exactly one change — replace line 2 (`import { computeSlotStats } from './stats.js';`) and make `scoreEquipmentSlots` read the build's own weapons/gameMode through the pure engine function instead of editor state:

```js
// Role estimation from equipment stats — pure functions, no app state.
// Slot stat math comes from the shared engine; we feed it the build's own
// weapon set and game mode (the desktop app previously read editor state,
// which is wrong for library/chat cards anyway).
import * as _engine from "@axiapps/gw2-data/engine";
const engine = _engine.default || _engine;
const { computeSlotStats } = engine;
```

and change the `scoreEquipmentSlots(slots)` signature/body to:

```js
function scoreEquipmentSlots(build) {
  const slots = build?.equipment?.slots || {};
  const weapons = build?.equipment?.weapons || {};
  const gameMode = build?.gameMode || "pve";
  const totals = {
    Power: 0, Precision: 0, Toughness: 0, Vitality: 0,
    Ferocity: 0, ConditionDamage: 0, Expertise: 0, Concentration: 0, HealingPower: 0,
  };
  for (const [slotKey, label] of Object.entries(slots)) {
    if (!label) continue;
    for (const { stat, value } of computeSlotStats(label, slotKey, weapons, gameMode)) {
      if (stat in totals) totals[stat] += value;
    }
  }
  return totals;
}
```

with the call site in `estimateRole` updated to `const equipStats = scoreEquipmentSlots(build);`. Everything else (scorers, rune scoring, `roleBadgeHtml`) is copied unchanged. Then replace `src/renderer/modules/roleEstimator.js` with the shim:

```js
export { estimateRole, roleBadgeHtml } from "../../../packages/forge-render/src/role-estimator.js";
```

Create `tests/forge-render/role-estimator.test.js`:

```js
const { estimateRole } = require("../../packages/forge-render/src/role-estimator.js");

describe("forge-render role estimator", () => {
  test("full berserker gear scores Power DPS", () => {
    const slots = {};
    for (const k of ["helm", "shoulders", "chest", "gloves", "leggings", "boots",
                     "amulet", "ring1", "ring2", "accessory1", "accessory2", "backpack"]) {
      slots[k] = "Berserker";
    }
    const build = {
      profession: "Warrior",
      gameMode: "pve",
      equipment: { slots, weapons: { mainhand1: "greatsword" } },
    };
    expect(estimateRole(build)).toBe("Power DPS");
  });

  test("no equipped slots yields null", () => {
    expect(estimateRole({ equipment: { slots: {} } })).toBeNull();
  });
});
```

- [ ] **3.5 New package module — comp card.** Create `packages/forge-render/src/comp-card.js` (party lines + build pool, modeled on `src/site/render-comp.js` `renderSlot`/`renderPartyLines`/`renderBuildPool` but taking `(comp, buildsById, catalog)` instead of the SPA's embedded `comp.builds`):

```js
// Comp card — party lines + mini build cards for a squad composition.
// comp: AxiForge comp record ({ title, partyLines, buildColors, tags }).
// buildsById: plain object of build records keyed by id.
// catalog: upgradeCatalog with runeById/relicByName Maps, or null.
import { escapeHtml } from "./escape.js";
import { profClass, getDisplayName, getSpecIcon, getSpecIconColored } from "./build-helpers.js";
import { renderMiniBuildCard, renderMissingMiniBuildCard } from "./mini-build-card.js";

function renderSlot(build, color) {
  if (!build) return `<div class="comp-slot comp-slot--empty"></div>`;
  const icon = color && color !== "normal" ? getSpecIconColored(build, color) : getSpecIcon(build);
  const colorAttr = color && color !== "normal" ? ` data-slot-color="${color}"` : "";
  return `
    <div class="comp-slot comp-slot--filled ${profClass(build.profession)}"${colorAttr}
         title="${escapeHtml(getDisplayName(build))}">
      <span class="comp-slot__icon">${icon || escapeHtml((build.profession || "?")[0])}</span>
    </div>`;
}

function renderPartyLines(comp, buildsById) {
  const colors = comp.buildColors || {};
  return (comp.partyLines || []).map((line, idx) => {
    const slots = line.slots || [];
    const capacity = line.capacity || 5;
    const boxes = slots.map((id) => renderSlot(buildsById[id], colors[id] || "normal"));
    for (let i = slots.length; i < capacity; i++) {
      boxes.push(`<div class="comp-slot comp-slot--empty"></div>`);
    }
    return `
      <div class="comp-line">
        <span class="comp-line__label">P${idx + 1}</span>
        <div class="comp-line__slots">${boxes.join("")}</div>
        <span class="comp-line__count">${slots.length} / ${capacity}</span>
      </div>`;
  }).join("");
}

export function renderCompCard(comp, buildsById = {}, catalog = null) {
  const colors = comp.buildColors || {};
  const referenced = [...new Set((comp.partyLines || []).flatMap((l) => l.slots || []))];
  const pool = referenced
    .map((id) =>
      buildsById[id]
        ? renderMiniBuildCard(buildsById[id], catalog, {
            showActions: false,
            slotColor: colors[id] || null,
          })
        : renderMissingMiniBuildCard(id)
    )
    .join("");
  const tags = (comp.tags || [])
    .map((t) => `<span class="comp-card__tag">${escapeHtml(t)}</span>`)
    .join("");
  return `
    <div class="comp-card">
      <div class="comp-card__head">
        <span class="comp-card__name">${escapeHtml(comp.title || "Untitled comp")}</span>
        ${tags}
      </div>
      <div class="comp-card__lines">${renderPartyLines(comp, buildsById)}</div>
      <div class="comp-card__pool">${pool}</div>
    </div>`;
}
```

- [ ] **3.6 New package module — hover preview.** Create `packages/forge-render/src/hover-preview.js`. The bind/position mechanics are lifted from `src/renderer/modules/detail-panel.js` (`bindHoverPreview` lines 193–235, `positionHoverPreview` lines 612–632); the content renderer is a self-contained catalog-entity card (the desktop app's full fact pipeline stays in detail-panel.js — see "not covered" note):

```js
// Standalone hover preview: a fixed-position card that follows the cursor.
// Framework-free; the host owns the container element and what HTML to show.
import { escapeHtml } from "./escape.js";

export function positionHoverPreview(node, x, y) {
  if (!node || node.classList.contains("hidden")) return;
  const pad = 8;
  const offset = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rect = node.getBoundingClientRect();
  let left = Number(x) + offset;
  let top = Number(y) + offset;
  if (left + rect.width > vw - pad) left = Number(x) - rect.width - offset;
  if (top + rect.height > vh - pad) top = Number(y) - rect.height - offset;
  left = Math.max(pad, Math.min(left, vw - rect.width - pad));
  top = Math.max(pad, Math.min(top, vh - rect.height - pad));
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
}

/** Minimal entity card for catalog records ({ name, icon, description, facts? }). */
export function renderEntityHoverHtml(entity, meta = "") {
  if (!entity) return "";
  const icon = entity.icon
    ? `<img class="hover-preview__icon" src="${escapeHtml(entity.icon)}" alt="" loading="lazy">`
    : "";
  const facts = (entity.facts || [])
    .filter((f) => f && f.text)
    .slice(0, 8)
    .map((f) => `<li>${escapeHtml(f.text)}${f.value !== undefined ? `: ${escapeHtml(String(f.value))}` : ""}</li>`)
    .join("");
  return `
    <div class="hover-preview__head">
      ${icon}
      <div>
        <p class="hover-preview__title">${escapeHtml(entity.name || "")}</p>
        ${meta ? `<p class="hover-preview__meta">${escapeHtml(meta)}</p>` : ""}
      </div>
    </div>
    ${entity.description ? `<p class="hover-preview__desc">${escapeHtml(entity.description)}</p>` : ""}
    ${facts ? `<ul class="hover-preview__bonuses">${facts}</ul>` : ""}`;
}

/**
 * Creates a hover-preview controller bound to a host element. The card node
 * is appended to `host` (give the host class="forge-render" so the scoped
 * CSS applies). Returns { bind, hide, destroy }.
 */
export function createHoverPreview(host) {
  const node = document.createElement("div");
  node.className = "hover-preview hidden";
  host.appendChild(node);
  const unbinders = [];

  const show = (html, x, y) => {
    node.innerHTML = html;
    node.classList.remove("hidden");
    positionHoverPreview(node, x, y);
  };
  const hide = () => node.classList.add("hidden");

  const bind = (target, htmlProvider) => {
    const read = () => (typeof htmlProvider === "function" ? htmlProvider() : htmlProvider || "");
    const onEnter = (event) => {
      const html = read();
      if (html) show(html, event.clientX, event.clientY);
    };
    const onMove = (event) => positionHoverPreview(node, event.clientX, event.clientY);
    const onLeave = () => hide();
    target.addEventListener("mouseenter", onEnter);
    target.addEventListener("mousemove", onMove);
    target.addEventListener("mouseleave", onLeave);
    unbinders.push(() => {
      target.removeEventListener("mouseenter", onEnter);
      target.removeEventListener("mousemove", onMove);
      target.removeEventListener("mouseleave", onLeave);
    });
  };

  const destroy = () => {
    for (const un of unbinders) un();
    node.remove();
  };

  return { bind, hide, destroy };
}
```

- [ ] **3.7 Package index.** Create `packages/forge-render/src/index.js`:

```js
export { renderMiniBuildCard, renderMissingMiniBuildCard } from "./mini-build-card.js";
export { renderCompCard } from "./comp-card.js";
export { createHoverPreview, positionHoverPreview, renderEntityHoverHtml } from "./hover-preview.js";
export { estimateRole, roleBadgeHtml } from "./role-estimator.js";
export {
  getEliteSpecName, getSpecIcon, getSpecIconColored,
  profClass, getDisplayName, resolveStatPackage, getRuneName,
} from "./build-helpers.js";
export { getProfessionSvg, getProfessionSvgColored } from "./profession-icons.js";
export { getWeaponSvg } from "./weapon-icons.js";
export { GW2_WEAPONS, GW2_WEAPONS_BY_ID } from "./weapons.js";
export { escapeHtml } from "./escape.js";
```

And the renderer-module shims (so the 12 existing importers compile unchanged):

`src/renderer/modules/mini-build-card.js`:
```js
export { renderMiniBuildCard, renderMissingMiniBuildCard } from "../../../packages/forge-render/src/mini-build-card.js";
```
`src/renderer/modules/build-helpers.js`:
```js
export * from "../../../packages/forge-render/src/build-helpers.js";
```
`src/renderer/modules/profession-icons.js`:
```js
export { getProfessionSvg, getProfessionSvgColored } from "../../../packages/forge-render/src/profession-icons.js";
```
`src/renderer/modules/weapon-icons.js`:
```js
export { getWeaponSvg } from "../../../packages/forge-render/src/weapon-icons.js";
```

- [ ] **3.8 Run package tests, expect pass:** `npm install && npx jest tests/forge-render` — then the full suite `npx jest` (existing renderer tests exercise the shims).

- [ ] **3.9 Scoped CSS.** Create the one-shot generator `scripts/extract-forge-render-css.mjs`. It takes the three style sources (`src/renderer/styles/mini-build-card.css` — 530 lines, `src/renderer/styles/role-badge.css` — 55 lines, and the `.hover-preview*` rule blocks from `src/renderer/styles/detail-panel.css` lines 92–~200), prefixes every selector with `.forge-render `, and rewrites every `var(--x…)` reference to a namespaced `var(--fr-x, <default>)` so the package can never collide with a host app's theme variables (AxiVale's `theme.css` already defines `--line` and `--accent` with different meanings). It also emits a theme bridge for AxiForge that maps its live theme vars onto the `--fr-*` names, so AxiForge themes keep working:

```js
// scripts/extract-forge-render-css.mjs — one-shot extraction of forge-render CSS.
// Run once with `node scripts/extract-forge-render-css.mjs`, review output, delete sources.
import { readFileSync, writeFileSync } from "node:fs";

// Every custom property referenced by the three source files, with its
// default value copied verbatim from src/renderer/styles/base.css :root.
// The script THROWS on any var() it finds that is missing here — when it
// does, copy that property's value from base.css and add it to this map.
const DEFAULTS = {
  "panel": "#141518",
  "panel-2": "#101114",
  "line": "#1e1f24",
  "line-soft": "#181920",
  "text": "#e2e3e8",
  "text-light": "#aeafb8",
  "text-dim": "#646670",
  "muted": "#828490",
  "accent-rgb": "200, 152, 72",
  "accent": "rgb(200, 152, 72)",
  "gold": "#e8b050",
  "danger-text": "#f87171",
  "hover-subtle": "rgba(255, 255, 255, 0.05)",
  "hover-accent": "rgba(200, 152, 72, 0.12)",
  "radius-sm": "6px",
  "radius-xs": "4px",
  // ↓ verify/add from base.css when the script reports them:
  // "bg-raised", "bg-tertiary", "border", "hover", "z-tooltip",
  // "surface", "panel-gradient", "text-secondary"
};

function extractHoverRules(css) {
  // Pull whole top-level rule blocks whose selector mentions .hover-preview.
  const out = [];
  const re = /(^|\n)([^@{}][^{}]*\.hover-preview[^{}]*)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) out.push(`${m[2].trim()} {${m[3]}}`);
  return out.join("\n\n");
}

function prefixSelectors(css) {
  // Prefix each comma-separated selector of every top-level rule. The three
  // source files contain no nested at-rules other than @media, whose inner
  // rules this regex also matches because they look identical.
  return css.replace(/(^|\n)([ \t]*)([^@\s{}/][^{}]*)\{/g, (_, nl, indent, sel) => {
    const prefixed = sel
      .split(",")
      .map((s) => `.forge-render ${s.trim()}`)
      .join(",\n");
    return `${nl}${indent}${prefixed} {`;
  });
}

function namespaceVars(css) {
  const missing = new Set();
  const out = css.replace(/var\(--([a-z0-9-]+)(\s*,[^)]*)?\)/g, (whole, name) => {
    if (!(name in DEFAULTS)) {
      missing.add(name);
      return whole;
    }
    return `var(--fr-${name}, ${DEFAULTS[name]})`;
  })
  // bare rgba(var(--accent-rgb), x) usages
  .replace(/var\(--fr-accent-rgb, 200, 152, 72\)/g, "var(--fr-accent-rgb, 200, 152, 72)");
  if (missing.size) {
    throw new Error(`Add defaults from base.css :root for: ${[...missing].join(", ")}`);
  }
  return out;
}

const mini = readFileSync("src/renderer/styles/mini-build-card.css", "utf8");
const role = readFileSync("src/renderer/styles/role-badge.css", "utf8");
const hover = extractHoverRules(readFileSync("src/renderer/styles/detail-panel.css", "utf8"));

const compCard = `
/* ── Comp card (chat embeds) ─────────────────────────────────────────── */
.comp-card { display: flex; flex-direction: column; gap: 10px; }
.comp-card__head { display: flex; align-items: baseline; gap: 8px; }
.comp-card__name { font-size: 14px; font-weight: 600; color: var(--text-light); }
.comp-card__tag { font-size: 10px; padding: 1px 7px; border-radius: 999px;
  border: 1px solid var(--line); color: var(--muted); }
.comp-card__lines { display: flex; flex-direction: column; gap: 6px; }
.comp-line { display: flex; align-items: center; gap: 8px; }
.comp-line__label { font-size: 10px; color: var(--muted); width: 20px; flex-shrink: 0; }
.comp-line__slots { display: flex; gap: 4px; flex-wrap: wrap; }
.comp-line__count { margin-left: auto; font-size: 10px; color: var(--muted); }
.comp-slot { width: 30px; height: 30px; border-radius: var(--radius-xs);
  display: flex; align-items: center; justify-content: center;
  background: var(--panel-2); border: 1px solid var(--line); }
.comp-slot--empty { border-style: dashed; opacity: 0.45; }
.comp-slot__icon svg { width: 20px; height: 20px; }
.comp-card__pool { display: flex; flex-direction: column; gap: 8px; }
`;

const header = `/* @axiapps/forge-render — generated once by scripts/extract-forge-render-css.mjs,
   hand-maintained afterwards. All selectors are scoped under .forge-render and
   all theme variables are namespaced --fr-* with baked-in AxiForge dark
   defaults, so embedding apps (AxiVale) can't collide with these styles. */
`;

writeFileSync(
  "packages/forge-render/src/forge-render.css",
  header + namespaceVars(prefixSelectors([mini, role, hover, compCard].join("\n\n")))
);

// Theme bridge for AxiForge itself: map live theme vars → --fr-* names.
const bridge = `.forge-render {\n${Object.keys(DEFAULTS)
  .map((name) => `  --fr-${name}: var(--${name});`)
  .join("\n")}\n}\n`;
writeFileSync("src/renderer/styles/forge-render-bridge.css", bridge);

console.log("wrote packages/forge-render/src/forge-render.css and src/renderer/styles/forge-render-bridge.css");
```

Run `node scripts/extract-forge-render-css.mjs`; when it throws on missing vars (`bg-raised`, `bg-tertiary`, `border`, `hover`, `z-tooltip`, `surface`, `panel-gradient`, `text-secondary`), copy each value from `src/renderer/styles/base.css` `:root` into `DEFAULTS` and rerun (`z-tooltip` and `panel-gradient`/`surface` get their base.css values; `text-secondary` already has an inline fallback in detail-panel.css — give it `#b0b0b0`). Review the generated file, then delete the now-superseded sources and the script:

```bash
git rm src/renderer/styles/mini-build-card.css src/renderer/styles/role-badge.css scripts/extract-forge-render-css.mjs
```

Also delete the `.hover-preview*` rule blocks from `src/renderer/styles/detail-panel.css` (lines 92–~200) — they now live in the package.

- [ ] **3.10 Consume the CSS back in AxiForge** (single copy). In `src/renderer/styles.css` replace lines 23–24 (`@import "./styles/mini-build-card.css";` / `@import "./styles/role-badge.css";`) with:

```css
@import "../../packages/forge-render/src/forge-render.css";
@import "./styles/forge-render-bridge.css";
```

In `src/site/styles.css` replace lines 14–15 (`@import "../renderer/styles/mini-build-card.css";` / `@import "../renderer/styles/role-badge.css";`) with:

```css
@import "../../packages/forge-render/src/forge-render.css";
@import "../renderer/styles/forge-render-bridge.css";
```

The scoped selectors require an ancestor `.forge-render` class — put it on the body so all existing markup matches. In `src/renderer/renderer.js`, immediately after the module imports at the top, add:

```js
document.body.classList.add("forge-render");
```

and the same line near the top of `src/site/main.js`.

- [ ] **3.11 Verify AxiForge still builds and tests pass:**

```bash
cd /var/home/mstephens/Documents/GitHub/axiforge
npx jest
npm run build:renderer && npm run build:site
```

Then a visual smoke test: `npm run dev`, open a comp, confirm mini build cards, role badges, and skill hover previews look unchanged (theme switcher included).

- [ ] **3.12 Commit** in axiforge: `feat: extract @axiapps/forge-render workspace package (cards, role badges, hover preview, scoped CSS)`

---

## Task 4: `<ForgeCard>` wrapper + `build-card` / `comp-card` kinds in AxiVale

**Files (all under /var/home/mstephens/Documents/GitHub/axivale):**
- Modify: `package.json` (add `"@axiapps/forge-render": "file:../axiforge/packages/forge-render"` to `dependencies`)
- Modify: `electron.vite.config.ts` (renderer `optimizeDeps`)
- Create: `src/main/forgeCatalog.ts`, `src/main/forgeCatalog.test.ts`
- Modify: `src/main/index.ts` (register `axiforge:catalog-upgrades` IPC handler next to the other `ipcMain.handle` calls), `src/preload/index.ts` (add `forgeCatalog` method)
- Create: `src/renderer/src/components/rich/ForgeCard.tsx`, `src/renderer/src/components/rich/useForgeCatalog.ts`, `src/renderer/src/components/rich/ForgeCard.test.tsx`
- Modify: `src/renderer/src/components/rich/RichDisplay.tsx` (add the two kinds)
- Modify: `src/renderer/src/theme.css` (one container rule)

### Steps

- [ ] **4.1 Add the dependency and bundler config.**

```bash
cd /var/home/mstephens/Documents/GitHub/axivale
npm install @axiapps/forge-render@file:../axiforge/packages/forge-render
```

npm symlinks the package and resolves its nested `file:../gw2-data` dependency to `../axiforge/packages/gw2-data`. The package uses Vite `?raw` SVG imports, which esbuild's dependency pre-bundling cannot process — exclude it so Vite serves it as source (where `?raw` works) in dev; Rollup handles it natively at build time. `electron.vite.config.ts` becomes:

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    plugins: [react()],
    // forge-render ships raw ESM with Vite `?raw` SVG imports; esbuild
    // pre-bundling chokes on the query suffix, so serve it as source.
    optimizeDeps: { exclude: ['@axiapps/forge-render'] }
  }
})
```

- [ ] **4.2 Failing test — main-process catalog cache.** Create `src/main/forgeCatalog.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ForgeCatalogCache } from './forgeCatalog'

const upgrades = {
  runes: [{ id: 24836, name: 'Superior Rune of the Pack', icon: 'https://render.guildwars2.com/r.png', bonuses: ['+25 Power'] }],
  relics: [{ name: 'Relic of the Defender', icon: 'https://render.guildwars2.com/d.png' }]
}

function makeCache(fetcher: () => Promise<typeof upgrades>): ForgeCatalogCache {
  return new ForgeCatalogCache(mkdtempSync(join(tmpdir(), 'forge-cat-')), fetcher)
}

describe('ForgeCatalogCache', () => {
  it('fetches once and serves from cache within the TTL', async () => {
    const fetcher = vi.fn().mockResolvedValue(upgrades)
    const cache = makeCache(fetcher)
    expect(await cache.getUpgrades()).toEqual(upgrades)
    expect(await cache.getUpgrades()).toEqual(upgrades)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('persists across instances (disk cache)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-cat-'))
    const first = new ForgeCatalogCache(dir, vi.fn().mockResolvedValue(upgrades))
    await first.getUpgrades()
    const failing = vi.fn().mockRejectedValue(new Error('AxiForge not running'))
    const second = new ForgeCatalogCache(dir, failing)
    expect(await second.getUpgrades()).toEqual(upgrades)
    expect(failing).not.toHaveBeenCalled()
  })

  it('serves stale data when the API is down after TTL expiry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-cat-'))
    const cache = new ForgeCatalogCache(dir, vi.fn().mockResolvedValue(upgrades), 0) // ttl 0 = always stale
    await cache.getUpgrades()
    const down = new ForgeCatalogCache(dir, vi.fn().mockRejectedValue(new Error('down')), 0)
    expect(await down.getUpgrades()).toEqual(upgrades)
  })

  it('returns null when nothing is cached and the API is down', async () => {
    const cache = makeCache(vi.fn().mockRejectedValue(new Error('down')))
    expect(await cache.getUpgrades()).toBeNull()
  })
})
```

- [ ] **4.3 Run, expect failure:** `npx vitest run src/main/forgeCatalog.test.ts`

- [ ] **4.4 Implement** `src/main/forgeCatalog.ts`:

```ts
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface ForgeUpgradeCatalog {
  runes: Array<{ id: number; name: string; icon?: string; bonuses?: string[] }>
  relics: Array<{ name: string; icon?: string }>
}

interface CacheFile {
  fetchedAt: number
  upgrades: ForgeUpgradeCatalog
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Persistent cache for AxiForge catalog data used by inline cards.
 * Cards must render even when AxiForge is closed, so stale data is served
 * whenever a refresh fails; null only when we've never connected at all.
 * The fetcher is axiforgeClient.getCatalogUpgrades (sibling AxiForge plan).
 */
export class ForgeCatalogCache {
  private readonly file: string

  constructor(
    cacheDir: string,
    private readonly fetchUpgrades: () => Promise<ForgeUpgradeCatalog>,
    private readonly ttlMs: number = DEFAULT_TTL_MS
  ) {
    mkdirSync(cacheDir, { recursive: true })
    this.file = join(cacheDir, 'forge-catalog.json')
  }

  private read(): CacheFile | null {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as CacheFile
    } catch {
      return null
    }
  }

  async getUpgrades(): Promise<ForgeUpgradeCatalog | null> {
    const cached = this.read()
    if (cached && Date.now() - cached.fetchedAt < this.ttlMs) return cached.upgrades
    try {
      const upgrades = await this.fetchUpgrades()
      writeFileSync(this.file, JSON.stringify({ fetchedAt: Date.now(), upgrades } satisfies CacheFile))
      return upgrades
    } catch {
      return cached?.upgrades ?? null
    }
  }
}
```

- [ ] **4.5 Run, expect pass:** `npx vitest run src/main/forgeCatalog.test.ts`

- [ ] **4.6 Wire IPC.** In `src/main/index.ts`, next to the other `ipcMain.handle` registrations, construct the cache once (the `axiforgeClient` instance comes from the sibling AxiForge-integration plan; its `getCatalogUpgrades()` returns `{ runes, relics }`):

```ts
import { ForgeCatalogCache } from './forgeCatalog'
```

```ts
  const forgeCatalog = new ForgeCatalogCache(
    join(app.getPath('userData'), 'cache'),
    () => axiforgeClient.getCatalogUpgrades()
  )
  ipcMain.handle('axiforge:catalog-upgrades', () => forgeCatalog.getUpgrades())
```

In `src/preload/index.ts`, add inside the `exposeInMainWorld` object (after line 9 `axitoolsStatus`):

```ts
  forgeCatalogUpgrades: () => ipcRenderer.invoke('axiforge:catalog-upgrades'),
```

- [ ] **4.7 Failing test — ForgeCard.** Create `src/renderer/src/components/rich/ForgeCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import ForgeCard from './ForgeCard'

const build = {
  id: 'b1',
  title: 'Quickness Firebrand',
  profession: 'Guardian',
  gameMode: 'wvw',
  specializations: [{ name: 'Firebrand', elite: true }],
  equipment: { weapons: { mainhand1: 'axe', offhand1: 'shield' }, statPackage: 'Celestial' }
}

beforeEach(() => {
  ;(window as unknown as { officer: Record<string, unknown> }).officer = {
    forgeCatalogUpgrades: vi.fn().mockResolvedValue({ runes: [], relics: [] })
  }
})

describe('ForgeCard', () => {
  it('renders a scoped mini build card for build-card payloads', async () => {
    const { container } = render(
      <ForgeCard display={{ kind: 'build-card', data: { build } }} />
    )
    await waitFor(() => expect(container.querySelector('.mini-card')).toBeTruthy())
    expect(container.querySelector('.forge-render')).toBeTruthy()
    expect(container.textContent).toContain('Quickness Firebrand')
  })

  it('renders party lines and pool cards for comp-card payloads', async () => {
    const comp = {
      title: 'GvG Mainline',
      partyLines: [{ slots: ['b1'], capacity: 5 }],
      buildColors: {}
    }
    const { container } = render(
      <ForgeCard display={{ kind: 'comp-card', data: { comp, builds: { b1: build } } }} />
    )
    await waitFor(() => expect(container.querySelector('.comp-card')).toBeTruthy())
    expect(container.querySelectorAll('.comp-slot--filled')).toHaveLength(1)
    expect(container.querySelectorAll('.comp-slot--empty')).toHaveLength(4)
    expect(container.querySelector('.mini-card')).toBeTruthy()
  })
})
```

- [ ] **4.8 Run, expect failure:** `npx vitest run src/renderer/src/components/rich/ForgeCard.test.tsx`

- [ ] **4.9 Implement.** Create `src/renderer/src/components/rich/useForgeCatalog.ts` (module-level cache so every card on screen doesn't re-invoke IPC; converts arrays to the `runeById`/`relicByName` Maps the renderers expect):

```ts
import { useEffect, useState } from 'react'

interface RuneDef { id: number; name: string; icon?: string; bonuses?: string[] }
interface RelicDef { name: string; icon?: string }

export interface UpgradeCatalog {
  runeById: Map<number, RuneDef>
  relicByName: Map<string, RelicDef>
}

interface OfficerForgeApi {
  forgeCatalogUpgrades: () => Promise<{ runes: RuneDef[]; relics: RelicDef[] } | null>
}

let cached: UpgradeCatalog | null = null
let inflight: Promise<UpgradeCatalog | null> | null = null

async function load(): Promise<UpgradeCatalog | null> {
  if (cached) return cached
  inflight ??= (window as unknown as { officer: OfficerForgeApi }).officer
    .forgeCatalogUpgrades()
    .then((raw) => {
      if (!raw) return null
      cached = {
        runeById: new Map(raw.runes.map((r) => [r.id, r])),
        relicByName: new Map(raw.relics.map((r) => [r.name, r]))
      }
      return cached
    })
    .catch(() => null)
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Upgrade catalog for rune/relic names+icons on cards; null while loading
 *  or when AxiForge has never been reachable (cards degrade gracefully). */
export function useForgeCatalog(): UpgradeCatalog | null {
  const [catalog, setCatalog] = useState<UpgradeCatalog | null>(cached)
  useEffect(() => {
    if (catalog) return
    let alive = true
    void load().then((c) => {
      if (alive && c) setCatalog(c)
    })
    return () => {
      alive = false
    }
  }, [catalog])
  return catalog
}
```

Create `src/renderer/src/components/rich/ForgeCard.tsx`:

```tsx
import { useEffect, useRef, type ReactElement } from 'react'
import {
  renderMiniBuildCard,
  renderCompCard,
  createHoverPreview
} from '@axiapps/forge-render'
import '@axiapps/forge-render/forge-render.css'
import type { DisplayPayload } from '../../state'
import { useForgeCatalog } from './useForgeCatalog'

type CardDisplay = Extract<DisplayPayload, { kind: 'build-card' | 'comp-card' }>

/**
 * React wrapper around the framework-free @axiapps/forge-render renderers.
 * The package emits HTML strings styled by CSS scoped under .forge-render,
 * so AxiForge cards keep their own look inside the newspaper theme.
 */
export default function ForgeCard({ display }: { display: CardDisplay }): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const catalog = useForgeCatalog()

  useEffect(() => {
    const host = ref.current
    if (!host) return
    if (display.kind === 'build-card') {
      host.innerHTML = renderMiniBuildCard(display.data.build, catalog, { showActions: false })
    } else {
      host.innerHTML = renderCompCard(display.data.comp, display.data.builds, catalog)
    }
    // Hover cards: rune/relic icons get name tooltips from the catalog.
    const preview = createHoverPreview(host)
    return () => {
      preview.destroy()
      host.innerHTML = ''
    }
  }, [display, catalog])

  return <div className="rich forge-render forgecard" ref={ref} />
}
```

Extend `RichDisplay.tsx`'s switch:

```tsx
import ForgeCard from './ForgeCard'
```

```tsx
    case 'build-card':
    case 'comp-card':
      return <ForgeCard display={display} />
```

Append to `theme.css` (after the Task 2 rich-block rules):

```css
/* AxiForge cards keep their own design system inside the coupon */
.forgecard{font-family:system-ui,sans-serif;text-align:left;hyphens:none}
.forgecard .mini-card{cursor:default}
```

`@axiapps/forge-render` has no TypeScript types — add a declaration file `src/renderer/src/forge-render.d.ts`:

```ts
declare module '@axiapps/forge-render' {
  export function renderMiniBuildCard(
    build: Record<string, unknown>,
    catalog: unknown,
    options?: Record<string, unknown>
  ): string
  export function renderCompCard(
    comp: Record<string, unknown>,
    buildsById?: Record<string, Record<string, unknown>>,
    catalog?: unknown
  ): string
  export function createHoverPreview(host: HTMLElement): {
    bind: (target: HTMLElement, htmlProvider: string | (() => string)) => void
    hide: () => void
    destroy: () => void
  }
}
declare module '@axiapps/forge-render/forge-render.css'
```

- [ ] **4.10 Run, expect pass:** `npx vitest run src/renderer/src/components/rich/ForgeCard.test.tsx && npx vitest run && npm run typecheck`

- [ ] **4.11 Verify electron-vite bundles the linked package:** `npm run build` (must succeed — Rollup inlines the symlinked ESM source and the `?raw` SVGs), then `npm run dev` and confirm the app boots with no Vite resolve errors in the terminal.

- [ ] **4.12 Commit** in axivale: `feat: ForgeCard wrapper renders AxiForge build/comp cards via @axiapps/forge-render`

---

## Task 5: Attach display payloads in the AxiForge tool handlers

This task lands on top of the sibling AxiForge-integration plan, which creates `src/main/tools/axiforge.ts` exposing `buildAxiforgeTools(deps)` where `deps.forge` is the `AxiforgeClient` (`getBuild(id)`, `saveBuild(build)`, `getComp(id)`, `listBuilds()`…). If that plan has not executed yet, implement this task as part of its tool-handler steps instead.

**Files:**
- Modify: `/var/home/mstephens/Documents/GitHub/axivale/src/main/tools/axiforge.ts` (the `axiforge_builds_get`, `axiforge_builds_save`, `axiforge_comps_get` handlers)
- Modify: `/var/home/mstephens/Documents/GitHub/axivale/src/main/tools/axiforge.test.ts` (add display assertions)

### Steps

- [ ] **5.1 Failing test.** Append to `src/main/tools/axiforge.test.ts` (using that file's existing `makeDeps()` mock-client helper, same style as `tools.test.ts`):

```ts
describe('display payloads', () => {
  it('axiforge_builds_get attaches a build-card display', async () => {
    const deps = makeDeps()
    const build = { id: 'b1', title: 'Quickness FB', profession: 'Guardian' }
    deps.forge.getBuild = vi.fn().mockResolvedValue(build)
    const t = buildAxiforgeTools(deps).find((x) => x.name === 'axiforge_builds_get')!
    const result = await t.handler({ id: 'b1' }, {})
    expect(result.display).toEqual({ kind: 'build-card', data: { build } })
    // model text stays compact JSON, no display leakage
    expect(result.content[0].text).toBe(JSON.stringify(build))
  })

  it('axiforge_comps_get attaches a comp-card display with referenced builds embedded', async () => {
    const deps = makeDeps()
    const comp = { id: 'c1', title: 'GvG', partyLines: [{ slots: ['b1'], capacity: 5 }] }
    const build = { id: 'b1', title: 'FB', profession: 'Guardian' }
    deps.forge.getComp = vi.fn().mockResolvedValue(comp)
    deps.forge.getBuild = vi.fn().mockResolvedValue(build)
    const t = buildAxiforgeTools(deps).find((x) => x.name === 'axiforge_comps_get')!
    const result = await t.handler({ id: 'c1' }, {})
    expect(result.display).toEqual({ kind: 'comp-card', data: { comp, builds: { b1: build } } })
  })

  it('list tools carry no display', async () => {
    const deps = makeDeps()
    deps.forge.listBuilds = vi.fn().mockResolvedValue([])
    const t = buildAxiforgeTools(deps).find((x) => x.name === 'axiforge_builds_list')!
    const result = await t.handler({}, {})
    expect(result.display).toBeUndefined()
  })
})
```

- [ ] **5.2 Run, expect failure:** `npx vitest run src/main/tools/axiforge.test.ts`

- [ ] **5.3 Implement — the exact diff pattern.** In `src/main/tools/axiforge.ts`, switch the card-bearing tools from `safe(...)` to `safeRich(...)` (exported from the tools helpers since Task 1). Before:

```ts
    tool(
      'axiforge_builds_get',
      'Fetch one AxiForge build by id, with full trait/skill/equipment detail.',
      { id: z.string().describe('Build id from axiforge_builds_list') },
      safe(async ({ id }) => deps.forge.getBuild(id))
    ),
```

After:

```ts
    tool(
      'axiforge_builds_get',
      'Fetch one AxiForge build by id, with full trait/skill/equipment detail. The user sees a rich build card for this result.',
      { id: z.string().describe('Build id from axiforge_builds_list') },
      safeRich(async ({ id }) => {
        const build = await deps.forge.getBuild(id)
        return { value: build, display: { kind: 'build-card', data: { build } } }
      })
    ),
```

Same pattern for `axiforge_builds_save` (display the saved record returned by `deps.forge.saveBuild`), and for `axiforge_comps_get`:

```ts
      safeRich(async ({ id }) => {
        const comp = await deps.forge.getComp(id)
        const ids = [
          ...new Set(
            ((comp.partyLines ?? []) as Array<{ slots?: string[] }>).flatMap((l) => l.slots ?? [])
          )
        ]
        const builds: Record<string, Record<string, unknown>> = {}
        await Promise.all(
          ids.map(async (buildId) => {
            try {
              builds[buildId] = (await deps.forge.getBuild(buildId)) as Record<string, unknown>
            } catch {
              /* missing builds render as placeholder cards */
            }
          })
        )
        return { value: comp, display: { kind: 'comp-card', data: { comp, builds } } }
      })
```

(`meta_get_build` from the meta-knowledge tools attaches `build-card` the same way when its parsed data is complete — that wiring belongs to the meta-tools task of the sibling plan and just reuses `safeRich`.)

- [ ] **5.4 Run, expect pass:** `npx vitest run src/main/tools/axiforge.test.ts && npx vitest run && npm run typecheck`

- [ ] **5.5 End-to-end smoke:** `npm run dev`, with AxiForge running ask the officer "show me my firebrand build from AxiForge" — confirm the coupon renders a mini build card with icons, role badge, and hover previews; ask for "a table of my builds by profession" against any tool that emits `table` (or temporarily verify with the chart/table unit fixtures) — confirm both providers (Claude and one OpenAI-compatible/local) attach displays.

- [ ] **5.6 Commit** in axivale: `feat: AxiForge get/save tools attach build-card and comp-card displays`

---

## Out of scope / notes for the AxiBridge plan

- **Chart/table producers:** no AxiVale tool emits `chart` yet — the shapes (defined verbatim at the top of this plan and in `src/main/providers/types.ts`) are the contract AxiBridge's stat tools will emit against. `RichChart`/`RichTable` are payload-driven and need no changes for new producers.
- **AxiForge `detail-panel.js` internal refactor:** the desktop app's in-editor hover preview (fact merging, traited facts, game-mode fact selection — 841 lines coupled to editor state) keeps its own implementation; only the positioning/binding pattern and the CSS were extracted. Deduplicating detail-panel onto `createHoverPreview` is follow-up work.
- **Full build/comp page renderers (`render-build.js`/`render-comp.js`):** not extracted — they depend on the whole editor module graph (skills/specializations/equipment/state). The package exports the mini card + comp card, which is what chat embeds need.

# AxiBridge Deep Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `axibridge_query` agent tool that runs a jq expression over a single virtual AxiBridge document, returning clean, size-capped, auto-shaped results — so the agent can deeply query content instead of dumping a one-line blob.

**Architecture:** A jq engine wrapper (WASM `jq-web`, lazily loaded, swappable) evaluates an agent-written jq expression over a document built from the service's existing public methods. The base (`repos`, `runs`, `rollup`) is always materialized cheaply; per-run `summaries` only when the agent scopes via `from`/`to`/`runs[]`. Results are auto-shaped (array-of-objects → table, flat object → field/value table, anything else → a wrapped, length-capped code block) and size-capped before reaching the model. jq stays entirely internal — the user only ever sees the shaped result.

**Tech Stack:** TypeScript, Zod, `@anthropic-ai/claude-agent-sdk` (`tool`), `jq-web` (WASM jq), Vitest, React (renderer display).

---

## File Structure

- **Create** `src/main/jqEngine.ts` — thin, lazily-initialized wrapper around `jq-web`. Exposes `JqEngine` interface + `jqEngine` singleton. Only file that knows the engine; swappable.
- **Create** `src/main/jqEngine.test.ts` — pins the engine contract against real `jq-web`.
- **Create** `src/main/axibridgeQuery.ts` — orchestration: `buildQueryDocument`, `shapeQueryResult`, size caps, `runAxibridgeQuery`. Pure-ish, no engine import (engine injected).
- **Create** `src/main/axibridgeQuery.test.ts` — document building, shaping, caps, end-to-end with fakes.
- **Modify** `src/main/tools/axibridge.ts` — add `axibridge_query` tool; `buildAxibridgeTools` gains an injectable `jq` param (default real engine).
- **Modify** `src/main/tools/axibridge.test.ts` — update expected tool list; add query-tool test with a fake jq.
- **Modify** `src/main/providers/types.ts` — add `code` display kind.
- **Modify** `src/renderer/src/state.ts` — add the same `code` display kind (duplicated by design).
- **Create** `src/renderer/src/components/rich/RichCode.tsx` — renders the code block.
- **Create** `src/renderer/src/components/rich/RichCode.test.tsx` — renders title + text.
- **Modify** `src/renderer/src/components/rich/RichDisplay.tsx` — route `code` → `RichCode`.
- **Modify** `src/renderer/src/theme.css` — wrap table cells; style `.richcode`.

**Constants** (defined in `axibridgeQuery.ts`):
- `DEFAULT_ROW_LIMIT = 50`
- `MAX_RESULT_BYTES = 20_000`
- `MAX_SCOPED_RUNS = 80`
- `MAX_CODE_CHARS = 4_000`

---

## Task 1: jq engine wrapper

**Files:**
- Create: `src/main/jqEngine.ts`
- Test: `src/main/jqEngine.test.ts`

- [ ] **Step 1: Install jq-web**

Run: `npm install jq-web`
Expected: adds `jq-web` to `package.json` dependencies.

- [ ] **Step 2: Write the failing test**

Create `src/main/jqEngine.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { jqEngine } from './jqEngine'

describe('jqEngine', () => {
  it('returns all outputs of an expression as an array', async () => {
    const doc = { rollup: { playerRows: [{ account: 'A', hrs: 3 }, { account: 'B', hrs: 1 }] } }
    const out = await jqEngine.run('.rollup.playerRows[] | .account', doc)
    expect(out).toEqual(['A', 'B'])
  })

  it('returns a single scalar wrapped in a one-element array', async () => {
    const out = await jqEngine.run('.runs | length', { runs: [1, 2, 3] })
    expect(out).toEqual([3])
  })

  it('rejects on an invalid expression', async () => {
    await expect(jqEngine.run('.[', {})).rejects.toBeInstanceOf(Error)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/jqEngine.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — cannot find module `./jqEngine`.

- [ ] **Step 4: Write the implementation**

Create `src/main/jqEngine.ts`:

```ts
// jq-web is a WASM build of jq. We load it lazily (first query only) so importing
// this module — and the tools module that re-exports the default engine — stays
// cheap and never blocks app startup or unrelated tests.
// This is the ONLY file that knows about the engine; swap it here if jq-web changes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let modPromise: Promise<any> | null = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadJq(): Promise<any> {
  if (!modPromise) {
    modPromise = import('jq-web').then((m) => (m as { default?: unknown }).default ?? m)
  }
  return modPromise
}

export interface JqEngine {
  /** Evaluate `expr` over `input`; returns every output of the jq stream as an array. */
  run(expr: string, input: unknown): Promise<unknown[]>
}

export const jqEngine: JqEngine = {
  async run(expr, input) {
    const jq = await loadJq()
    // Wrap in [ ... ] so a multi-output stream comes back as one JSON array,
    // and a single scalar comes back as a one-element array — a uniform contract.
    const wrapped = `[ ${expr} ]`
    const result = await jq.promised.json(input, wrapped)
    return Array.isArray(result) ? result : [result]
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/jqEngine.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS (all 3).

> If `jq.promised.json` is not the exact API in the installed `jq-web` version, check its README and adjust ONLY the two lines in `run()` (e.g. some versions take a JSON string: `jq.promised.json(JSON.stringify(input), wrapped)`, or expose `jq.json(...)` synchronously). The test contract above must stay green.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/main/jqEngine.ts src/main/jqEngine.test.ts
git commit -m "feat(axibridge): jq engine wrapper (lazy jq-web)"
```

---

## Task 2: Build the query document

**Files:**
- Create: `src/main/axibridgeQuery.ts`
- Test: `src/main/axibridgeQuery.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/axibridgeQuery.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { buildQueryDocument, type QueryableService } from './axibridgeQuery'

function fakeService(overrides: Partial<QueryableService> = {}): QueryableService {
  return {
    reposStatus: vi.fn(async () => ({ repos: [{ repo: 'o/a' }] })),
    runsList: vi.fn(async () => ({ runs: [{ id: 'r1' }, { id: 'r2' }], errors: [] })),
    attendance: vi.fn(async () => ({ attendance: [{ account: 'P.1', combatTimeMs: 5 }] })),
    commanderStats: vi.fn(async () => ({ commanders: [{ account: 'C.1', fightsLed: 4 }] })),
    runSummary: vi.fn(async (id: string) => ({ summary: { id, fights: 2 } })),
    ...overrides
  } as unknown as QueryableService
}

describe('buildQueryDocument', () => {
  it('builds the cheap base and leaves summaries empty when unscoped', async () => {
    const svc = fakeService()
    const doc = await buildQueryDocument(svc, { query: '.' })
    expect(doc.repos).toEqual(['o/a'])
    expect(doc.runs.map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(doc.rollup.playerRows[0].account).toBe('P.1')
    expect(doc.rollup.commanderRows[0].account).toBe('C.1')
    expect(doc.summaries).toEqual({})
    expect(svc.runSummary).not.toHaveBeenCalled()
  })

  it('materializes summaries for every run in a date range', async () => {
    const svc = fakeService()
    const doc = await buildQueryDocument(svc, { query: '.', from: '2026-06-01' })
    expect(Object.keys(doc.summaries).sort()).toEqual(['r1', 'r2'])
    expect(doc.summaries.r1).toEqual({ id: 'r1', fights: 2 })
  })

  it('materializes summaries for an explicit runs[] list', async () => {
    const svc = fakeService()
    const doc = await buildQueryDocument(svc, { query: '.', runs: ['r2'] })
    expect(Object.keys(doc.summaries)).toEqual(['r2'])
  })

  it('skips runs that cannot be summarized rather than failing the whole query', async () => {
    const svc = fakeService({
      runSummary: vi.fn(async (id: string) => {
        if (id === 'r1') throw new Error('unparseable')
        return { summary: { id, fights: 2 } }
      })
    })
    const doc = await buildQueryDocument(svc, { query: '.', runs: ['r1', 'r2'] })
    expect(Object.keys(doc.summaries)).toEqual(['r2'])
  })

  it('refuses to load more than MAX_SCOPED_RUNS at once', async () => {
    const many = Array.from({ length: 81 }, (_, i) => ({ id: `r${i}` }))
    const svc = fakeService({ runsList: vi.fn(async () => ({ runs: many, errors: [] })) })
    await expect(buildQueryDocument(svc, { query: '.', from: '2026-01-01' })).rejects.toThrow(/narrow/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/axibridgeQuery.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — cannot find module `./axibridgeQuery`.

- [ ] **Step 3: Write the implementation**

Create `src/main/axibridgeQuery.ts`:

```ts
export const DEFAULT_ROW_LIMIT = 50
export const MAX_RESULT_BYTES = 20_000
export const MAX_SCOPED_RUNS = 80
export const MAX_CODE_CHARS = 4_000

export interface QueryArgs {
  query: string
  from?: string
  to?: string
  runs?: string[]
  limit?: number
}

/** Minimal structural view of AxibridgeService — only what the query needs. */
export interface QueryableService {
  reposStatus(): Promise<{ repos: Array<{ repo: string }> }>
  runsList(filter: { from?: string; to?: string }): Promise<{ runs: Array<{ id: string }>; errors: string[] }>
  attendance(args: { from?: string; to?: string }): Promise<{ attendance: unknown[] }>
  commanderStats(args: { from?: string; to?: string }): Promise<{ commanders: unknown[] }>
  runSummary(runId: string): Promise<{ summary: unknown }>
}

export interface QueryDocument {
  repos: string[]
  runs: Array<{ id: string } & Record<string, unknown>>
  rollup: { playerRows: unknown[]; commanderRows: unknown[] }
  summaries: Record<string, unknown>
}

export async function buildQueryDocument(
  service: QueryableService,
  args: QueryArgs
): Promise<QueryDocument> {
  const [status, runsRes, attendanceRes, commandersRes] = await Promise.all([
    service.reposStatus(),
    service.runsList({ from: args.from, to: args.to }),
    service.attendance({}),
    service.commanderStats({})
  ])

  const doc: QueryDocument = {
    repos: status.repos.map((r) => r.repo),
    runs: runsRes.runs as QueryDocument['runs'],
    rollup: { playerRows: attendanceRes.attendance, commanderRows: commandersRes.commanders },
    summaries: {}
  }

  // Per-run detail is materialized ONLY when scoped: explicit runs[] win,
  // otherwise the runs that fell in the from/to window. Unscoped → none.
  const scopedIds = args.runs ?? (args.from || args.to ? runsRes.runs.map((r) => r.id) : [])
  if (scopedIds.length > MAX_SCOPED_RUNS) {
    throw new Error(
      `Query scopes ${scopedIds.length} runs (max ${MAX_SCOPED_RUNS}). Narrow the date range or pass a shorter runs[] list.`
    )
  }
  for (const id of scopedIds) {
    try {
      doc.summaries[id] = (await service.runSummary(id)).summary
    } catch {
      // A run that can't be summarized is skipped, never fails the whole query.
    }
  }
  return doc
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/axibridgeQuery.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/main/axibridgeQuery.ts src/main/axibridgeQuery.test.ts
git commit -m "feat(axibridge): build scoped query document from public service methods"
```

---

## Task 3: Shape results + size caps

**Files:**
- Modify: `src/main/axibridgeQuery.ts`
- Test: `src/main/axibridgeQuery.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/main/axibridgeQuery.test.ts`:

```ts
import { shapeQueryResult } from './axibridgeQuery'

describe('shapeQueryResult', () => {
  it('renders an array of uniform objects as a table and caps rows', () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ account: `P.${i}`, hrs: i }))
    const shaped = shapeQueryResult([rows], { title: 'Attendance', limit: 50 })
    expect(shaped.display?.kind).toBe('table')
    const data = (shaped.display as { data: { columns: { key: string }[]; rows: unknown[] } }).data
    expect(data.columns.map((c) => c.key)).toEqual(['account', 'hrs'])
    expect(data.rows).toHaveLength(50)
    expect((shaped.value as { total: number; truncated: boolean }).total).toBe(60)
    expect((shaped.value as { truncated: boolean }).truncated).toBe(true)
  })

  it('coerces non-primitive cell values to JSON strings for the table', () => {
    const shaped = shapeQueryResult([[{ account: 'A', tags: ['x', 'y'] }]], { title: 't', limit: 50 })
    const data = (shaped.display as { data: { rows: Array<Record<string, unknown>> } }).data
    expect(data.rows[0].tags).toBe('["x","y"]')
  })

  it('renders a flat object as a field/value table', () => {
    const shaped = shapeQueryResult([{ totalRuns: 12, totalHours: 40 }], { title: 'Totals', limit: 50 })
    expect(shaped.display?.kind).toBe('table')
    const data = (shaped.display as { data: { columns: { key: string }[]; rows: unknown[] } }).data
    expect(data.columns.map((c) => c.key)).toEqual(['field', 'value'])
    expect(data.rows).toHaveLength(2)
  })

  it('renders a scalar as a code block', () => {
    const shaped = shapeQueryResult([42], { title: 'Count', limit: 50 })
    expect(shaped.display?.kind).toBe('code')
    expect((shaped.display as { data: { text: string } }).data.text).toBe('42')
    expect(shaped.value).toBe(42)
  })

  it('renders a nested/irregular value as a code block', () => {
    const shaped = shapeQueryResult([{ a: { b: [1, 2] } }], { title: 'x', limit: 50 })
    expect(shaped.display?.kind).toBe('code')
  })

  it('truncates an over-long code block', () => {
    const big = { s: 'x'.repeat(10_000) }
    const shaped = shapeQueryResult([big], { title: 'x', limit: 50 })
    const text = (shaped.display as { data: { text: string } }).data.text
    expect(text.length).toBeLessThanOrEqual(4_100)
    expect(text).toContain('truncated')
  })

  it('byte-caps a huge table by dropping rows below the row limit', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ account: `P.${i}`, blob: 'y'.repeat(2_000) }))
    const shaped = shapeQueryResult([rows], { title: 'x', limit: 50 })
    const value = shaped.value as { rows: unknown[]; truncated: boolean }
    expect(JSON.stringify(value).length).toBeLessThanOrEqual(20_000)
    expect(value.truncated).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/axibridgeQuery.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — `shapeQueryResult` is not exported.

- [ ] **Step 3: Implement the shaper**

Append to `src/main/axibridgeQuery.ts`:

```ts
import type { DisplayPayload } from './providers/types'

export interface ShapedResult {
  value: unknown
  display?: DisplayPayload
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isPrimitive(v: unknown): v is string | number | boolean | null {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v)
}

/** Stable union of keys across rows, in first-seen order. */
function unionKeys(rows: Array<Record<string, unknown>>): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k)
        keys.push(k)
      }
    }
  }
  return keys
}

/** Cell values must be string|number for the table renderer; coerce the rest. */
function toCell(v: unknown): string | number {
  if (typeof v === 'number') return v
  if (v === null || v === undefined) return ''
  if (typeof v === 'string' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

function prettyCapped(value: unknown): string {
  const text = JSON.stringify(value, null, 2) ?? String(value)
  return text.length > MAX_CODE_CHARS
    ? `${text.slice(0, MAX_CODE_CHARS)}\n… (truncated — refine the query to narrow the result)`
    : text
}

function codeDisplay(title: string, value: unknown): DisplayPayload {
  return { kind: 'code', data: { title, text: prettyCapped(value) } }
}

/** Drop trailing rows until the serialized value fits MAX_RESULT_BYTES. */
function enforceByteCap(
  value: { rows: unknown[]; total: number; truncated: boolean }
): { rows: unknown[]; total: number; truncated: boolean } {
  while (value.rows.length > 1 && JSON.stringify(value).length > MAX_RESULT_BYTES) {
    value.rows = value.rows.slice(0, -1)
    value.truncated = true
  }
  return value
}

export function shapeQueryResult(
  outputs: unknown[],
  opts: { title: string; limit: number }
): ShapedResult {
  const result = outputs.length === 1 ? outputs[0] : outputs

  if (Array.isArray(result)) {
    const total = result.length
    const capped = result.slice(0, opts.limit)
    const truncated = capped.length < total

    if (capped.length > 0 && capped.every(isPlainObject)) {
      const columns = unionKeys(capped as Array<Record<string, unknown>>)
      const tableRows = (capped as Array<Record<string, unknown>>).map((row) => {
        const out: Record<string, string | number> = {}
        for (const k of columns) out[k] = toCell(row[k])
        return out
      })
      const value = enforceByteCap({ rows: capped, total, truncated })
      const title = value.truncated ? `${opts.title} · showing ${value.rows.length} of ${total}` : opts.title
      return {
        value: value.truncated ? value : { rows: value.rows, total },
        display: {
          kind: 'table',
          data: { title, columns: columns.map((k) => ({ key: k, label: k })), rows: tableRows.slice(0, value.rows.length) }
        }
      }
    }

    // Array of scalars / mixed → code block.
    return { value: { rows: capped, total, ...(truncated ? { truncated } : {}) }, display: codeDisplay(opts.title, capped) }
  }

  if (isPlainObject(result) && Object.values(result).every(isPrimitive)) {
    return {
      value: result,
      display: {
        kind: 'table',
        data: {
          title: opts.title,
          columns: [
            { key: 'field', label: 'Field' },
            { key: 'value', label: 'Value' }
          ],
          rows: Object.entries(result).map(([field, value]) => ({ field, value: toCell(value) }))
        }
      }
    }
  }

  // Scalar or nested/irregular → code block.
  return { value: result, display: codeDisplay(opts.title, result) }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/axibridgeQuery.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS (Task 2 + Task 3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/axibridgeQuery.ts src/main/axibridgeQuery.test.ts
git commit -m "feat(axibridge): auto-shape + size-cap query results"
```

---

## Task 4: Wire document + engine into runAxibridgeQuery

**Files:**
- Modify: `src/main/axibridgeQuery.ts`
- Test: `src/main/axibridgeQuery.test.ts`

- [ ] **Step 1: Add failing test**

Append to `src/main/axibridgeQuery.test.ts`:

```ts
import { runAxibridgeQuery } from './axibridgeQuery'
import type { JqEngine } from './jqEngine'

describe('runAxibridgeQuery', () => {
  it('feeds the document through jq and shapes the output', async () => {
    const svc = fakeService()
    const jq: JqEngine = {
      run: vi.fn(async (expr: string, input: unknown) => {
        expect(expr).toBe('.rollup.playerRows')
        return [(input as { rollup: { playerRows: unknown[] } }).rollup.playerRows]
      })
    }
    const shaped = await runAxibridgeQuery({ service: svc, jq }, { query: '.rollup.playerRows' })
    expect(jq.run).toHaveBeenCalledOnce()
    expect(shaped.display?.kind).toBe('table')
  })

  it('defaults the row limit to DEFAULT_ROW_LIMIT', async () => {
    const svc = fakeService({
      attendance: vi.fn(async () => ({ attendance: Array.from({ length: 60 }, (_, i) => ({ account: `P.${i}` })) }))
    })
    const jq: JqEngine = { run: vi.fn(async (_e, input) => [(input as { rollup: { playerRows: unknown[] } }).rollup.playerRows]) }
    const shaped = await runAxibridgeQuery({ service: svc, jq }, { query: '.rollup.playerRows' })
    expect((shaped.value as { total: number }).total).toBe(60)
    expect((shaped.display as { data: { rows: unknown[] } }).data.rows).toHaveLength(50)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/axibridgeQuery.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — `runAxibridgeQuery` is not exported.

- [ ] **Step 3: Implement**

Append to `src/main/axibridgeQuery.ts`:

```ts
import type { JqEngine } from './jqEngine'

export async function runAxibridgeQuery(
  deps: { service: QueryableService; jq: JqEngine },
  args: QueryArgs
): Promise<ShapedResult> {
  const doc = await buildQueryDocument(deps.service, args)
  const outputs = await deps.jq.run(args.query, doc)
  return shapeQueryResult(outputs, { title: 'Query result', limit: args.limit ?? DEFAULT_ROW_LIMIT })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/axibridgeQuery.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS (all axibridgeQuery tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/axibridgeQuery.ts src/main/axibridgeQuery.test.ts
git commit -m "feat(axibridge): runAxibridgeQuery orchestrator (document + jq + shape)"
```

---

## Task 5: Add the `code` display kind (main + renderer types, renderer component)

**Files:**
- Modify: `src/main/providers/types.ts:41` (after the `table` member)
- Modify: `src/renderer/src/state.ts:42` (after the `table` member)
- Create: `src/renderer/src/components/rich/RichCode.tsx`
- Create: `src/renderer/src/components/rich/RichCode.test.tsx`
- Modify: `src/renderer/src/components/rich/RichDisplay.tsx`

- [ ] **Step 1: Add the `code` kind to the main-process union**

In `src/main/providers/types.ts`, the table member currently ends at line 41:

```ts
  | {
      kind: 'table'
      data: {
        title?: string
        columns: Array<{ key: string; label: string }>
        rows: Array<Record<string, string | number>>
      }
    }
```

Add immediately after it (before the blank line preceding `export type AgentEvent`):

```ts
  | { kind: 'code'; data: { title?: string; text: string } }
```

- [ ] **Step 2: Add the identical `code` kind to the renderer union**

In `src/renderer/src/state.ts`, after the `table` member (ends at line 42), add the same line:

```ts
  | { kind: 'code'; data: { title?: string; text: string } }
```

- [ ] **Step 3: Write the failing renderer test**

Create `src/renderer/src/components/rich/RichCode.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import RichCode from './RichCode'

describe('RichCode', () => {
  it('renders the title and preformatted text', () => {
    const { getByText, container } = render(<RichCode spec={{ title: 'Totals', text: '{\n  "a": 1\n}' }} />)
    expect(getByText('Totals')).toBeTruthy()
    const pre = container.querySelector('pre')
    expect(pre?.textContent).toContain('"a": 1')
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/rich/RichCode.test.tsx --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — cannot find module `./RichCode`.

- [ ] **Step 5: Implement RichCode**

Create `src/renderer/src/components/rich/RichCode.tsx`:

```tsx
import type { ReactElement } from 'react'
import type { DisplayPayload } from '../../state'

type CodeSpec = Extract<DisplayPayload, { kind: 'code' }>['data']

/** Preformatted, wrapping block for query results that don't fit a table. */
export default function RichCode({ spec }: { spec: CodeSpec }): ReactElement {
  return (
    <div className="rich richcode">
      {spec.title && <div className="rich-title">{spec.title}</div>}
      <pre>{spec.text}</pre>
    </div>
  )
}
```

- [ ] **Step 6: Route `code` in RichDisplay**

In `src/renderer/src/components/rich/RichDisplay.tsx`, add the import and case:

```tsx
import RichCode from './RichCode'
```

and inside the `switch`, before `default`:

```tsx
    case 'code':
      return <RichCode spec={display.data} />
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/rich/RichCode.test.tsx --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main/providers/types.ts src/renderer/src/state.ts src/renderer/src/components/rich/RichCode.tsx src/renderer/src/components/rich/RichCode.test.tsx src/renderer/src/components/rich/RichDisplay.tsx
git commit -m "feat(rich): code display kind + RichCode renderer"
```

---

## Task 6: CSS — wrap table cells and style the code block

**Files:**
- Modify: `src/renderer/src/theme.css:148` (the `td` rule) and `:163` area (rich styles)

- [ ] **Step 1: Make table cells wrap**

In `src/renderer/src/theme.css`, the `td` rule on line 148 is:

```css
td{padding:6px 18px 6px 0;font-size:13px;border-bottom:1px dotted var(--line);color:var(--ink-dim);vertical-align:top}
```

Replace it with (adds wrapping + a sane max width so long account names/blobs wrap instead of stretching):

```css
td{padding:6px 18px 6px 0;font-size:13px;border-bottom:1px dotted var(--line);color:var(--ink-dim);vertical-align:top;overflow-wrap:anywhere;word-break:break-word;max-width:340px}
```

- [ ] **Step 2: Style the code block**

In `src/renderer/src/theme.css`, immediately after the `.richtable th .arr` rule (line 163), add:

```css
.richcode pre{font-family:'IBM Plex Mono',monospace;font-size:12px;line-height:1.5;color:var(--ink-dim);background:var(--bg);border:1px solid var(--rule);padding:10px 12px;margin:0;max-height:320px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
```

- [ ] **Step 3: Verify the build typechecks/compiles**

Run: `npm run build`
Expected: completes without TypeScript or CSS errors.

> No unit test for raw CSS; the wrapping fix is verified visually in the smoke test (Task 8). The `code` renderer itself is covered by Task 5.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/theme.css
git commit -m "fix(rich): wrap table cells; style richcode block (kills one-line blob)"
```

---

## Task 7: Add the `axibridge_query` tool

**Files:**
- Modify: `src/main/tools/axibridge.ts`
- Test: `src/main/tools/axibridge.test.ts`

- [ ] **Step 1: Update the existing tool-list test (will fail) and add a query-tool test**

In `src/main/tools/axibridge.test.ts`, update the expected list in the `registers exactly the spec table` test to include `axibridge_query` (alphabetical order — between `axibridge_player_stats` and `axibridge_render_chart`):

```ts
    expect(tools.map((t) => t.name).sort()).toEqual([
      'axibridge_attendance',
      'axibridge_commander_stats',
      'axibridge_compare',
      'axibridge_player_stats',
      'axibridge_query',
      'axibridge_render_chart',
      'axibridge_repos_status',
      'axibridge_run_summary',
      'axibridge_runs_list'
    ])
```

Then add a new test (the `fakeService` already defines the methods the query needs). Add a fake jq and pass it as the new second arg to `buildAxibridgeTools`:

```ts
import type { JqEngine } from '../jqEngine'

const fakeJq: JqEngine = {
  run: async (_expr, input) => [(input as { rollup: { playerRows: unknown[] } }).rollup.playerRows]
}
const queryTools = buildAxibridgeTools(() => fakeService as never, fakeJq)
const queryTool = queryTools.find((t) => t.name === 'axibridge_query')!

describe('axibridge_query tool', () => {
  it('runs a jq query and returns a table display for array-of-objects', async () => {
    const res = (await queryTool.handler({ query: '.rollup.playerRows' }, {})) as never as {
      content: Array<{ text: string }>
      display?: { kind: string }
    }
    expect(res.display?.kind).toBe('table')
    expect(JSON.parse(res.content[0].text)).toBeTruthy()
  })

  it('surfaces a bad query as an MCP error result, not an exception', async () => {
    const boom: JqEngine = { run: async () => { throw new Error('jq: syntax error') } }
    const t = buildAxibridgeTools(() => fakeService as never, boom).find((x) => x.name === 'axibridge_query')!
    const res = (await t.handler({ query: '.[' }, {})) as never as { isError?: boolean; content: Array<{ text: string }> }
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('syntax error')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/tools/axibridge.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: FAIL — list mismatch (no `axibridge_query`) and `buildAxibridgeTools` arity / missing tool.

- [ ] **Step 3: Implement the tool**

In `src/main/tools/axibridge.ts`, add imports at the top (after existing imports):

```ts
import { runAxibridgeQuery } from '../axibridgeQuery'
import { jqEngine, type JqEngine } from '../jqEngine'
```

Change the signature to accept an injectable engine (default = real):

```ts
export function buildAxibridgeTools(
  service: () => AxibridgeService,
  jq: JqEngine = jqEngine
): Array<SdkMcpToolDefinition<any>> {
```

Add this tool to the returned array (place it after the `axibridge_attendance` tool, before `axibridge_commander_stats`):

```ts
    tool(
      'axibridge_query',
      [
        'Deep query of ALL AxiBridge content with a jq expression — the escape hatch when the other axibridge_* tools cannot shape an answer.',
        'The query runs over one document:',
        '{ repos: ["owner/repo"], runs: [run index entries], rollup: { playerRows, commanderRows }, summaries: { <runId>: run summary } }.',
        'playerRows/commanderRows carry raw fields (combatTimeMs, squadTimeMs, fightsLed, …) — project and aggregate them in the query.',
        'summaries is EMPTY unless you scope per-run detail: pass from/to (loads the runs in that window) or runs[] (explicit ids).',
        'Results are capped to `limit` rows (default 50); raise limit or narrow the query to see more. The full jq stream is returned.',
        'Example: ".rollup.playerRows | sort_by(-.combatTimeMs) | .[] | {account, runs, combatTimeMs}"'
      ].join(' '),
      {
        query: z.string().describe('jq expression evaluated over the AxiBridge document (see tool description for its shape).'),
        from: z.string().optional().describe('Earliest date YYYY-MM-DD; also loads per-run summaries in range into .summaries'),
        to: z.string().optional().describe('Latest date YYYY-MM-DD; also loads per-run summaries in range into .summaries'),
        runs: z.array(z.string()).optional().describe('Explicit run ids to load into .summaries'),
        limit: z.number().int().positive().optional().describe('Max rows in the result (default 50)')
      },
      safeRich(async ({ query, from, to, runs, limit }) => {
        const { value, display } = await runAxibridgeQuery(
          { service: service(), jq },
          { query, from, to, runs, limit }
        )
        return { value, display }
      })
    ),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/tools/axibridge.test.ts --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS (existing tests + new query tests).

- [ ] **Step 5: Confirm registration needs no change**

`src/main/tools/index.ts:55` calls `buildAxibridgeTools(deps.axibridge)` — the new `jq` param defaults to the real engine, so no edit is needed. Verify by reading the line; do not change it.

- [ ] **Step 6: Commit**

```bash
git add src/main/tools/axibridge.ts src/main/tools/axibridge.test.ts
git commit -m "feat(axibridge): axibridge_query tool (abstracted jq deep query)"
```

---

## Task 8: Full suite + in-app smoke test

**Files:** none (verification)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2`
Expected: PASS — all suites green, including the four new/modified ones.

- [ ] **Step 2: Typecheck/build**

Run: `npm run build`
Expected: no TypeScript errors (both `DisplayPayload` copies now include `code`).

- [ ] **Step 3: Manual smoke test in the app**

Run: `npm run dev`
Then in a conversation, ask something the fixed-shape tools can't shape, e.g.:
> "Using axibridge_query, list the top 5 accounts by combat hours from the rollup."

Verify:
- The agent calls `axibridge_query` (not a raw blob).
- The result renders as a clean, sortable table — long account names wrap, nothing on one runaway line.
- Ask a scalar question ("how many runs are in the index?") and confirm it renders as a small code/value block, not a blob.

- [ ] **Step 4: Final commit (if any docs/notes changed)**

```bash
git add -A
git commit -m "test(axibridge): full-suite + smoke verification for deep query" --allow-empty
```

---

## Self-Review Notes

- **Spec coverage:** `axibridge_query` tool (Task 7) ✓; jq under the hood, hidden from user (Tasks 1, 7) ✓; single virtual document (Task 2) ✓; scoped materialization with `MAX_SCOPED_RUNS` guard (Task 2) ✓; pure-JS/WASM engine, no system binary (Task 1) ✓; size discipline — agent-controllable `limit` default + byte ceiling + code-length cap, with `showing N of M` (Tasks 3) ✓; jq processes full data, caps only the output (Tasks 3–4) ✓; auto-shaping table/field-value/code (Task 3) ✓; never one-line blob + `td` wrap CSS (Tasks 5, 6) ✓; read-only (uses read-only service methods only) ✓; error handling surfaces structured errors via `safeRich` (Task 7) ✓; tests for resolver/shaper/caps/representative query (Tasks 2–4, 7) ✓.
- **Type consistency:** `JqEngine.run` returns `Promise<unknown[]>` everywhere; `ShapedResult { value, display }` matches `safeRich`'s expected `{ value, display? }`; `code` display kind added to BOTH `DisplayPayload` copies with identical shape `{ kind:'code'; data:{ title?; text } }`.
- **Engine risk:** the one place reality may diverge is `jq-web`'s exact API (Task 1, Step 5 note). Logic and the test contract are concrete; only the wrapper's two-line call may need adjustment to the installed version.

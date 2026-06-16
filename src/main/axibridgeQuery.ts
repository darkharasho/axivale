import type { DisplayPayload } from './providers/types'
import type { JqEngine } from './jqEngine'

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

  if (
    isPlainObject(result) &&
    Object.values(result).every(isPrimitive) &&
    (JSON.stringify(result, null, 2) ?? '').length <= MAX_CODE_CHARS
  ) {
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

export async function runAxibridgeQuery(
  deps: { service: QueryableService; jq: JqEngine },
  args: QueryArgs
): Promise<ShapedResult> {
  const doc = await buildQueryDocument(deps.service, args)
  const outputs = await deps.jq.run(args.query, doc)
  return shapeQueryResult(outputs, { title: 'Query result', limit: args.limit ?? DEFAULT_ROW_LIMIT })
}

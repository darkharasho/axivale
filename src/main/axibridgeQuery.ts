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

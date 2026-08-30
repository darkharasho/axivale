// Owns every parsed axilog report. A 5:48 zerg fight is ~90 MiB and napi's
// parseFile is synchronous, so parsing on the main thread would freeze IPC and
// the agent stream for hundreds of ms. Reports live here, in a small LRU, and
// ONLY shaped rows are posted back — a report never crosses the boundary.

import { parentPort } from 'node:worker_threads'
import { loadAxilog } from './axilogNative'
import { buildEntityIndex, type AxilogReport } from './axilogEntities'
import { runSection, type SectionQuery, type SectionResult } from './axilogSections'
import { jqEngine } from './jqEngine'

/**
 * The optional parse passes, mirroring @axiapps/axilog's `ParseOptions` minus
 * `everything` (callers ask for what they need, never for the whole document).
 *
 * NOTE vs. the task brief: the brief listed a `minions` flag. The SDK has no
 * such option — `blocks.minions` is gated on `skillDamage`, so anything that
 * wants minion data sets `skillDamage: true`. `replay` and `missiles` are real
 * options the brief omitted and are included here.
 */
export interface PassFlags {
  replay?: boolean
  skillDamage?: boolean
  timeseries?: boolean
  missiles?: boolean
  rotation?: boolean
  modifiers?: boolean
}

export type WorkerRequest =
  | { id: number; kind: 'overview'; logId: string; path: string }
  | {
      id: number
      kind: 'section'
      logId: string
      path: string
      section: string
      opts: SectionQuery
      passes: PassFlags
    }
  | { id: number; kind: 'query'; logId: string; path: string; filter: string; limit: number }

export type WorkerResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string }

export const REPORT_LRU_SIZE = 2
export const MAX_QUERY_BYTES = 64_000

interface Loaded {
  report: AxilogReport
  passes: PassFlags
}

/** Insertion-ordered Map used as the LRU: re-inserting moves an entry to the end. */
const lru = new Map<string, Loaded>()

/** True when `have` already covers every pass `want` asks for. */
function covers(have: PassFlags, want: PassFlags): boolean {
  return (Object.keys(want) as Array<keyof PassFlags>).every((k) => !want[k] || have[k])
}

function load(logId: string, path: string, passes: PassFlags): AxilogReport {
  const hit = lru.get(logId)
  if (hit && covers(hit.passes, passes)) {
    lru.delete(logId)
    lru.set(logId, hit)
    return hit.report
  }
  const native = loadAxilog()
  if (!native) throw new Error('axilog native module unavailable in worker')
  // Union with what is already loaded: a re-parse never LOSES a pass, so a
  // section that needed rotations does not force the next one to re-parse.
  const merged: PassFlags = { ...(hit?.passes ?? {}), ...passes }
  const report = native.parseFile(path, merged) as AxilogReport
  lru.delete(logId)
  lru.set(logId, { report, passes: merged })
  while (lru.size > REPORT_LRU_SIZE) lru.delete(lru.keys().next().value as string)
  return report
}

export async function handle(req: WorkerRequest): Promise<unknown> {
  if (req.kind === 'overview') {
    const report = load(req.logId, req.path, {})
    const index = buildEntityIndex(report)
    return {
      logId: req.logId,
      map: report.encounter?.map ?? 'Unknown',
      durationMs: report.encounter?.duration_ms ?? 0,
      recordedBy: report.encounter?.recorded_by ?? '',
      roleCounts: index.roleCounts(),
      squad: index.byRole('squad').map((e) => ({
        name: e.name,
        account: e.account,
        profession: e.profession,
        subgroup: e.subgroup
      })),
      coverage: report.coverage ?? {},
      warnings: report.warnings ?? []
    }
  }
  if (req.kind === 'section') {
    const report = load(req.logId, req.path, req.passes)
    return runSection(report, req.section, req.opts) satisfies SectionResult
  }
  const report = load(req.logId, req.path, {})
  const rows = await jqEngine.run(req.filter, report)
  // Cap by SERIALIZED size, not row count: one row of replay tracks can be
  // megabytes while a thousand scalar rows are trivial.
  const out: unknown[] = []
  let bytes = 0
  let truncated = false
  for (const row of rows.slice(0, req.limit)) {
    const size = JSON.stringify(row)?.length ?? 0
    if (bytes + size > MAX_QUERY_BYTES) {
      truncated = true
      break
    }
    out.push(row)
    bytes += size
  }
  if (rows.length > req.limit) truncated = true
  return { rows: out, truncated }
}

parentPort?.on('message', (req: WorkerRequest) => {
  void handle(req)
    .then((value) => parentPort!.postMessage({ id: req.id, ok: true, value } as WorkerResponse))
    .catch((err) =>
      parentPort!.postMessage({
        id: req.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      } as WorkerResponse)
    )
})

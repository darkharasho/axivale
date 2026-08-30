// Owns every parsed axilog report. A 5:48 zerg fight is ~90 MiB and napi's
// parseFile is synchronous, so parsing on the main thread would freeze IPC and
// the agent stream for hundreds of ms. Reports live here, in a small LRU, and
// ONLY shaped rows are posted back — a report never crosses the boundary.

import { parentPort } from 'node:worker_threads'
import { loadAxilog } from './axilogNative'
import {
  buildEntityIndex,
  type AxilogReport,
  type EntityIndex,
  type EntityRole
} from './axilogEntities'
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

/**
 * `axilog.generated_from` is the absolute path parseFile was handed, and
 * jqEngine.run() runs a model-supplied filter against the WHOLE report — so a
 * probe as ordinary as `keys` or `.axilog` would hand the user's home-directory
 * layout and OS account name back to the inference provider. Reduced to a
 * basename at load, before any filter can reach it, and mutated in place so the
 * LRU-cached report carries the redacted value too. Nothing else in the tree
 * reads this field (grepped), so basename is a lossless-enough identifier.
 */
export function redactReportPaths(report: AxilogReport): AxilogReport {
  const from = report?.axilog?.generated_from
  if (typeof from === 'string') {
    // Handle both separators explicitly: node:path's basename() is
    // platform-specific, and a Windows-produced path can be parsed on Linux.
    report.axilog.generated_from = from.split(/[/\\]/).pop() ?? from
  }
  return report
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
  const report = redactReportPaths(native.parseFile(path, merged) as AxilogReport)
  lru.delete(logId)
  lru.set(logId, { report, passes: merged })
  while (lru.size > REPORT_LRU_SIZE) lru.delete(lru.keys().next().value as string)
  return report
}

/**
 * jq output is arbitrarily shaped, so the query path cannot reshape rows the way
 * `runSection` does. What it CAN do — shape-agnostically, without touching the
 * rows themselves — is tell the model which numeric-string keys are entity ids
 * and what those ids are called. Without this, `.blocks.support.by_entity`
 * returns `{"12":{"strips":88}}`: real numbers with no names, and a standing
 * invitation for the model to guess a name off the roster and misattribute it.
 */
export const QUERY_ENTITY_NOTE =
  'Numeric-string keys in this result are entity ids (blocks.<name>.by_entity is keyed by entities[].id AS STRINGS). ' +
  '`entities` below maps every such id found here to its roster name — use those names verbatim. ' +
  "Ids in `unresolvedIds` are not in this fight's roster: report them as unresolved. " +
  'NEVER name a player from a by_entity key you resolved yourself, and never guess a nearest match. ' +
  'Ids under `catalogs.*` are skill/buff ids, not entities — this map does not apply to those.'

export interface QueryEntityAnnotation {
  /** id (string, exactly as it appears as a key) -> roster identity. */
  entities: Record<string, { name: string; role: EntityRole }>
  /** Numeric keys with no roster match — named as unresolved, never guessed. */
  unresolvedIds: string[]
  note: string
}

const NUMERIC_KEY = /^\d+$/

function collectNumericKeys(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    // Array indices are not object keys — only walk the elements.
    for (const v of value) collectNumericKeys(v, out)
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (NUMERIC_KEY.test(k)) out.add(k)
    collectNumericKeys(v, out)
  }
}

/** null when the result carries no entity-id-shaped keys — no note, no payload cost. */
export function annotateQueryEntities(
  rows: unknown[],
  index: EntityIndex
): QueryEntityAnnotation | null {
  const ids = new Set<string>()
  collectNumericKeys(rows, ids)
  if (ids.size === 0) return null
  const entities: QueryEntityAnnotation['entities'] = {}
  const unresolvedIds: string[] = []
  for (const id of [...ids].sort((a, b) => Number(a) - Number(b))) {
    const ref = index.get(id)
    if (ref) entities[id] = { name: ref.name, role: ref.role }
    else unresolvedIds.push(id)
  }
  return { entities, unresolvedIds, note: QUERY_ENTITY_NOTE }
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
  const sizes: number[] = []
  let bytes = 0
  let truncated = false
  for (const row of rows.slice(0, req.limit)) {
    const size = JSON.stringify(row)?.length ?? 0
    if (bytes + size > MAX_QUERY_BYTES) {
      truncated = true
      break
    }
    out.push(row)
    sizes.push(size)
    bytes += size
  }
  if (rows.length > req.limit) truncated = true

  // The id->name map is part of the payload, so it is counted against the cap
  // rather than appended after it: drop trailing rows until rows AND map fit.
  const index = buildEntityIndex(report)
  const annBytes = (a: QueryEntityAnnotation | null): number => (a ? JSON.stringify(a).length : 0)
  let annotation = annotateQueryEntities(out, index)
  while (out.length > 0 && bytes + annBytes(annotation) > MAX_QUERY_BYTES) {
    out.pop()
    bytes -= sizes.pop() ?? 0
    truncated = true
    annotation = annotateQueryEntities(out, index)
  }
  return annotation ? { rows: out, truncated, ...annotation } : { rows: out, truncated }
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

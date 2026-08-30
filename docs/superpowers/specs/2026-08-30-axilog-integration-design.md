# AxiLog Integration — Design

Date: 2026-08-30

## Summary

AxiVale analyzes *published* WvW aggregates through AxiBridge. It cannot open a
single raw arcdps log. This design adds that: point AxiVale at a `.zevtc` — or
let it watch the arcdps log folder — and chat about that one fight against real
parsed data.

The parsing core is [axilog](https://github.com/darkharasho/axilog), consumed as
`@axiapps/axilog`, its napi Node SDK. Every export is an in-process native call
over the same Rust pipeline the axilog CLI drives — no subprocess, no binary to
ship separately, ~70–400 ms per log.

AxiBridge is the telescope: nights, trends, many runs. AxiLog is the microscope:
one fight, every detail. They do not overlap and neither replaces the other.

## Goals

- Open a raw `.zevtc`/`.evtc` and answer specific questions about that fight —
  "how were our strips last fight", "who held stability through the push".
- Discover recent fights automatically by watching the arcdps log directory.
- Answer from the log or say the log cannot answer. Never infer, never
  approximate, never present an absent block as a zero.
- Bounded memory: a parsed zerg fight is ~90 MiB and must never accumulate in
  the main process.

## Non-goals

- Night-level or multi-session trends — that is AxiBridge's job.
- A report viewer. axilog's own single-file HTML report already does this better
  than a panel would.
- PvE encounter analysis. axilog is WvW-first; PvE phase logic is unimplemented
  upstream.
- Uploading logs anywhere. Everything is local.

## Decisions

Settled during brainstorming, recorded so the plan does not relitigate them:

| Question | Decision |
| --- | --- |
| Entry point | Both: a folder watcher for discovery, and explicit file open/drop. |
| Log addressing | Tool-driven by `logId`; conversations persist the refs they touched. |
| Reading a huge report | Curated section registry + a capped jq escape hatch. |
| Caching | None. Re-parse on demand; no persisted summaries. |
| UI surface | Chat plus a thin Logs panel listing watched fights. |
| Where parsing runs | A `node:worker_threads` worker that owns the reports. |

Two decisions carry reasoning worth keeping:

**No cache.** Nothing parsed is ever written to disk. The worker's 1–2 entry LRU
is not a cache in this sense: it exists so consecutive questions about the same
fight do not re-parse within a single exchange, and it dies with the worker. A
parse is 70–400 ms; cache invalidation across a file that can be
rewritten, moved, or deleted is not. Re-parsing is cheaper than being wrong.
Persisted *summaries* were considered and rejected — the point of this feature is
specifics, and the fight list gets its labels from filenames, not from content.

**Worker, not main process.** napi `parseFile` is synchronous: parsing on the
main thread freezes IPC and the agent stream for 400 ms, up to 1.6 s with every
analysis pass on. A worker also bounds the memory — killing it returns
everything. Electron `utilityProcess` would add true process isolation; the
worker protocol is identical either way, so that stays a later transport swap
rather than a redesign.

## Architecture

```
renderer                    main                              worker (node:worker_threads)
────────                    ────                              ───────────────────────────
Logs panel  ──ipc──▶  axilogWatcher.ts   (fs scan/watch)
composer drop         axilogService.ts   ──postMessage──▶     axilogWorker.ts
                        │                                       └ LRU<logId, ReportV1>  (1–2)
tools/axilog.ts ────────┘                ◀──rows/kb────         axilogSections.ts  (runs here)
                                                                 jq via jqEngine    (runs here)
```

**The report never crosses a process boundary.** Section shaping and jq run
where the parsed document lives; only shaped rows — kilobytes — come back.
Nothing ever serializes 90 MiB.

### Modules

New in `src/main/`:

| File | Owns |
| --- | --- |
| `axilogWatcher.ts` | Resolving the arcdps log dir, scanning/watching it, parsing `20260830-211432.zevtc` filenames into `{logId, path, startedAt, mapFolder, bytes}`. Never parses log contents. |
| `axilogService.ts` | Main-side façade: log registry, worker lifecycle (spawn on demand, idle-kill), request/response correlation, size/timeout guards. The only thing tools talk to. |
| `axilogWorker.ts` | Message loop over an LRU of parsed reports: `parse` / `describe` / `section` / `query`. Where the native module is required. |
| `axilogSections.ts` | Section registry over axilog's `blocks`, same descriptor shape as `axibridgeSections.ts` (`key`, `aliases`, `summary`, `granularities`, `fields`, `shape()`). Pure. |
| `axilogEntities.ts` | The one id→entity resolver: `entities[]` → `{name, account, profession, role, subgroup}`. |
| `tools/axilog.ts` | `buildAxilogTools(deps)`, registered in `tools/index.ts`. |

New in `src/renderer/src/components/panels/`: `Logs.tsx`, `LogsNav.tsx`,
`useLogs.ts`, following the existing `Skills.tsx` / `SkillsNav.tsx` /
`useSkills.ts` trio.

`axilogSections.ts` and `axilogEntities.ts` are pure functions over a report
object — testable with no worker, no Electron, no fs. `axilogWorker.ts` is a
thin message loop with no analysis logic. `axilogService.ts` is the only file
that knows a worker exists.

### The axilog 1.0 container

The format differs from AxiBridge's aggregates in ways that will silently
produce wrong code if assumed away:

- The roster is `entities[]` — there is no top-level `players[]`. Squad members
  are `entities[].role === 'squad'`; the other roles are `friendly_player`,
  `enemy_player`, and `npc`.
- Per-entity statistics live in `blocks.<name>.by_entity`, keyed by
  `entities[].id`. Those are **JSON object keys, so they are strings.**
  `by_entity[entity.id]` works by coercion, but `Object.keys()` gives strings —
  compare accordingly. `axilogEntities.ts` is the single place this is handled;
  every section and every jq result goes through it.
- Names for skills, buffs, damage modifiers, and minions live in `catalogs.*`,
  referenced by id from `blocks`. No block inlines a human-readable name.
- `coverage` reports each block as `present`, `empty`, `not_computed`, or
  `unsupported`.
- `parseFile(path, opts?)` / `parseBuffer(buf, opts?)` return `ReportV1`
  synchronously (`@axiapps/axilog@1.10.0`, `index.d.ts`). `ParseOptions` (Task
  0 spike, verified against `node_modules/@axiapps/axilog/index.d.ts`) is
  **camelCase**, confirming the plan's assumption — a later task's
  `PassFlags` interface should be built directly from this field list, not
  guessed:
  ```ts
  export interface ParseOptions {
    replay?: boolean
    skillDamage?: boolean
    timeseries?: boolean
    missiles?: boolean
    rotation?: boolean
    modifiers?: boolean
    everything?: boolean // union with the individual options, never an override
  }
  ```
  Note `blocks.minions` is gated on `skillDamage`, not a separate `minions`
  flag — see the "Parse passes" section's flag list below, which needs the
  same correction.

### Packaging

`@axiapps/axilog` is a napi native module:

- `package.json` `build.asarUnpack` gains `"**/node_modules/@axiapps/axilog*/**"`
  alongside the existing LanceDB and Xenova entries.
- The Windows packaging verify script asserts the `.node` binary is present in
  the unpacked tree, as it already does for the officer proxy.
- Prebuilt binaries are per-platform. A build for the wrong platform must
  degrade (see Graceful degradation), never crash the app.

## Tool surface

Five read-only tools, named to match the `axibridge_*` family. None are
destructive or action-gated.

**`axilog_logs_list`** — `{ since?, limit?, map? }` → recent fights from the
watcher plus explicitly opened files: `logId`, local time, map folder, size,
`source` (`watched` | `opened`). Filesystem only. How "last fight" and "tonight's
fights" resolve to ids.

**`axilog_fight_overview`** — `{ logId }` → the orienting call and a lean parse.
Encounter (map, duration, start time), team composition counted from
`entities[].role`, squad roster with professions and subgroups, and `coverage`.
The agent calls this first and treats `coverage` as authoritative about what the
log can answer.

**`axilog_sections_list`** — `{ topic? }` → section catalog: keys, summaries,
granularities, fields. With `topic`, alias matching, so "strips" or "who gave
stability" resolves without guessing. Mirrors `findSections`.

**`axilog_section`** — `{ logId, section, granularity?, entity?, role?,
subgroup?, sort?, limit? }` → `{rows, columns, note?, warnings?}` plus a
`display` table payload via `safeRich()`, as `axibridge_section` does. `role`
filters friendly vs enemy. `limit` defaults to 25 so a 122-entity roster cannot
blow the context.

**`axilog_query`** — `{ logId, filter, limit? }` → jq over the raw container,
run inside the worker, hard-capped at 64 KB and truncated with an explicit note
rather than silently. The tool description carries a compact schema map, since
the model has never seen this format. The long-tail escape hatch, not the
default path.

### Parse passes

Each section descriptor declares the axilog `ParseOpts` flags it needs
(`rotation`, `timeseries`, `skill_damage`, `modifiers`, `minions`). The service
compares them against the loaded entry's flags and re-parses with the union when
a section needs more. That is a 70–400 ms re-parse, not a cache miss to reason
about. The model never sees parse flags.

### Deliberately cut

An `axilog_compare` across logs. The agent can call `axilog_section` per `logId`
and compare rows itself; a compare tool would be a second, weaker query language
for something the model already does well.

## Watcher and ingest

**Finding the directory.** Auto-detect candidates on first run, with a settings
override and a folder picker:

- Windows: `%USERPROFILE%/Documents/Guild Wars 2/addons/arcdps/arcdps.cbtlogs`
- Linux/Proton: the same relative path under the Steam or Lutris prefix's
  `drive_c/users/steamuser/Documents/...`

Finding nothing is a normal state, not an error: the panel says so and offers the
picker, and file drop still works.

**Listing.** A debounced directory scan on panel open and every 30 s while
visible. `fs.watch` triggers an early scan opportunistically where available but
is never the source of truth — it is unreliable across platforms and Proton's
filesystem. Handles `.zevtc`, `.evtc`, and `.evtc.zip`; parses `YYYYMMDD-HHMMSS`
from the filename and takes the containing folder as the encounter label.
Registry holds the 100 most recent entries — file metadata only.

**Write settling.** arcdps writes the log as the fight ends, so a file seen
mid-write parses as corrupt. An entry is listed only once its size is stable
across two consecutive scans, or it is older than 60 s.

**`logId`.** First 8 hex of a hash of the absolute path — stable across
restarts. A missing file at parse time returns "log no longer at `<path>`", not
a stack trace.

**Explicit ingest.** Drag-drop onto the composer or a file picker registers the
file as `source: 'opened'` and returns a `logId`, through the same registry as
watched logs. A log from a friend behaves identically to one of your own.

**Conversation persistence.** The conversation record stores the refs it has
touched: `{logId, path, label}`. Reopening a thread still resolves the same
fight; a since-deleted file shows as unavailable rather than silently vanishing.

**Guards.** Configurable, with these defaults:

| Guard | Default | On breach |
| --- | --- | --- |
| File size ceiling | 150 MB compressed | Refuse with the size in the message; never attempt |
| Parse timeout | 30 s | Terminate the worker, return a timeout error |
| Report LRU | 2 entries | Evict oldest |
| Worker idle-kill | 5 min | Worker exits; all report memory released |

The idle-kill is what makes the no-cache decision real: five minutes after the
last question, the memory is gone from the process.

## Agent integration

**System prompt.** A short block added the way `metaPrompt`/`glossaryPrompt`
are, present only when a log source exists (a watched folder or one opened log):

1. **Workflow** — `axilog_logs_list` → `axilog_fight_overview` →
   `axilog_sections_list` (if unsure) → `axilog_section`. `axilog_query` only
   when no section fits.
2. **Vocabulary** — the 1.0 container summary above. Without it the model writes
   AxiBridge-shaped jq against an axilog document.
3. **Coverage honesty** — `coverage` is authoritative. A `not_computed` or
   `unsupported` block means the log does not carry it. Never infer a build from
   an absent block.
4. **Scope** — one `.zevtc` is one fight, not a night. Night-level questions
   belong to AxiBridge. Without this the model generalizes a skirmish into a
   trend.

**Seeded skill** in `skillStore.ts`'s `DEFAULT_SEED`, key `fight-review`.
*When to use:* reviewing one specific fight — "how did that last fight go", "what
happened at 21:14", "why did we lose that push". Instructions in the house style
of `wvw-report`: overview first; lead with what decided the fight (down
contribution, strips, cleanses, stability uptime); one `{{figure}}` chart of the
most telling metric; two short composed markdown tables (pressure, support);
name coverage gaps explicitly. Deletable, and `seeded[]` prevents resurrection.

**Graceful degradation**, per `2026-06-17-graceful-degradation-design.md`: if the
native module fails to load — wrong platform build, missing `.node` after
packaging — `buildAxilogTools` returns an empty array and the Logs panel shows
why. A native module that will not load must never take the app down.

## Testing

`fixtures/wvw-small.anon.zevtc` in the axilog repo is a 1.5 MB anonymized WvW
log (42 players, 120k events) — small enough to commit into AxiVale and real
enough to assert against. Real logs under axilog's `fixtures/local/` carry real
account names and are never used.

Two layers, so the native module is not in the way of most tests:

- **Pure layer (the bulk).** Parse the fixture once; commit the resulting
  document as a JSON fixture. `axilogEntities.test.ts` and
  `axilogSections.test.ts` run against plain JSON — no native module, no worker.
  Every section descriptor gets a test asserting real numbers from a real fight.
- **Native layer (thin).** One `axilogWorker` integration test that parses the
  `.zevtc` and asserts the document matches the committed JSON — the canary for
  a version bump changing the format, and the only test needing the `.node`
  binary. Skipped with a clear message when unavailable.

Watcher tests inject a fake fs and clock (filename parsing, settling across
scans, `.evtc.zip`, size ceiling). Service tests inject `workerPath` as
`axibridgeSummarize` already does. Tool tests call handlers directly, per the
repo pattern. TDD throughout: test first, watch it fail, then implement.

Verification is `vitest --maxWorkers=2` **and `npm run typecheck`** — vitest's
esbuild transform passes type errors through, and CI will not. Plus a case in
`__evals__/agent/cases.ts`: a fight-review question against the fixture,
asserting the agent calls `overview` before `section` and invents no numbers.

## Open question, resolved by a spike (Task 0)

**Can enemy builds be inferred — e.g. "are their necros running minions?"**

**Resolved: no.** A spike (`scripts/spike-axilog-coverage.mjs`, deleted after
recording this finding) ran `parseFile(fixture, { everything: true })` against
the anonymized WvW fixture `../axilog/fixtures/wvw-small.anon.zevtc`.
`coverage.minions` reports `"present"` and `blocks.minions.by_entity` is
populated, but every key in it resolves to an entity with `role: 'squad'` —
zero keys resolve to `role: 'enemy_player'` (32 `enemy_player` entities and 48
`npc` entities in this fixture, none carrying minion rows). arcdps observes
enemies only through what it sees, and enemy minions land as unattributed NPCs,
exactly as the open question anticipated.

Enemy build inference (via minions) is therefore **out of scope**. Task 5's
`minions` section is squad-only: its descriptor does not accept `role:
'enemy_player'`/`role: 'friendly_player'` as a meaningful filter, and any
enemy-scoped minion query gets back a `note`, not an empty or guessed result:
`"This log does not attribute minions to enemy players."` No approximation.

## Build order

| # | Step | Why here |
| --- | --- | --- |
| 0 | Spike: enemy-side coverage | Answers the open question before anything is built around it. Throwaway script. |
| 1 | Dependency + packaging | Prove the binary survives packaging before writing code on top of it. |
| 2 | `axilogEntities.ts` + JSON fixture | Everything downstream needs the resolver. |
| 3 | `axilogWorker.ts` + `axilogService.ts` | Protocol, LRU, guards, idle-kill. |
| 4 | `axilogSections.ts` | Largest step; split per section group (damage/defense, support, boons, rotation). |
| 5 | `axilogWatcher.ts` | Detection, scan, settling, registry. |
| 6 | `tools/axilog.ts` + registration | The five tools. |
| 7 | Logs panel + drag-drop + conversation refs | UI surface and ref persistence. |
| 8 | System prompt + seeded skill + eval case | Agent integration. |
| 9 | Graceful degradation + in-app smoke test | Real logs from the user's own folder. |

Steps 2–4 are independently testable against the JSON fixture, so the risk is
front-loaded into 0 and 1.

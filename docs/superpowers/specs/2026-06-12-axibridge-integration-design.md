# AxiBridge Integration — Design

**Date:** 2026-06-12
**Status:** Approved for planning
**Repos touched:** `axivale` (this repo), `axibridge` (sibling, `../axibridge`)
**Depends on:** the inline rich rendering mechanism (`display` payload, `chart`/`table` blocks) defined in `2026-06-12-axiforge-integration-design.md` §6.

## Goal

Users link the GitHub repos that house their AxiBridge reports, then ask the AI analytics questions over run data — a single run or many: improvement suggestions, areas of good progress, attendance, commander performance — with charts, graphs, and tables rendered inline in chat.

## Context

- AxiBridge (Electron + React + TS) watches arcdps logs, uploads to dps.report (Elite Insights parsing), and publishes reports to GitHub Pages repos: `reports/index.json` (run index), `reports/{id}/report.json` (full EI JSON, **4–37 MB each**), `reports/rollup.json` (cross-report aggregates). One repo per guild/squad; reports are immutable once published.
- Raw report JSON is far too large for model context. AxiBridge already has reusable aggregation logic: `src/renderer/stats/computePlayerAggregation.ts` (70-field per-account `PlayerStats` across runs), `src/web/rollup.ts` (commander/attendance rollup), `src/shared/dashboardMetrics.ts` / `combatMetrics.ts` / `conditionsMetrics.ts` (metric extractors). 15 real fixture runs exist in `axibridge/test-fixtures/boon/`.

## Decisions (made during brainstorming)

1. **Repo linking: manual entry in v1** (`owner/repo` or Pages URL), multiple repos; optional GitHub PAT for private repos / rate limits. **Phase 2:** device-flow OAuth + auto-discovery (scan user repos for `reports/index.json`).
2. **Read-only in v1** — AxiVale never writes to report repos.
3. **Headless mode** added to AxiBridge (`--headless`: watcher/uploader/publisher run without a window).
4. **Local API for live/unpublished session data is Phase 2** (deferred; "how's tonight's raid going?" — reuses the AxiForge discovery-file pattern when built).

## Architecture

### 1. Repo linking & settings (AxiVale)

- Settings → "AxiBridge Repos": add by `owner/repo` or pasted Pages URL (parsed to owner/repo), list with remove; stored via existing `settings.json` mechanism.
- Optional GitHub PAT stored in the existing keyring pattern (`secrets.ts`, alongside Gemini/OpenAI keys). Anonymous fetch works for public repos.

### 2. Data layer: fetch + cache (`src/main/axibridgeClient.ts`)

- Fetch `reports/index.json`, `reports/rollup.json`, `reports/{id}/report.json` from `raw.githubusercontent.com` (PAT header when present), falling back to the Pages URL.
- **Cache policy by immutability:** report.json cached **forever** on disk, keyed `repo/reportId`; index/rollup TTL ~5 minutes.
- Disk cache with size cap (configurable, default ~2 GB) and LRU eviction; downloads stream with progress events surfaced to the UI ("fetching run 3 of 12").

### 3. Aggregation engine

- **`@axiapps/bridge-metrics`** — new workspace package in the AxiBridge repo exporting `computePlayerAggregation`, the rollup builder, and the metric extractors (`dashboardMetrics`, `combatMetrics`, `conditionsMetrics`, boon-uptime helpers). AxiBridge consumes it internally (replacing the in-tree copies); AxiVale depends on it.
- AxiVale runs aggregation in a worker thread (as AxiBridge does) so crunching a season of runs never blocks the main process. Per-run extracted summaries are cached alongside the raw report so multi-run queries don't re-parse 30 MB files.

### 4. Analytics tool suite (read-only; registered in `buildOfficerTools()` via `src/main/tools/axibridge.ts`)

All tools return compact JSON (never raw EI data) and attach `chart`/`table` displays where natural:

| Tool | Returns | Display |
|---|---|---|
| `axibridge_repos_status` | linked repos, run counts, date ranges, fetch/cache state | table |
| `axibridge_runs_list(repo?, from?, to?)` | per run: date, title, commander, duration, squad size, outcome | table |
| `axibridge_run_summary(runId)` | squad totals, per-party breakdown, top performers per metric, boon uptimes, deaths/downs | table |
| `axibridge_player_stats(accounts?, range?)` | multi-run per-account aggregates (`PlayerStats` shape: DPS, healing, cleanses, strips, stab, deaths, profession time…) | table |
| `axibridge_attendance(range?)` | per account: runs joined, combat time, profession split, consistency, last seen | table + chart |
| `axibridge_commander_stats(range?)` | fights led, W/L, KDR, squad outcomes per commander | table |
| `axibridge_compare(a, b)` | deltas between two runs or two date ranges per metric | chart |
| `axibridge_render_chart(spec)` | explicit charting of any aggregate the model computed | chart |

"Improvement suggestions" and "areas of good progress" are model reasoning over `compare` + `player_stats` + boon uptimes — no dedicated tool.

### 5. AxiBridge headless mode (changes in `../axibridge`)

- `--headless` CLI flag: log watcher, dps.report uploader, Discord poster, and GitHub publisher run without creating a window; optional tray icon; single-instance lock so a windowed launch attaches to the running instance.
- Writes the axiom-convention version file and (Phase 2) the `local-api.json` discovery file.

### 6. System prompt & UX

- System prompt gains an analytics-methodology section: ground every claim in tool output; compare players/squads against their own baselines, not invented benchmarks; name the metric behind each suggestion; prefer charts for trends and tables for rosters.
- Settings UI shows linked-repo health (last successful index fetch, cached run count).

## Error handling

| Failure | Behavior |
|---|---|
| Repo unreachable / 404 | Tool returns actionable error naming the repo; other repos unaffected |
| Rate limited (anonymous) | Error suggests adding a PAT in Settings |
| Report download fails mid-stream | Partial file discarded; retry with backoff; error after N attempts |
| `rollup.json` absent (older repos) | Compute rollup locally from cached reports via `bridge-metrics` |
| Run too large / cache cap hit | LRU eviction of least-recently-used reports (extracted summaries are kept) |
| Mixed-version report schemas | `bridge-metrics` extractors tolerate missing fields; tools report which runs were skipped and why — no silent drops |

## Phase 2 (explicitly deferred)

- GitHub device-flow OAuth + repo auto-discovery.
- AxiBridge local API (discovery-file pattern from the AxiForge spec) exposing live/unpublished session data; AxiVale tools for "current session" analytics; auto-spawn headless AxiBridge via the shared `axiAppLauncher`.

## Testing

- `axibridgeClient`: unit tests against fixture index/report/rollup JSON served from a stub server; cache policy tests (immutable vs TTL, LRU eviction).
- Aggregation: `@axiapps/bridge-metrics` tested in the axibridge repo against `test-fixtures/boon/` (15 real runs); AxiVale-side worker tests with trimmed fixtures (full fixtures are 200 MB — check in reduced versions).
- Tool handlers: assert compact output shape and well-formed `chart`/`table` display payloads.
- Vitest with `--maxWorkers=2` per global instructions.

## Out of scope (this spec)

- Any writes to report repos (publishing stays in AxiBridge).
- Cross-guild/multi-repo leaderboards beyond what multi-repo aggregation naturally provides.
- Cloudflare R2 replay data (`replay.json` / combat positions) — analytics here use report.json only.

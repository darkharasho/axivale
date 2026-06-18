import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { safeRich } from './shared'
import type { AxibridgeService } from '../axibridgeService'
import { localRunDate } from '../axibridgeRunDate'
import { runAxibridgeQuery } from '../axibridgeQuery'
import { jqEngine, type JqEngine } from '../jqEngine'
import { relativeAge } from '../axibridgeStale'

const chartSpecSchema = z.object({
  type: z.enum(['line', 'bar', 'area']),
  title: z.string(),
  xKey: z.string(),
  series: z.array(z.object({ key: z.string(), label: z.string(), color: z.string().optional() })),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number()])))
})

const msToHours = (ms: number): number => Math.round((ms / 3_600_000) * 10) / 10

/** Optional table/chart display markers for a stale result (omitted when fresh). */
function staleDisplay(stale: boolean, staleSince: string | null): { stale: true; staleAge: string } | Record<string, never> {
  return stale ? { stale: true, staleAge: relativeAge(staleSince) ?? 'unknown age' } : {}
}

/**
 * AxiBridge analytics tools. All read-only: they fetch published WvW report
 * aggregates from the linked repos and never mutate anything. Each handler
 * returns compact JSON for the model plus an optional rich `display` payload
 * (a chart or table) for the renderer via safeRich().
 *
 * The service is passed as a thunk so repos/PAT are read fresh from settings on
 * every call — mirrors how other settings-derived clients are resolved.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildAxibridgeTools(
  service: () => AxibridgeService,
  jq: JqEngine = jqEngine
): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'axibridge_repos_status',
      'Status of the linked AxiBridge report repos: run counts, date ranges, and fetch/cache state. Start here when a repo seems empty or unreachable.',
      {},
      safeRich(async () => {
        const status = await service().reposStatus()
        return {
          value: status,
          display: {
            kind: 'table',
            data: {
              title: 'Linked AxiBridge repos',
              columns: [
                { key: 'repo', label: 'Repo' },
                { key: 'runs', label: 'Runs' },
                { key: 'firstRun', label: 'First run' },
                { key: 'lastRun', label: 'Last run' },
                { key: 'cachedReports', label: 'Cached' },
                { key: 'stale', label: 'Live?' },
                { key: 'error', label: 'Error' }
              ],
              rows: status.repos.map((r) => ({
                repo: r.repo,
                runs: r.runs,
                firstRun: r.firstRun ?? '—',
                lastRun: r.lastRun ?? '—',
                cachedReports: r.cachedReports,
                stale: r.stale ? `cached · ${relativeAge(r.staleSince) ?? 'unknown age'}` : 'live',
                error: r.error ?? ''
              }))
            }
          }
        }
      })
    ),
    tool(
      'axibridge_runs_list',
      'List published runs across linked repos, newest first: id, date, title, commander(s). Filter by repo ("owner/repo") and/or ISO date range.',
      {
        repo: z.string().optional().describe('Limit to one repo, e.g. "darkharasho/eww-reports"'),
        from: z.string().optional().describe('Earliest date, YYYY-MM-DD'),
        to: z.string().optional().describe('Latest date, YYYY-MM-DD')
      },
      safeRich(async ({ repo, from, to }) => {
        const result = await service().runsList({ repo, from, to })
        const rows = result.runs.map((r) => ({
          id: r.id,
          date: localRunDate(r.id, r.dateStart) ?? '—',
          title: r.title,
          commanders: r.commanders.join(', '),
          repo: r.repo,
          squad: r.summary?.avgSquadSize ?? '—'
        }))
        // No inline figure: a run listing is reference data / an action, not a
        // graph. It stays a compact action card in the rail; the model
        // summarizes (count, range, the few that matter) in prose.
        return { value: { count: rows.length, runs: rows, errors: result.errors, staleRepos: result.staleRepos, stale: result.stale, staleSince: result.staleSince } }
      })
    ),
    tool(
      'axibridge_run_summary',
      'Compact summary of one run: fight totals, W/L, squad deaths/downs, per-player metric rows, and top performers. Pass a run id from axibridge_runs_list.',
      { run_id: z.string().describe('Run id, e.g. "20260117-1751"') },
      safeRich(async ({ run_id }) => {
        const { summary, skippedRuns } = await service().runSummary(run_id)
        const playerRows = summary.players.map((p) => ({
          account: p.account,
          profession: p.profession,
          damage: p.damage,
          downContribution: p.downContribution,
          cleanses: p.cleanses,
          strips: p.strips,
          healing: p.healing,
          deaths: p.deaths,
          downs: p.downs
        }))
        const top = (key: 'damage' | 'healing' | 'cleanses' | 'strips'): string | null =>
          [...summary.players].sort((a, b) => b[key] - a[key])[0]?.account ?? null
        return {
          value: {
            run: {
              id: summary.id,
              title: summary.title,
              date: localRunDate(summary.id, summary.dateStart),
              fights: summary.fights,
              wins: summary.wins,
              losses: summary.losses,
              avgSquadSize: summary.avgSquadSize,
              avgEnemies: summary.avgEnemies,
              squadDeaths: summary.squadDeaths,
              squadDowns: summary.squadDowns,
              enemyDeaths: summary.enemyDeaths,
              enemyDowns: summary.enemyDowns,
              commanders: summary.commanders
            },
            topPerformers: { damage: top('damage'), healing: top('healing'), cleanses: top('cleanses'), strips: top('strips') },
            players: playerRows,
            warnings: summary.warnings,
            skippedRuns
          },
          display: {
            kind: 'table',
            data: {
              title: `${summary.title} — ${summary.wins}W/${summary.losses}L over ${summary.fights} fights`,
              columns: [
                { key: 'account', label: 'Account' },
                { key: 'profession', label: 'Profession' },
                { key: 'damage', label: 'Damage' },
                { key: 'downContribution', label: 'Down contrib' },
                { key: 'cleanses', label: 'Cleanses' },
                { key: 'strips', label: 'Strips' },
                { key: 'healing', label: 'Healing' },
                { key: 'deaths', label: 'Deaths' }
              ],
              rows: playerRows
            }
          }
        }
      })
    ),
    tool(
      'axibridge_player_stats',
      'Multi-run per-account aggregates (damage/DPS, healing, cleanses, strips, deaths, profession time). Optionally filter accounts and date range. Runs that could not be parsed are listed in skippedRuns — never silently dropped.',
      {
        accounts: z.array(z.string()).optional().describe('GW2 account names, e.g. ["Logan.1234"]'),
        from: z.string().optional().describe('Earliest date, YYYY-MM-DD'),
        to: z.string().optional().describe('Latest date, YYYY-MM-DD')
      },
      safeRich(async ({ accounts, from, to }) => {
        const result = await service().playerStats({ accounts, from, to })
        const rows = result.players.map((p) => ({
          account: p.account,
          runs: p.runsJoined,
          dps: Math.round(p.dps),
          damage: p.damage,
          cleanses: p.cleanses,
          strips: p.strips,
          healing: p.healing,
          deaths: p.deaths,
          combatHours: msToHours(p.combatTimeMs),
          professions: Object.keys(p.professionTimeMs).join(', '),
          lastSeen: p.lastSeen ?? '—'
        }))
        return {
          value: { players: rows, runsConsidered: result.runsConsidered, skippedRuns: result.skippedRuns, errors: result.errors, stale: result.stale, staleSince: result.staleSince },
          display: {
            kind: 'table',
            data: {
              title: 'Player stats',
              columns: [
                { key: 'account', label: 'Account' },
                { key: 'runs', label: 'Runs' },
                { key: 'dps', label: 'DPS' },
                { key: 'cleanses', label: 'Cleanses' },
                { key: 'strips', label: 'Strips' },
                { key: 'healing', label: 'Healing' },
                { key: 'deaths', label: 'Deaths' },
                { key: 'combatHours', label: 'Combat h' }
              ],
              rows,
              ...staleDisplay(result.stale, result.staleSince)
            }
          }
        }
      })
    ),
    tool(
      'axibridge_attendance',
      'Attendance per account: runs joined, combat time, squad time, primary profession, last seen. With no dates it returns the whole-history rollup (large); pass from/to to narrow to a date range (computed from the runs in that window).',
      {
        from: z.string().optional().describe('Earliest date, YYYY-MM-DD'),
        to: z.string().optional().describe('Latest date, YYYY-MM-DD')
      },
      safeRich(async ({ from, to }) => {
        const result = await service().attendance({ from, to })
        const rows = result.attendance.map((r) => ({
          account: r.account,
          profession: r.profession,
          runs: r.runs,
          combatHours: msToHours(r.combatTimeMs),
          squadHours: msToHours(r.squadTimeMs),
          lastSeen: r.lastSeenTs ? new Date(r.lastSeenTs).toISOString().slice(0, 10) : '—'
        }))
        return {
          value: {
            attendance: rows,
            rollupSource: result.rollupSource,
            stale: result.stale,
            staleSince: result.staleSince,
            ...('range' in result ? { range: result.range } : {}),
            ...('runsConsidered' in result ? { runsConsidered: result.runsConsidered } : {}),
            ...('skippedRuns' in result && result.skippedRuns?.length
              ? { skippedRuns: result.skippedRuns }
              : {})
          },
          display: {
            kind: 'table',
            data: {
              title: from || to ? `Attendance · ${from ?? '…'} – ${to ?? '…'}` : 'Attendance',
              columns: [
                { key: 'account', label: 'Account' },
                { key: 'profession', label: 'Main profession' },
                { key: 'runs', label: 'Runs' },
                { key: 'combatHours', label: 'Combat h' },
                { key: 'squadHours', label: 'Squad h' },
                { key: 'lastSeen', label: 'Last seen' }
              ],
              rows,
              ...staleDisplay(result.stale, result.staleSince)
            }
          }
        }
      })
    ),
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
    tool(
      'axibridge_commander_stats',
      'Per-commander record from the cross-run rollup: fights led, W/L, KDR, kills, deaths.',
      {
        from: z.string().optional().describe('Earliest date, YYYY-MM-DD'),
        to: z.string().optional().describe('Latest date, YYYY-MM-DD')
      },
      safeRich(async ({ from, to }) => {
        const result = await service().commanderStats({ from, to })
        const rows = result.commanders.map((c) => ({
          account: c.account,
          profession: c.profession,
          runs: c.runs,
          fightsLed: c.fightsLed,
          wins: c.wins,
          losses: c.losses,
          kdr: Math.round(c.kdr * 100) / 100,
          kills: c.kills,
          deaths: c.commanderDeaths
        }))
        return {
          value: { commanders: rows, rollupSource: result.rollupSource, stale: result.stale, staleSince: result.staleSince },
          display: {
            kind: 'table',
            data: {
              title: 'Commanders',
              columns: [
                { key: 'account', label: 'Commander' },
                { key: 'fightsLed', label: 'Fights led' },
                { key: 'wins', label: 'W' },
                { key: 'losses', label: 'L' },
                { key: 'kdr', label: 'KDR' },
                { key: 'deaths', label: 'Deaths' }
              ],
              rows,
              ...staleDisplay(result.stale, result.staleSince)
            }
          }
        }
      })
    ),
    tool(
      'axibridge_compare',
      'Per-metric deltas between two runs or two date ranges. BOTH arguments are required, each a run id (from axibridge_runs_list) OR a date range "YYYY-MM-DD..YYYY-MM-DD". Example: { "first": "20260601-2030-ab12", "second": "20260611-1808-zq6c" }.',
      {
        first: z
          .string()
          .min(1)
          .describe('Required. First run id or date range "YYYY-MM-DD..YYYY-MM-DD" (the baseline)'),
        second: z
          .string()
          .min(1)
          .describe('Required. Second run id or date range "YYYY-MM-DD..YYYY-MM-DD" (compared to the first)')
      },
      safeRich(async ({ first, second }) => {
        const result = await service().compare(first, second)
        const rows = result.comparison.metrics.map((m) => ({ metric: m.metric, a: m.a, b: m.b, delta: m.delta }))
        return {
          value: result,
          display: {
            kind: 'chart',
            data: {
              type: 'bar',
              title: `Compare ${first} vs ${second}`,
              xKey: 'metric',
              series: [
                { key: 'a', label: first },
                { key: 'b', label: second }
              ],
              rows
            }
          }
        }
      })
    ),
    tool(
      'axibridge_render_chart',
      'Render a chart from any aggregate you computed yourself (e.g. a DPS-per-run trend assembled from axibridge_run_summary calls). rows are objects keyed by xKey and each series key.',
      { spec: chartSpecSchema },
      safeRich(async ({ spec }) => ({
        value: { rendered: true, title: spec.title, points: spec.rows.length },
        display: { kind: 'chart', data: spec }
      }))
    )
  ]
}

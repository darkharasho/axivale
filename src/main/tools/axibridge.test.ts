import { describe, it, expect, vi } from 'vitest'
import { buildAxibridgeTools } from './axibridge'

const fakeService = {
  reposStatus: vi.fn(async () => ({ repos: [{ repo: 'o/a', runs: 2, firstRun: '2026-06-01', lastRun: '2026-06-08', cachedReports: 1, lastIndexFetch: 1, error: null }] })),
  runsList: vi.fn(async () => ({ runs: [{ id: 'r1', title: 'Run 1', repo: 'o/a', commanders: ['C.1'], dateStart: '2026-06-01T19:00:00Z', dateEnd: '2026-06-01T21:00:00Z' }], errors: [] })),
  runSummary: vi.fn(async () => ({ summary: { id: 'r1', title: 'Run 1', fights: 2, wins: 1, losses: 1, squadDeaths: 3, squadDowns: 5, enemyDeaths: 8, enemyDowns: 12, avgSquadSize: 25, avgEnemies: 30, commanders: ['C.1'], dateStart: '2026-06-01T19:00:00Z', dateEnd: null, players: [], warnings: [] }, skippedRuns: [] })),
  playerStats: vi.fn(async () => ({ players: [{ account: 'P.1', runsJoined: 2, dps: 1200, damage: 100, combatTimeMs: 1, squadTimeMs: 2, professionTimeMs: { Scourge: 1 }, downContribution: 1, kills: 1, strips: 1, cleanses: 1, resurrects: 0, healing: 0, barrier: 0, damageTaken: 1, downs: 0, deaths: 0, lastSeen: '2026-06-08' }], runsConsidered: 2, skippedRuns: [], errors: [] })),
  attendance: vi.fn(async () => ({ attendance: [{ account: 'P.1', characterNames: [], profession: 'Scourge', runs: 2, combatTimeMs: 1, squadTimeMs: 2, lastSeenTs: 1 }], rollupSource: 'published', range: {} })),
  commanderStats: vi.fn(async () => ({ commanders: [{ account: 'C.1', characterNames: [], profession: 'Firebrand', runs: 2, fightsLed: 4, kills: 10, downs: 14, commanderDeaths: 0, alliesDead: 2, wins: 2, losses: 2, kdr: 5, lastSeenTs: 1 }], rollupSource: 'published', range: {} })),
  compare: vi.fn(async () => ({ a: 'r1', b: 'r2', runsA: 1, runsB: 1, comparison: { metrics: [{ metric: 'squadDeaths', a: 3, b: 1, delta: -2, deltaPct: -2 / 3 }] } }))
}

const tools = buildAxibridgeTools(() => fakeService as never)
const byName = (name: string) => tools.find((t) => t.name === name)!
const parse = (res: { content: Array<{ text: string }> }) => JSON.parse(res.content[0].text)

describe('axibridge tools', () => {
  it('registers exactly the spec table', () => {
    expect(tools.map((t) => t.name).sort()).toEqual([
      'axibridge_attendance',
      'axibridge_commander_stats',
      'axibridge_compare',
      'axibridge_player_stats',
      'axibridge_render_chart',
      'axibridge_repos_status',
      'axibridge_run_summary',
      'axibridge_runs_list'
    ])
  })
  it('repos_status returns compact JSON and a table display', async () => {
    const res = (await byName('axibridge_repos_status').handler({}, {})) as never as {
      content: Array<{ text: string }>
      display?: { kind: string; data: { columns: Array<{ key: string }> } }
    }
    expect(parse(res).repos[0].repo).toBe('o/a')
    expect(res.display?.kind).toBe('table')
    expect(res.display?.data.columns.map((c) => c.key)).toContain('runs')
  })
  it('attendance attaches both a table and a chart-capable payload', async () => {
    const res = (await byName('axibridge_attendance').handler({}, {})) as never as { display?: { kind: string } }
    expect(res.display?.kind).toBe('table')
  })
  it('compare attaches a chart display with the spec shape', async () => {
    const res = (await byName('axibridge_compare').handler({ a: 'r1', b: 'r2' }, {})) as never as {
      display?: { kind: string; data: { type: string; xKey: string; series: Array<{ key: string }>; rows: unknown[] } }
    }
    expect(res.display?.kind).toBe('chart')
    expect(res.display?.data.type).toBe('bar')
    expect(res.display?.data.xKey).toBe('metric')
    expect(res.display?.data.series.map((s) => s.key)).toEqual(['a', 'b'])
  })
  it('render_chart validates and echoes the spec', async () => {
    const spec = { type: 'line' as const, title: 'DPS over runs', xKey: 'run', series: [{ key: 'dps', label: 'DPS' }], rows: [{ run: 'r1', dps: 1200 }] }
    const res = (await byName('axibridge_render_chart').handler({ spec }, {})) as never as { display?: { kind: string; data: unknown } }
    expect(res.display?.kind).toBe('chart')
    expect(res.display?.data).toEqual(spec)
  })
  it('errors surface as MCP error results, not exceptions', async () => {
    fakeService.runSummary.mockRejectedValueOnce(new Error('Run zzz not found'))
    const res = (await byName('axibridge_run_summary').handler({ run_id: 'zzz' }, {})) as never as { isError?: boolean; content: Array<{ text: string }> }
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('zzz')
  })
})

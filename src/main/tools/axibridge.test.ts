import { describe, it, expect, vi } from 'vitest'
import { buildAxibridgeTools } from './axibridge'
import type { JqEngine } from '../jqEngine'

const fakeService = {
  reposStatus: vi.fn(async () => ({ repos: [{ repo: 'o/a', runs: 2, firstRun: '2026-06-01', lastRun: '2026-06-08', cachedReports: 1, lastIndexFetch: 1, error: null, stale: false, staleSince: null }] })),
  runsList: vi.fn(async () => ({ runs: [{ id: 'r1', title: 'Run 1', repo: 'o/a', commanders: ['C.1'], dateStart: '2026-06-01T19:00:00Z', dateEnd: '2026-06-01T21:00:00Z' }], errors: [], staleRepos: [], stale: false, staleSince: null })),
  runSummary: vi.fn(async () => ({ summary: { id: 'r1', title: 'Run 1', fights: 2, wins: 1, losses: 1, squadDeaths: 3, squadDowns: 5, enemyDeaths: 8, enemyDowns: 12, avgSquadSize: 25, avgEnemies: 30, commanders: ['C.1'], dateStart: '2026-06-01T19:00:00Z', dateEnd: null, players: [], warnings: [] }, skippedRuns: [] })),
  playerStats: vi.fn(async () => ({ players: [{ account: 'P.1', runsJoined: 2, dps: 1200, damage: 100, combatTimeMs: 1, squadTimeMs: 2, professionTimeMs: { Scourge: 1 }, downContribution: 1, kills: 1, strips: 1, cleanses: 1, resurrects: 0, healing: 0, barrier: 0, damageTaken: 1, downs: 0, deaths: 0, lastSeen: '2026-06-08' }], runsConsidered: 2, skippedRuns: [], errors: [], stale: false, staleSince: null })),
  attendance: vi.fn(async () => ({ attendance: [{ account: 'P.1', characterNames: [], profession: 'Scourge', runs: 2, combatTimeMs: 1, squadTimeMs: 2, lastSeenTs: 1 }], rollupSource: 'published', range: {}, stale: false, staleSince: null })),
  commanderStats: vi.fn(async () => ({ commanders: [{ account: 'C.1', characterNames: [], profession: 'Firebrand', runs: 2, fightsLed: 4, kills: 10, downs: 14, commanderDeaths: 0, alliesDead: 2, wins: 2, losses: 2, kdr: 5, lastSeenTs: 1 }], rollupSource: 'published', range: {}, stale: false, staleSince: null })),
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
      'axibridge_query',
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
    const res = (await byName('axibridge_compare').handler({ first: 'r1', second: 'r2' }, {})) as never as {
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

  it('attendance surfaces stale in value and display when the service reports stale', async () => {
    fakeService.attendance.mockResolvedValueOnce({
      attendance: [{ account: 'P.1', characterNames: [], profession: 'Scourge', runs: 2, combatTimeMs: 1, squadTimeMs: 2, lastSeenTs: 1 }],
      rollupSource: 'published', range: {}, stale: true, staleSince: '2025-06-15T15:06:40.000Z'
    })
    const res = (await byName('axibridge_attendance').handler({}, {})) as never as {
      content: Array<{ text: string }>
      display?: { kind: string; data: { stale?: boolean; staleAge?: string } }
    }
    expect(parse(res).stale).toBe(true)
    expect(parse(res).staleSince).toBe('2025-06-15T15:06:40.000Z')
    expect(res.display?.data.stale).toBe(true)
    expect(typeof res.display?.data.staleAge).toBe('string') // e.g. "Nd ago"
  })

  it('attendance omits stale markers when fresh', async () => {
    const res = (await byName('axibridge_attendance').handler({}, {})) as never as {
      content: Array<{ text: string }>; display?: { data: { stale?: boolean } }
    }
    expect(parse(res).stale).toBe(false)
    expect(res.display?.data.stale).toBeUndefined()
  })

  it('runs_list passes stale + staleRepos into value', async () => {
    fakeService.runsList.mockResolvedValueOnce({
      runs: [], errors: [], staleRepos: ['o/a'], stale: true, staleSince: '2025-06-15T15:06:40.000Z'
    })
    const res = (await byName('axibridge_runs_list').handler({}, {})) as never as { content: Array<{ text: string }> }
    expect(parse(res).stale).toBe(true)
    expect(parse(res).staleRepos).toEqual(['o/a'])
  })
})

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

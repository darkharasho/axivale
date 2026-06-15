import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AxibridgeService } from './axibridgeService'
import { AxibridgeCache } from './axibridgeCache'
import { AxibridgeError } from './axibridgeClient'

const repoA = { owner: 'o', repo: 'a' }
const report = (id: string, dateStart: string) => ({
  meta: { id, title: id, dateStart, dateEnd: dateStart, commanders: ['C.1'] },
  stats: {
    total: 2, wins: 1, losses: 1,
    attendanceData: [{ account: 'P.1', characterNames: [], combatTimeMs: 60_000, squadTimeMs: 120_000, classTimes: [{ profession: 'Scourge', timeMs: 60_000 }] }],
    commanderStats: { rows: [{ account: 'C.1', characterNames: [], profession: 'Firebrand', fights: 2, kills: 5, downs: 7, commanderDeaths: 0, alliesDead: 1, wins: 1, losses: 1 }] },
    offensePlayers: [{ account: 'P.1', profession: 'Scourge', professionList: ['Scourge'], totalFightMs: 60_000, offenseTotals: { damage: 100_000, killed: 1, downed: 2, downContribution: 5_000, boonStrips: 4 }, offenseRateWeights: {} }]
  }
})

function makeService(overrides: Partial<Record<string, unknown>> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'axibridge-svc-'))
  const cache = new AxibridgeCache({ dir, capBytes: 2 ** 31, ttlMs: 300_000 })
  const fakeClient = {
    fetchIndex: async () => [
      { id: 'r1', title: 'Run 1', commanders: ['C.1'], dateStart: '2026-06-01T19:00:00Z', dateEnd: '2026-06-01T21:00:00Z' },
      { id: 'r2', title: 'Run 2', commanders: ['C.1'], dateStart: '2026-06-08T19:00:00Z', dateEnd: '2026-06-08T21:00:00Z' }
    ],
    fetchRollup: async () => null, // older repo: forces local computation
    fetchReport: async (_repo: unknown, id: string) =>
      id === 'r1' ? report('r1', '2026-06-01T19:00:00Z') : report('r2', '2026-06-08T19:00:00Z'),
    ...overrides
  }
  return new AxibridgeService({
    repos: () => [repoA],
    client: fakeClient as never,
    cache,
    // run jobs inline in tests instead of spawning a worker thread
    summarize: async (jobs) => (await import('./axibridgeSummarize')).runSummaryJobs(jobs),
    onProgress: () => {}
  })
}

describe('AxibridgeService', () => {
  it('lists runs across linked repos with date filtering', async () => {
    const svc = makeService()
    const all = await svc.runsList({})
    expect(all.runs).toHaveLength(2)
    const filtered = await svc.runsList({ from: '2026-06-05' })
    expect(filtered.runs.map((r) => r.id)).toEqual(['r2'])
  })
  it('computes the rollup locally when rollup.json is absent', async () => {
    const svc = makeService()
    const result = await svc.commanderStats({})
    expect(result.commanders[0].account).toBe('C.1')
    expect(result.commanders[0].fightsLed).toBe(4) // 2 fights × 2 runs
    expect(result.rollupSource).toBe('computed-locally')
  })
  it('aggregates player stats over cached summaries and reports skipped runs', async () => {
    const svc = makeService({
      fetchReport: async (_repo: unknown, id: string) =>
        id === 'r1' ? report('r1', '2026-06-01T19:00:00Z') : { stats: {} } // r2 has no meta.id
    })
    const result = await svc.playerStats({})
    expect(result.players[0].account).toBe('P.1')
    expect(result.players[0].runsJoined).toBe(1)
    expect(result.skippedRuns).toEqual([{ id: 'r2', reason: expect.stringContaining('meta.id') }])
  })
  it('attendance with a date range reaggregates from the runs in that window', async () => {
    const svc = makeService()
    // No range → whole-history rollup (both runs, computed locally here).
    const full = await svc.attendance({})
    expect(full.attendance[0].account).toBe('P.1')
    expect(full.attendance[0].runs).toBe(2)
    // Range covering only r2 → a single run's worth of attendance, with run metadata.
    const ranged = await svc.attendance({ from: '2026-06-05' })
    expect(ranged.rollupSource).toBe('computed-locally')
    expect(ranged.attendance[0].account).toBe('P.1')
    expect(ranged.attendance[0].runs).toBe(1)
    expect(ranged.attendance[0].profession).toBe('Scourge')
    expect('runsConsidered' in ranged && ranged.runsConsidered).toBe(1)
  })
  it('one broken repo does not break the others', async () => {
    const svc = makeService({
      fetchIndex: async (repo: { repo: string }) => {
        throw new AxibridgeError(`Repo o/${repo.repo} is unreachable`, 'not-found')
      }
    })
    const status = await svc.reposStatus()
    expect(status.repos[0].error).toContain('o/a')
  })
})

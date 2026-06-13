import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSummaryJobs, summarizeInWorker, summarizeResilient } from './axibridgeSummarize'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'axibridge-sum-'))
})

const report = {
  meta: { id: 'r1', title: 'Reset', dateStart: '2026-01-17T17:51:20Z', dateEnd: '2026-01-17T19:00:00Z' },
  stats: { total: 3, wins: 2, losses: 1, attendanceData: [{ account: 'P.1', characterNames: [], combatTimeMs: 1, squadTimeMs: 2, classTimes: [] }] }
}

describe('summarizeInWorker', () => {
  it('rejects (not hangs) when pointed at a non-existent worker path', async () => {
    const bogusPath = join(tmpdir(), 'does-not-exist-axibridgeWorker.js')
    await expect(
      summarizeInWorker([{ id: 'r1', reportPath: '/any', summaryPath: '/any.sum' }], bogusPath),
    ).rejects.toThrow()
  }, 10_000)
})

describe('summarizeResilient', () => {
  it('falls back to inline summarizing when the worker bundle is missing', async () => {
    const reportPath = join(dir, 'report.json')
    const summaryPath = join(dir, 'r1.summary.json')
    writeFileSync(reportPath, JSON.stringify(report))
    const bogusWorker = join(tmpdir(), 'does-not-exist-axibridgeWorker.js')
    const res = await summarizeResilient([{ id: 'r1', reportPath, summaryPath }], bogusWorker)
    expect(res.summaries).toHaveLength(1)
    expect(res.summaries[0].id).toBe('r1')
    expect(res.skipped).toHaveLength(0)
    expect(existsSync(summaryPath)).toBe(true) // inline path still writes the summary cache
  })
})

describe('runSummaryJobs', () => {
  it('parses reports, writes summary cache files, returns summaries', () => {
    const reportPath = join(dir, 'r1.json')
    const summaryPath = join(dir, 'r1.summary.json')
    writeFileSync(reportPath, JSON.stringify(report))
    const result = runSummaryJobs([{ id: 'r1', reportPath, summaryPath }])
    expect(result.summaries).toHaveLength(1)
    expect(result.summaries[0].fights).toBe(3)
    expect(existsSync(summaryPath)).toBe(true)
  })
  it('reuses an existing summary without re-parsing the report', () => {
    const summaryPath = join(dir, 'r1.summary.json')
    writeFileSync(summaryPath, JSON.stringify({ id: 'r1', fights: 99, wins: 0, losses: 0, players: [], warnings: [], commanders: [], title: 'cached', dateStart: null, dateEnd: null, avgSquadSize: null, avgEnemies: null, squadDeaths: 0, squadDowns: 0, enemyDeaths: 0, enemyDowns: 0 }))
    const result = runSummaryJobs([{ id: 'r1', reportPath: join(dir, 'missing.json'), summaryPath }])
    expect(result.summaries[0].fights).toBe(99) // report file untouched
  })
  it('reports skipped runs with reasons instead of silently dropping them', () => {
    const badPath = join(dir, 'bad.json')
    writeFileSync(badPath, '{"stats": {}}') // no meta.id
    const result = runSummaryJobs([{ id: 'bad', reportPath: badPath, summaryPath: join(dir, 'bad.summary.json') }])
    expect(result.summaries).toHaveLength(0)
    expect(result.skipped).toEqual([{ id: 'bad', reason: expect.stringContaining('meta.id') }])
  })
})

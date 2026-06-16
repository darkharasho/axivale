import { describe, it, expect, vi } from 'vitest'
import { buildQueryDocument, type QueryableService } from './axibridgeQuery'

function fakeService(overrides: Partial<QueryableService> = {}): QueryableService {
  return {
    reposStatus: vi.fn(async () => ({ repos: [{ repo: 'o/a' }] })),
    runsList: vi.fn(async () => ({ runs: [{ id: 'r1' }, { id: 'r2' }], errors: [] })),
    attendance: vi.fn(async () => ({ attendance: [{ account: 'P.1', combatTimeMs: 5 }] })),
    commanderStats: vi.fn(async () => ({ commanders: [{ account: 'C.1', fightsLed: 4 }] })),
    runSummary: vi.fn(async (id: string) => ({ summary: { id, fights: 2 } })),
    ...overrides
  } as unknown as QueryableService
}

describe('buildQueryDocument', () => {
  it('builds the cheap base and leaves summaries empty when unscoped', async () => {
    const svc = fakeService()
    const doc = await buildQueryDocument(svc, { query: '.' })
    expect(doc.repos).toEqual(['o/a'])
    expect(doc.runs.map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(doc.rollup.playerRows[0].account).toBe('P.1')
    expect(doc.rollup.commanderRows[0].account).toBe('C.1')
    expect(doc.summaries).toEqual({})
    expect(svc.runSummary).not.toHaveBeenCalled()
  })

  it('materializes summaries for every run in a date range', async () => {
    const svc = fakeService()
    const doc = await buildQueryDocument(svc, { query: '.', from: '2026-06-01' })
    expect(Object.keys(doc.summaries).sort()).toEqual(['r1', 'r2'])
    expect(doc.summaries.r1).toEqual({ id: 'r1', fights: 2 })
  })

  it('materializes summaries for an explicit runs[] list', async () => {
    const svc = fakeService()
    const doc = await buildQueryDocument(svc, { query: '.', runs: ['r2'] })
    expect(Object.keys(doc.summaries)).toEqual(['r2'])
  })

  it('skips runs that cannot be summarized rather than failing the whole query', async () => {
    const svc = fakeService({
      runSummary: vi.fn(async (id: string) => {
        if (id === 'r1') throw new Error('unparseable')
        return { summary: { id, fights: 2 } }
      })
    })
    const doc = await buildQueryDocument(svc, { query: '.', runs: ['r1', 'r2'] })
    expect(Object.keys(doc.summaries)).toEqual(['r2'])
  })

  it('refuses to load more than MAX_SCOPED_RUNS at once', async () => {
    const many = Array.from({ length: 81 }, (_, i) => ({ id: `r${i}` }))
    const svc = fakeService({ runsList: vi.fn(async () => ({ runs: many, errors: [] })) })
    await expect(buildQueryDocument(svc, { query: '.', from: '2026-01-01' })).rejects.toThrow(/narrow/i)
  })
})

import { describe, it, expect, vi } from 'vitest'
import { buildQueryDocument, shapeQueryResult, type QueryableService } from './axibridgeQuery'

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

describe('shapeQueryResult', () => {
  it('renders an array of uniform objects as a table and caps rows', () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ account: `P.${i}`, hrs: i }))
    const shaped = shapeQueryResult([rows], { title: 'Attendance', limit: 50 })
    expect(shaped.display?.kind).toBe('table')
    const data = (shaped.display as { data: { columns: { key: string }[]; rows: unknown[] } }).data
    expect(data.columns.map((c) => c.key)).toEqual(['account', 'hrs'])
    expect(data.rows).toHaveLength(50)
    expect((shaped.value as { total: number; truncated: boolean }).total).toBe(60)
    expect((shaped.value as { truncated: boolean }).truncated).toBe(true)
  })

  it('coerces non-primitive cell values to JSON strings for the table', () => {
    const shaped = shapeQueryResult([[{ account: 'A', tags: ['x', 'y'] }]], { title: 't', limit: 50 })
    const data = (shaped.display as { data: { rows: Array<Record<string, unknown>> } }).data
    expect(data.rows[0].tags).toBe('["x","y"]')
  })

  it('renders a flat object as a field/value table', () => {
    const shaped = shapeQueryResult([{ totalRuns: 12, totalHours: 40 }], { title: 'Totals', limit: 50 })
    expect(shaped.display?.kind).toBe('table')
    const data = (shaped.display as { data: { columns: { key: string }[]; rows: unknown[] } }).data
    expect(data.columns.map((c) => c.key)).toEqual(['field', 'value'])
    expect(data.rows).toHaveLength(2)
  })

  it('renders a scalar as a code block', () => {
    const shaped = shapeQueryResult([42], { title: 'Count', limit: 50 })
    expect(shaped.display?.kind).toBe('code')
    expect((shaped.display as { data: { text: string } }).data.text).toBe('42')
    expect(shaped.value).toBe(42)
  })

  it('renders a nested/irregular value as a code block', () => {
    const shaped = shapeQueryResult([{ a: { b: [1, 2] } }], { title: 'x', limit: 50 })
    expect(shaped.display?.kind).toBe('code')
  })

  it('truncates an over-long code block', () => {
    const big = { s: 'x'.repeat(10_000) }
    const shaped = shapeQueryResult([big], { title: 'x', limit: 50 })
    const text = (shaped.display as { data: { text: string } }).data.text
    expect(text.length).toBeLessThanOrEqual(4_100)
    expect(text).toContain('truncated')
  })

  it('byte-caps a huge table by dropping rows below the row limit', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ account: `P.${i}`, blob: 'y'.repeat(2_000) }))
    const shaped = shapeQueryResult([rows], { title: 'x', limit: 50 })
    const value = shaped.value as { rows: unknown[]; truncated: boolean }
    expect(JSON.stringify(value).length).toBeLessThanOrEqual(20_000)
    expect(value.truncated).toBe(true)
  })
})

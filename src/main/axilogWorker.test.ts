import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadAxilog } from './axilogNative'
import { handle } from './axilogWorker'
import type { AxilogReport } from './axilogEntities'

const FIXTURE = join(__dirname, '__fixtures__', 'wvw-small.anon.zevtc')
const native = loadAxilog()
const describeNative = native ? describe : describe.skip

describeNative('axilogWorker (needs the @axiapps/axilog native binary)', () => {
  it('parses the fixture into the same document the committed JSON holds', () => {
    const fresh = native!.parseFile(FIXTURE, { everything: true }) as AxilogReport
    const committed = JSON.parse(
      readFileSync(join(__dirname, '__fixtures__', 'wvw-small.report.json'), 'utf8')
    ) as AxilogReport
    expect(fresh.axilog.schema).toBe(committed.axilog.schema)
    expect(fresh.entities.length).toBe(committed.entities.length)
    expect(Object.keys(fresh.blocks).sort()).toEqual(Object.keys(committed.blocks).sort())
    expect(fresh.coverage).toEqual(committed.coverage)
  })

  it('builds an overview without leaking the report', async () => {
    const overview = (await handle({
      id: 1,
      kind: 'overview',
      logId: 'fx',
      path: FIXTURE
    })) as Record<string, unknown>
    expect(overview.map).toBeTypeOf('string')
    expect(overview).not.toHaveProperty('blocks')
    expect(overview).not.toHaveProperty('entities')
    expect((overview.squad as unknown[]).length).toBeGreaterThan(0)
  })

  it('caps a runaway jq filter by serialized size', async () => {
    const res = (await handle({
      id: 2,
      kind: 'query',
      logId: 'fx',
      path: FIXTURE,
      filter: '.blocks',
      limit: 50
    })) as { rows: unknown[]; truncated: boolean }
    expect(JSON.stringify(res.rows).length).toBeLessThanOrEqual(70_000)
    expect(res.truncated).toBe(true)
  })
})

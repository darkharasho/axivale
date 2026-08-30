import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadAxilog } from './axilogNative'
import {
  handle,
  annotateQueryEntities,
  redactReportPaths,
  QUERY_ENTITY_NOTE
} from './axilogWorker'
import { EntityIndex, type AxilogReport } from './axilogEntities'

const index = new EntityIndex([
  {
    id: '12',
    name: 'Anon133',
    account: 'anon.1234',
    profession: 'Scourge',
    role: 'squad',
    subgroup: 1
  },
  {
    id: '37',
    name: 'Anon201',
    account: 'anon.5678',
    profession: 'Firebrand',
    role: 'squad',
    subgroup: 2
  }
])

// C1 guard, jq channel: jqEngine.run() runs against the WHOLE report, which
// carries `axilog.generated_from` — the absolute path parseFile was handed. A
// model probing with `keys` or `.axilog` would get it straight back, so it is
// reduced to a basename at load, before any filter can see it.
describe('redactReportPaths', () => {
  it('reduces generated_from to a basename so a jq probe cannot read the path', () => {
    const posix = {
      axilog: {
        schema: 's',
        version: '1',
        generated_from: '/home/realuser/Documents/Guild Wars 2/logs/20260830-211432.zevtc'
      }
    } as never
    expect(redactReportPaths(posix).axilog.generated_from).toBe('20260830-211432.zevtc')

    const win = {
      axilog: {
        schema: 's',
        version: '1',
        generated_from: 'C:\\Users\\realname\\Documents\\logs\\20260830-211432.zevtc'
      }
    } as never
    expect(redactReportPaths(win).axilog.generated_from).toBe('20260830-211432.zevtc')
  })

  it('leaves a report with no axilog header alone rather than throwing', () => {
    expect(() => redactReportPaths({} as never)).not.toThrow()
    expect(() => redactReportPaths({ axilog: {} } as never)).not.toThrow()
  })
})

describe('annotateQueryEntities', () => {
  it('resolves numeric-string object keys anywhere in an arbitrarily shaped result', () => {
    const rows = [{ '12': { strips: 88 } }, [{ nested: { '37': { strips: 61 } } }]]
    const ann = annotateQueryEntities(rows, index)!
    expect(ann.entities).toEqual({
      '12': { name: 'Anon133', role: 'squad' },
      '37': { name: 'Anon201', role: 'squad' }
    })
    expect(ann.unresolvedIds).toEqual([])
    expect(ann.note).toBe(QUERY_ENTITY_NOTE)
  })

  it('names an id with no roster match as unresolved rather than guessing a nearest match', () => {
    const ann = annotateQueryEntities([{ '999': { strips: 3 } }], index)!
    expect(ann.entities).toEqual({})
    expect(ann.unresolvedIds).toEqual(['999'])
  })

  it('returns null when the result carries no entity-id-shaped keys', () => {
    expect(annotateQueryEntities([{ map: 'Green Alpine Borderlands' }, [1, 2, 3]], index)).toBeNull()
  })

  it('does not treat array indices as entity ids', () => {
    expect(annotateQueryEntities([['a', 'b'], { markers: ['x'] }], index)).toBeNull()
  })
})

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

  it('reports both sides as elite specs in the overview composition', async () => {
    // Without this the enemy side was only reachable through a raw jq filter
    // over entities[].profession, which reports every spec as its base class.
    const overview = (await handle({
      id: 11,
      kind: 'overview',
      logId: 'fx',
      path: FIXTURE
    })) as { composition: Record<string, Record<string, number>> }
    expect(Object.keys(overview.composition.enemy_player)).toContain('Luminary')
    expect(Object.keys(overview.composition.squad)).toContain('Firebrand')
  })

  it('resolves by_entity ids in a jq result instead of handing the model bare ids', async () => {
    const res = (await handle({
      id: 4,
      kind: 'query',
      logId: 'fx',
      path: FIXTURE,
      filter: '.blocks.support.by_entity',
      limit: 50
    })) as {
      rows: unknown[]
      entities: Record<string, { name: string; role: string }>
      unresolvedIds: string[]
      note: string
    }
    const keys = Object.keys(res.rows[0] as Record<string, unknown>)
    expect(keys.length).toBeGreaterThan(0)
    expect(res.note).toBe(QUERY_ENTITY_NOTE)
    // Every id in the result is either named or explicitly unresolved.
    for (const k of keys) {
      expect(k in res.entities || res.unresolvedIds.includes(k), k).toBe(true)
    }
    expect(Object.keys(res.entities).length).toBeGreaterThan(0)
    // The name map counts against the cap, it is not appended after it.
    expect(JSON.stringify(res).length).toBeLessThanOrEqual(70_000)
  })

  it('hands a jq probe of .axilog no filesystem path', async () => {
    const res = (await handle({
      id: 5,
      kind: 'query',
      logId: 'fx-redact',
      path: FIXTURE,
      filter: '.axilog',
      limit: 50
    })) as { rows: unknown[] }
    expect(res.rows).toHaveLength(1)
    expect(JSON.stringify(res)).not.toMatch(/[/\\]/)
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

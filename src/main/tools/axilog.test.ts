import { describe, it, expect, vi } from 'vitest'
import { buildAxilogTools } from './axilog'
import { AxilogWatcher } from '../axilogWatcher'

function deps(overrides: Record<string, unknown> = {}) {
  const watcher = new AxilogWatcher({ dir: () => null, now: () => 0 })
  const entry = watcher.registerOpened('/logs/20260830-211432.zevtc')
  const service = {
    overview: vi.fn(async () => ({
      logId: entry.logId,
      map: 'Green Alpine Borderlands',
      durationMs: 49_285,
      recordedBy: 'Commander',
      roleCounts: { squad: 38, enemy_player: 60 },
      squad: [{ name: 'A', account: 'a.1234', profession: 'Scourge', subgroup: 1 }],
      coverage: { damage: 'present', minions: 'not_computed' },
      warnings: []
    })),
    section: vi.fn(async () => ({
      rows: [{ name: 'A', profession: 'Scourge', subgroup: 1, strips: 42 }],
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'strips', label: 'Strips' }
      ]
    })),
    query: vi.fn(async () => ({ rows: [1, 2], truncated: false })),
    ...overrides
  }
  return { entry, tools: buildAxilogTools(() => ({ watcher, service: service as never })), service }
}

const call = async (
  tools: ReturnType<typeof buildAxilogTools>,
  name: string,
  args: unknown
): Promise<{
  isError?: boolean
  content: Array<{ text: string }>
  display?: { kind: string; data: { rows: unknown[] } }
}> => {
  const t = tools.find((x) => x.name === name)!
  return t.handler(args as never, {} as never) as never
}

describe('axilog tools', () => {
  it('exposes exactly the five read-only tools', () => {
    const { tools } = deps()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'axilog_fight_overview',
      'axilog_logs_list',
      'axilog_query',
      'axilog_section',
      'axilog_sections_list'
    ])
  })

  it('lists logs from the filesystem without parsing', async () => {
    const { tools, service } = deps()
    const res = await call(tools, 'axilog_logs_list', { limit: 5 })
    expect(res.isError).toBeFalsy()
    expect(service.overview).not.toHaveBeenCalled()
    expect(JSON.parse(res.content[0].text).logs).toHaveLength(1)
  })

  it('never sends a filesystem path to the model in axilog_logs_list', async () => {
    const watcher = new AxilogWatcher({ dir: () => null, now: () => 0 })
    watcher.registerOpened('/home/realuser/Documents/Guild Wars 2/logs/20260830-211432.zevtc')
    const tools = buildAxilogTools(() => ({ watcher, service: null }))
    const res = await call(tools, 'axilog_logs_list', { limit: 5 })
    const serialized = res.content[0].text
    // A real guard, not a field allowlist: any path-like substring at all fails,
    // so a future field carrying a path cannot slip through.
    expect(serialized).not.toMatch(/[/\\]/)
    expect(serialized).not.toContain('realuser')
    const logs = JSON.parse(serialized).logs
    expect(logs).toHaveLength(1)
    expect(logs[0].logId).toEqual(expect.any(String))
    expect(logs[0].path).toBeUndefined()
  })

  it('never sends a filesystem path to the model in the parsing tools', async () => {
    const { tools, entry } = deps()
    for (const [name, args] of [
      ['axilog_fight_overview', { logId: entry.logId }],
      ['axilog_section', { logId: entry.logId, section: 'support' }],
      ['axilog_query', { logId: entry.logId, filter: '.encounter' }]
    ] as const) {
      const res = await call(tools, name, args)
      expect(res.isError, name).toBeFalsy()
      expect(res.content[0].text, name).not.toContain('/logs/')
      expect(res.content[0].text, name).not.toContain('.zevtc')
    }
  })
  it('returns coverage in the overview so the model can refuse honestly', async () => {
    const { tools, entry } = deps()
    const res = await call(tools, 'axilog_fight_overview', { logId: entry.logId })
    expect(JSON.parse(res.content[0].text).coverage.minions).toBe('not_computed')
  })

  it('attaches a table display payload to a section result', async () => {
    const { tools, entry } = deps()
    const res = await call(tools, 'axilog_section', { logId: entry.logId, section: 'support' })
    expect(res.display?.kind).toBe('table')
    expect(res.display?.data.rows).toHaveLength(1)
  })

  it('errors actionably on an unknown logId instead of throwing', async () => {
    const { tools } = deps()
    const res = await call(tools, 'axilog_fight_overview', { logId: 'deadbeef' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/unknown log/i)
  })

  it('reports the feature unavailable when the native module did not load', async () => {
    const watcher = new AxilogWatcher({ dir: () => null, now: () => 0 })
    const entry = watcher.registerOpened('/logs/20260830-211432.zevtc')
    const tools = buildAxilogTools(() => ({ watcher, service: null }))
    const res = await call(tools, 'axilog_fight_overview', { logId: entry.logId })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/not available/i)
  })

  it('lists logs even when the native module did not load — filesystem listing needs no parser', async () => {
    const watcher = new AxilogWatcher({ dir: () => null, now: () => 0 })
    watcher.registerOpened('/logs/20260830-211432.zevtc')
    const tools = buildAxilogTools(() => ({ watcher, service: null }))
    const res = await call(tools, 'axilog_logs_list', { limit: 5 })
    expect(res.isError).toBeFalsy()
    expect(JSON.parse(res.content[0].text).logs).toHaveLength(1)
  })

  it('lists sections even when the native module did not load — the catalog is static', async () => {
    const watcher = new AxilogWatcher({ dir: () => null, now: () => 0 })
    const tools = buildAxilogTools(() => ({ watcher, service: null }))
    const res = await call(tools, 'axilog_sections_list', {})
    expect(res.isError).toBeFalsy()
    expect(JSON.parse(res.content[0].text).sections.length).toBeGreaterThan(0)
  })

  it('flags a truncated jq result rather than presenting it as complete', async () => {
    const { tools, entry } = deps({ query: vi.fn(async () => ({ rows: [1], truncated: true })) })
    const res = await call(tools, 'axilog_query', { logId: entry.logId, filter: '.blocks' })
    expect(JSON.parse(res.content[0].text).truncated).toBe(true)
  })

  // I5 — the conversation record must store the refs it has touched, so
  // reopening the thread tomorrow still resolves the same fight.
  it('records a log ref the first time a tool touches that log', async () => {
    const watcher = new AxilogWatcher({ dir: () => null, now: () => 0 })
    const entry = watcher.registerOpened('/logs/20260830-211432.zevtc')
    const onLogUsed = vi.fn()
    const service = { overview: vi.fn(async () => ({ coverage: {} })) }
    const tools = buildAxilogTools(() => ({
      watcher,
      service: service as never,
      onLogUsed
    }))
    await call(tools, 'axilog_fight_overview', { logId: entry.logId })
    expect(onLogUsed).toHaveBeenCalledWith(entry)
  })

  it('says a since-deleted log file is gone rather than reporting it unknown', async () => {
    const watcher = new AxilogWatcher({ dir: () => null, now: () => 0 })
    watcher.rehydrate([
      { logId: 'abc12345', path: '/gone/20260830-211432.zevtc', label: 'World vs World 21:14' }
    ])
    const tools = buildAxilogTools(() => ({ watcher, service: {} as never }))
    const res = await call(tools, 'axilog_fight_overview', { logId: 'abc12345' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/no longer on disk/i)
    expect(res.content[0].text).toMatch(/World vs World 21:14/)
    // Still no filesystem path in what the model sees.
    expect(res.content[0].text).not.toContain('/gone/')
  })

  it('keeps the entity-id note from the worker alongside the truncation warning', async () => {
    const { tools, entry } = deps({
      query: vi.fn(async () => ({
        rows: [{ '12': { strips: 88 } }],
        truncated: true,
        entities: { '12': { name: 'Anon133', role: 'squad' } },
        unresolvedIds: [],
        note: 'ENTITY NOTE.'
      }))
    })
    const res = await call(tools, 'axilog_query', { logId: entry.logId, filter: '.blocks' })
    const parsed = JSON.parse(res.content[0].text)
    expect(parsed.note).toContain('ENTITY NOTE.')
    expect(parsed.note).toMatch(/truncated/i)
    expect(parsed.entities['12'].name).toBe('Anon133')
  })
})

import { describe, it, expect, vi } from 'vitest'
import { buildDiscordTools } from './discord'
import type { ToolDeps } from './shared'

interface Msg {
  id: string
  author_id: string
  author_name: string
  content: string
  created_at: string
  pinned: boolean
}

function msg(id: number, author: string, content: string, day: number): Msg {
  return {
    id: String(id),
    author_id: `a${author}`,
    author_name: author,
    content,
    created_at: `2026-06-${String(day).padStart(2, '0')}T12:00:00+00:00`,
    pinned: false
  }
}

/**
 * Fake client whose discordMessages serves a fixed newest-first corpus, honoring
 * the `before` (message id) and `limit` paging the tool drives it with.
 */
function makeDeps(corpus: Msg[]): { deps: ToolDeps; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = []
  const discordMessages = vi.fn(async (_guild: string, opts: Record<string, unknown>) => {
    calls.push(opts)
    let pool = corpus
    if (opts.before) {
      const cut = corpus.findIndex((m) => m.id === opts.before)
      pool = cut >= 0 ? corpus.slice(cut + 1) : corpus
    }
    const limit = (opts.limit as number) ?? 25
    return pool.slice(0, limit)
  })
  const deps = {
    axitools: { discordMessages } as never,
    gw2: {} as never,
    discordGuildId: () => '123',
    gw2GuildId: () => 'g1',
    axiforge: {} as never,
    axiforgeLauncher: { ensureRunning: async () => {} },
    axibridge: () => ({}) as never,
    loadSkill: () => null,
    metaIndex: () => ({}) as never,
    wikiIndex: () => ({}) as never,
    wikiFacts: { lookup: async () => ({ name: '', found: false, hasSplit: false, pve: [], wvw: [], pvp: [], recharge: { pve: null, wvw: null, pvp: null }, activation: { pve: null, wvw: null, pvp: null } }) }
  } satisfies ToolDeps
  return { deps, calls }
}

function search(deps: ToolDeps) {
  return buildDiscordTools(deps).find((t) => t.name === 'discord_search')!
}

function text(res: { content: unknown[] }): string {
  return (res.content[0] as { text: string }).text
}

describe('discord_search', () => {
  it('filters by case-insensitive substring across pages', async () => {
    const corpus = Array.from({ length: 150 }, (_, i) =>
      msg(1000 - i, 'logan', i % 50 === 0 ? 'the RESET plan' : 'chatter', 11)
    )
    const { deps, calls } = makeDeps(corpus)
    const res = await search(deps).handler(
      { channel_id: '11', query: 'reset' },
      {}
    )
    const out = JSON.parse(text(res))
    expect(out.matches.map((m: Msg) => m.id)).toEqual(['1000', '950', '900'])
    expect(out.scanned).toBe(150)
    expect(out.reachedCap).toBe(false)
    // paged: first call no before, later calls page by oldest id
    expect(calls[0].before).toBeUndefined()
    expect(calls[1].before).toBe('901')
  })

  it('filters by author (name or id)', async () => {
    const corpus = [
      msg(5, 'logan', 'hi', 11),
      msg(4, 'rytlock', 'ho', 11),
      msg(3, 'LOGAN', 'hey', 11)
    ]
    const { deps } = makeDeps(corpus)
    const byName = JSON.parse(text(await search(deps).handler({ channel_id: '11', author: 'logan' }, {})))
    expect(byName.matches.map((m: Msg) => m.id)).toEqual(['5', '3'])
    const byId = JSON.parse(text(await search(deps).handler({ channel_id: '11', author: 'arytlock' }, {})))
    expect(byId.matches.map((m: Msg) => m.id)).toEqual(['4'])
  })

  it('bounds matches by from/to ISO dates', async () => {
    const corpus = [msg(3, 'logan', 'a', 12), msg(2, 'logan', 'b', 10), msg(1, 'logan', 'c', 8)]
    const { deps } = makeDeps(corpus)
    const out = JSON.parse(
      text(await search(deps).handler({ channel_id: '11', from: '2026-06-09', to: '2026-06-11' }, {}))
    )
    expect(out.matches.map((m: Msg) => m.id)).toEqual(['2'])
  })

  it('surfaces the cap and oldest scanned timestamp', async () => {
    const corpus = Array.from({ length: 1200 }, (_, i) => msg(2000 - i, 'logan', 'no match here', 11))
    const { deps } = makeDeps(corpus)
    const out = JSON.parse(
      text(await search(deps).handler({ channel_id: '11', query: 'zzz', max_messages: 200 }, {}))
    )
    expect(out.matches).toEqual([])
    expect(out.scanned).toBe(200)
    expect(out.reachedCap).toBe(true)
    expect(out.oldestScannedAt).toBe('2026-06-11T12:00:00+00:00')
  })

  it('clamps max_messages to the 1000 hard cap', async () => {
    const corpus = Array.from({ length: 1100 }, (_, i) => msg(3000 - i, 'logan', 'x', 11))
    const { deps } = makeDeps(corpus)
    const out = JSON.parse(
      text(await search(deps).handler({ channel_id: '11', max_messages: 99999 }, {}))
    )
    expect(out.scanned).toBe(1000)
    expect(out.reachedCap).toBe(true)
  })
})

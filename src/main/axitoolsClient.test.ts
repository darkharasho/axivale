import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AxitoolsClient, AxitoolsError } from './axitoolsClient'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('AxitoolsClient', () => {
  let client: AxitoolsClient

  beforeEach(() => {
    mockFetch.mockReset()
    client = new AxitoolsClient('http://127.0.0.1:8642', 'tok')
  })

  it('sends bearer auth and parses guild list', async () => {
    mockFetch.mockResolvedValue(jsonResponse([{ id: '123', name: 'Vigil Keep' }]))
    const guilds = await client.listGuilds()
    expect(guilds).toEqual([{ id: '123', name: 'Vigil Keep' }])
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8642/guilds')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('creates a build via POST', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ build_id: 'abc', name: 'FB' }, 201))
    const build = await client.createBuild('123', { name: 'FB', profession: 'Guardian', chat_code: '[&x]' })
    expect(build.build_id).toBe('abc')
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8642/guilds/123/builds')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ name: 'FB', profession: 'Guardian', chat_code: '[&x]' })
  })

  it('encodes preset names in URLs', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ name: 'Tuesday WvW Raid', config: {} }))
    await client.putCompPreset('123', { name: 'Tuesday WvW Raid', config: {} })
    expect(mockFetch.mock.calls[0][0]).toBe(
      'http://127.0.0.1:8642/guilds/123/comp-presets/Tuesday%20WvW%20Raid'
    )
  })

  it('returns undefined for 204 responses', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(client.deleteBuild('123', 'abc')).resolves.toBeUndefined()
  })

  it('fetches the discord overview, optionally with members', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ guild: { id: 123 }, channels: [] }))
    await client.discordOverview('123')
    expect(mockFetch.mock.calls[0][0]).toBe('http://127.0.0.1:8642/guilds/123/discord')
    await client.discordOverview('123', true)
    expect(mockFetch.mock.calls[1][0]).toBe('http://127.0.0.1:8642/guilds/123/discord?include=members')
  })

  it('fetches channel messages with a limit (options object)', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]))
    await client.discordMessages('123', { channelId: '555', limit: 50 })
    expect(mockFetch.mock.calls[0][0]).toBe(
      'http://127.0.0.1:8642/guilds/123/discord/messages?channel_id=555&limit=50'
    )
  })

  it('builds thread + before/after query params, omitting empties', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]))
    await client.discordMessages('123', {
      threadId: '777',
      before: '101',
      after: '2026-06-01'
    })
    const url = new URL(mockFetch.mock.calls[0][0] as string)
    expect(url.pathname).toBe('/guilds/123/discord/messages')
    expect(url.searchParams.get('thread_id')).toBe('777')
    expect(url.searchParams.get('before')).toBe('101')
    expect(url.searchParams.get('after')).toBe('2026-06-01')
    expect(url.searchParams.has('channel_id')).toBe(false)
    expect(url.searchParams.has('limit')).toBe(false)
  })

  it('posts discord actions', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true, result: { id: '9' } }))
    const res = await client.discordAction('123', 'message_send', { channel_id: '555', content: 'hi' })
    expect(res).toEqual({ ok: true, result: { id: '9' } })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8642/guilds/123/discord/actions')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      action: 'message_send',
      params: { channel_id: '555', content: 'hi' }
    })
  })

  it('queries audit logs with filters', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]))
    await client.auditDiscord('123', { event_type: 'member_join', limit: 100 })
    expect(mockFetch.mock.calls[0][0]).toBe(
      'http://127.0.0.1:8642/guilds/123/audit/discord?event_type=member_join&limit=100'
    )
    await client.auditGw2('123', { user: 'Riversong.2837' })
    expect(mockFetch.mock.calls[1][0]).toBe(
      'http://127.0.0.1:8642/guilds/123/audit/gw2?user=Riversong.2837'
    )
  })

  it('manages rss feeds', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ name: 'news', url: 'https://x', channel_id: '5' }))
    await client.rssSet('123', 'news', { url: 'https://x', channel_id: '5' })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8642/guilds/123/rss/news')
    expect(init.method).toBe('PUT')
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }))
    await client.rssDelete('123', 'news')
    expect(mockFetch.mock.calls[1][1].method).toBe('DELETE')
  })

  it('manages streams and alliance', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]))
    await client.streamsList('123')
    expect(mockFetch.mock.calls[0][0]).toBe('http://127.0.0.1:8642/guilds/123/streams')
    mockFetch.mockResolvedValue(jsonResponse({ relink_enabled: true }))
    await client.allianceSet('123', { relink_enabled: true })
    const [url, init] = mockFetch.mock.calls[1]
    expect(url).toBe('http://127.0.0.1:8642/guilds/123/alliance')
    expect(init.method).toBe('PUT')
  })

  it('fetches linked members and patches config', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]))
    await client.membersLinked('123')
    expect(mockFetch.mock.calls[0][0]).toBe('http://127.0.0.1:8642/guilds/123/members-linked')
    mockFetch.mockResolvedValue(jsonResponse({}))
    await client.configPatch('123', { audit_channel_id: '9' })
    expect(mockFetch.mock.calls[1][1].method).toBe('PATCH')
  })

  it('throws AxitoolsError with API message on failure', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'build not found' }, 404))
    await expect(client.deleteBuild('123', 'zzz')).rejects.toThrow('build not found')
  })

  it('throws a connection error when the bot is down', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'))
    await expect(client.listGuilds()).rejects.toThrow(AxitoolsError)
    await expect(client.listGuilds()).rejects.toThrow(/AxiTools bot.*reachable/i)
  })
})

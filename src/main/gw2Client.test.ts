import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Gw2Client, Gw2Error } from './gw2Client'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('Gw2Client', () => {
  let client: Gw2Client

  beforeEach(() => {
    mockFetch.mockReset()
    client = new Gw2Client('TEST-KEY')
  })

  it('validates the key via tokeninfo + account', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: 'x', name: 'officer', permissions: ['account', 'guilds'] }))
      .mockResolvedValueOnce(jsonResponse({ name: 'Darkharasho.4621', guilds: ['G-1'], guild_leader: ['G-1'] }))
    const info = await client.accountInfo()
    expect(info.accountName).toBe('Darkharasho.4621')
    expect(info.permissions).toContain('guilds')
    expect(info.missingPermissions).toEqual([])
    expect(info.guilds).toEqual(['G-1'])
    expect(info.guildLeader).toEqual(['G-1'])
    const firstUrl = mockFetch.mock.calls[0][0] as string
    expect(firstUrl).toBe('https://api.guildwars2.com/v2/tokeninfo')
    const init = mockFetch.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TEST-KEY')
    expect(mockFetch.mock.calls[1][0]).toBe('https://api.guildwars2.com/v2/account')
  })

  it('reports missing permissions', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: 'x', name: 'k', permissions: ['account'] }))
      .mockResolvedValueOnce(jsonResponse({ name: 'A.1', guilds: [] }))
    const info = await client.accountInfo()
    expect(info.missingPermissions).toEqual(['guilds'])
  })

  it('fetches guild members', async () => {
    mockFetch.mockResolvedValue(jsonResponse([{ name: 'Riversong.2837', rank: 'Recruit', joined: '2026-06-09T00:00:00Z' }]))
    const members = await client.guildMembers('G-1')
    expect(members[0].name).toBe('Riversong.2837')
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.guildwars2.com/v2/guild/G-1/members')
  })

  it('passes since to the guild log endpoint', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]))
    await client.guildLog('G-1', 42)
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.guildwars2.com/v2/guild/G-1/log?since=42')
  })

  it('surfaces API error text', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ text: 'Invalid access token' }, 401))
    await expect(client.guildMembers('G-1')).rejects.toThrow('Invalid access token')
  })

  it('surfaces rate limiting', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 429 }))
    await expect(client.guildMembers('G-1')).rejects.toThrow(Gw2Error)
    mockFetch.mockResolvedValue(new Response('', { status: 429 }))
    await expect(client.guildMembers('G-1')).rejects.toThrow(/rate limit/i)
  })
})

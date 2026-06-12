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
    mockFetch.mockResolvedValue(jsonResponse([{ id: 123, name: 'Vigil Keep' }]))
    const guilds = await client.listGuilds()
    expect(guilds).toEqual([{ id: 123, name: 'Vigil Keep' }])
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8642/guilds')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('creates a build via POST', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ build_id: 'abc', name: 'FB' }, 201))
    const build = await client.createBuild(123, { name: 'FB', profession: 'Guardian', chat_code: '[&x]' })
    expect(build.build_id).toBe('abc')
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8642/guilds/123/builds')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ name: 'FB', profession: 'Guardian', chat_code: '[&x]' })
  })

  it('encodes preset names in URLs', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ name: 'Tuesday WvW Raid', config: {} }))
    await client.putCompPreset(123, { name: 'Tuesday WvW Raid', config: {} })
    expect(mockFetch.mock.calls[0][0]).toBe(
      'http://127.0.0.1:8642/guilds/123/comp-presets/Tuesday%20WvW%20Raid'
    )
  })

  it('returns undefined for 204 responses', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(client.deleteBuild(123, 'abc')).resolves.toBeUndefined()
  })

  it('throws AxitoolsError with API message on failure', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'build not found' }, 404))
    await expect(client.deleteBuild(123, 'zzz')).rejects.toThrow('build not found')
  })

  it('throws a connection error when the bot is down', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'))
    await expect(client.listGuilds()).rejects.toThrow(AxitoolsError)
    await expect(client.listGuilds()).rejects.toThrow(/AxiTools bot.*reachable/i)
  })
})

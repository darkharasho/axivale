import { describe, it, expect, vi } from 'vitest'
import { Gw2ApiClient } from '@axiapps/gw2-data'
import { fetchEntityDetail } from './gw2Detail'

// Regression: a bare endpoint ('skills') produced the URL
// `https://api.guildwars2.comskills?...` (ENOTFOUND). The endpoint must be `/v2/skills`.
describe('fetchEntityDetail', () => {
  it('hits the real GW2 /v2/skills URL via Gw2ApiClient (no host concatenation)', async () => {
    const fetchSpy = vi.fn(async (_url: string) => ({
      ok: true,
      status: 200,
      json: async () => [{ id: 30966, name: 'Coalescence of Ruin', description: 'd', facts: [] }]
    }))
    const client = new Gw2ApiClient({ fetch: fetchSpy as unknown as typeof fetch })

    const detail = await fetchEntityDetail(client, 'skills', 30966)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const url = String(fetchSpy.mock.calls[0][0])
    expect(url).toContain('https://api.guildwars2.com/v2/skills?ids=30966')
    expect(url).not.toContain('comskills')
    expect(detail).toMatchObject({ description: 'd', facts: [] })
  })

  it('uses /v2/traits for traits', async () => {
    const fetchSpy = vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => [{ id: 1, name: 'T' }] }))
    const client = new Gw2ApiClient({ fetch: fetchSpy as unknown as typeof fetch })

    await fetchEntityDetail(client, 'traits', 1)

    expect(String(fetchSpy.mock.calls[0][0])).toContain('https://api.guildwars2.com/v2/traits?ids=1')
  })

  it('returns null when the API yields no row', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }))
    const client = new Gw2ApiClient({ fetch: fetchSpy as unknown as typeof fetch })

    expect(await fetchEntityDetail(client, 'skills', 999999)).toBeNull()
  })
})

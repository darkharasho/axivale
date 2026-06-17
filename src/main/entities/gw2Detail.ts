import type { Gw2ApiEntity, Gw2Fact } from '@axiapps/gw2-data'

/** Minimal surface of @axiapps/gw2-data's Gw2ApiClient that we depend on. */
export interface Gw2DetailClient {
  fetchByIds(endpoint: string, ids: number[]): Promise<Gw2ApiEntity[]>
}

export interface EntityDetail {
  description?: string
  icon?: string
  facts?: Gw2Fact[]
}

/**
 * Fetch one skill/trait's full object (description + facts + icon) from the GW2 API.
 *
 * Gw2ApiClient builds its URL as `${apiRoot}${endpoint}` with apiRoot
 * `https://api.guildwars2.com` (no `/v2`), so the endpoint MUST be the full
 * path `/v2/skills` — passing the bare `skills` yields `…comskills`.
 */
export async function fetchEntityDetail(
  client: Gw2DetailClient,
  endpoint: 'skills' | 'traits',
  id: number
): Promise<EntityDetail | null> {
  const results = await client.fetchByIds(`/v2/${endpoint}`, [id])
  return results[0] ?? null
}

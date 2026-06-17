declare module '@axiapps/gw2-data' {
  export class WikiClient {
    constructor(opts?: unknown)
    getWikitext(title: string): Promise<string | null>
    getWikitextBatch(titles: string[]): Promise<Map<string, string | null>>
    prefixSearch(prefix: string, limit?: number): Promise<string[]>
  }
  export function parseFactsByMode(wikitext: string): unknown
  export function stripWikiMarkup(wikitext: string): string
  export class Gw2ApiClient {
    constructor(opts?: { cache?: unknown; fetch?: typeof fetch; apiRoot?: string; lang?: string })
    fetchByIds(endpoint: string, ids: number[], lang?: string): Promise<Gw2ApiEntity[]>
  }
  export interface Gw2ApiEntity { id: number; name?: string; description?: string; icon?: string; chat_link?: string; facts?: Gw2Fact[] }
  export interface Gw2Fact { type?: string; text?: string; icon?: string; value?: number; duration?: number; status?: string; description?: string; apply_count?: number; dmg_multiplier?: number; hit_count?: number; distance?: number; percent?: number; field_type?: string; finisher_type?: string; target?: string; source?: string; [k: string]: unknown }
  export function normalizeFactType(type: string): string
  export function stripGw2Markup(text: string): string
}

declare module '@axiapps/gw2-data/wiki' {
  export class WikiClient {
    constructor(opts?: unknown)
    getWikitext(title: string): Promise<string | null>
    getWikitextBatch(titles: string[]): Promise<Map<string, string | null>>
    prefixSearch(prefix: string, limit?: number): Promise<string[]>
  }
}

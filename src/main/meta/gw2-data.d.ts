declare module '@axiapps/gw2-data' {
  export class WikiClient {
    constructor(opts?: unknown)
    getWikitext(title: string): Promise<string | null>
    getWikitextBatch(titles: string[]): Promise<Map<string, string | null>>
    prefixSearch(prefix: string, limit?: number): Promise<string[]>
  }
  export function parseFactsByMode(wikitext: string): unknown
  export function stripWikiMarkup(wikitext: string): string
}

declare module '@axiapps/gw2-data/wiki' {
  export class WikiClient {
    constructor(opts?: unknown)
    getWikitext(title: string): Promise<string | null>
    getWikitextBatch(titles: string[]): Promise<Map<string, string | null>>
    prefixSearch(prefix: string, limit?: number): Promise<string[]>
  }
}

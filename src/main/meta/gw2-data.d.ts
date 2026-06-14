declare module '@axiapps/gw2-data' {
  export class WikiClient {
    constructor(opts?: unknown)
    getWikitext(title: string): Promise<string | null>
    prefixSearch(prefix: string, limit?: number): Promise<string[]>
  }
  export function parseFactsByMode(wikitext: string): unknown
}

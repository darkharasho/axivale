// src/main/meta/cache.ts
//
// Disk cache of cleaned raw source excerpts, keyed by URL hash. One JSON file
// per source under userData/meta-cache/. Atomic tmp+rename, corrupt-tolerant.
// The distiller reads these; the panel never shows them.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'

export interface RawCache {
  put(url: string, text: string): void
  get(url: string): string | null
}

interface Entry {
  url: string
  text: string
  at: string
}

export class MetaCache implements RawCache {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
  }

  private path(url: string): string {
    return join(this.dir, createHash('sha1').update(url).digest('hex') + '.json')
  }

  put(url: string, text: string): void {
    const target = this.path(url)
    const tmp = `${target}.tmp`
    const body: Entry = { url, text, at: new Date().toISOString() }
    writeFileSync(tmp, JSON.stringify(body), { mode: 0o600 })
    renameSync(tmp, target)
  }

  get(url: string): string | null {
    const target = this.path(url)
    if (!existsSync(target)) return null
    try {
      return (JSON.parse(readFileSync(target, 'utf8')) as Entry).text
    } catch {
      return null
    }
  }
}

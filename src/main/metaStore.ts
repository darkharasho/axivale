// src/main/metaStore.ts
//
// Owns userData/meta.json — per-game-mode meta source references + notes used to
// bias build/comp advice. Mirrors skillStore.ts (atomic tmp+rename, debounced,
// corrupt-safe). Seeds canonical sources on first run / corrupt file.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'

export interface MetaSource {
  label: string
  url: string
}
export interface MetaMode {
  id: string
  mode: string
  sources: MetaSource[]
  notes: string
  updatedAt: string
}

export type MetaModeSeed = Pick<MetaMode, 'mode' | 'sources'> & Partial<Pick<MetaMode, 'notes'>>

interface FileShape {
  modes: MetaMode[]
}

const DEBOUNCE_MS = 300

const DEFAULT_SEED: Array<Pick<MetaMode, 'mode' | 'sources'>> = [
  { mode: 'PvE', sources: [{ label: 'Snowcrows', url: 'https://snowcrows.com' }] },
  {
    mode: 'WvW',
    sources: [
      { label: 'MetaBattle (WvW)', url: 'https://metabattle.com/wiki/Category:WvW_Zerg_Builds' },
      { label: 'gw2mists', url: 'https://gw2mists.com' },
      { label: 'Hardstuck', url: 'https://hardstuck.gg' }
    ]
  },
  {
    mode: 'WvW Roaming',
    sources: [
      { label: 'MetaBattle (Roaming)', url: 'https://metabattle.com/wiki/Category:WvW_Roaming_Builds' },
      { label: 'GuildJen', url: 'https://guildjen.com' },
      { label: 'Hardstuck', url: 'https://hardstuck.gg' }
    ]
  }
]

export class MetaStore {
  private state: FileShape
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly path: string) {
    this.state = this.read()
    if (this.state.modes.length === 0) {
      this.state = { modes: DEFAULT_SEED.map((s) => this.makeMode(s)) }
      this.flush()
    }
  }

  private makeMode(seed: Pick<MetaMode, 'mode' | 'sources'> & { notes?: string }): MetaMode {
    return {
      id: randomUUID(),
      mode: seed.mode,
      sources: seed.sources,
      notes: seed.notes ?? '',
      updatedAt: new Date().toISOString()
    }
  }

  private read(): FileShape {
    if (!existsSync(this.path)) return { modes: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<FileShape>
      return { modes: Array.isArray(parsed.modes) ? parsed.modes : [] }
    } catch {
      return { modes: [] }
    }
  }

  private scheduleWrite(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 })
    renameSync(tmp, this.path)
  }

  list(): MetaMode[] {
    return [...this.state.modes]
  }

  get(id: string): MetaMode | null {
    return this.state.modes.find((m) => m.id === id) ?? null
  }

  addMode(seed: MetaModeSeed): MetaMode {
    const mode = this.makeMode(seed)
    this.state.modes.push(mode)
    this.scheduleWrite()
    return mode
  }

  updateMode(id: string, patch: Partial<MetaModeSeed>): MetaMode | null {
    const mode = this.get(id)
    if (!mode) return null
    if (patch.mode !== undefined) mode.mode = patch.mode
    if (patch.sources !== undefined) mode.sources = patch.sources
    if (patch.notes !== undefined) mode.notes = patch.notes
    mode.updatedAt = new Date().toISOString()
    this.scheduleWrite()
    return mode
  }

  removeMode(id: string): void {
    this.state.modes = this.state.modes.filter((m) => m.id !== id)
    this.scheduleWrite()
  }
}

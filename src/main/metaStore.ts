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
  status: 'ok' | 'error' | 'never'
  fetchedAt: string | null
  error: string | null
}
export interface MetaMode {
  id: string
  mode: string
  sources: MetaSource[]
  notes: string
  refreshedAt: string | null
  updatedAt: string
}

type SeedShape = { mode: string; sources: Array<{ label: string; url: string }>; notes?: string }

export type MetaModeSeed = SeedShape

interface FileShape {
  modes: MetaMode[]
}

const DEBOUNCE_MS = 300

const DEFAULT_SEED: SeedShape[] = [
  {
    mode: 'PvE',
    sources: [
      { label: 'Snowcrows (Raids)', url: 'https://snowcrows.com/builds/raids' },
      { label: 'Snowcrows (Fractals)', url: 'https://snowcrows.com/builds/raids/fractals' },
      { label: 'Snowcrows (Strikes)', url: 'https://snowcrows.com/builds/raids/strikes' },
      { label: 'MetaBattle (Raids)', url: 'https://metabattle.com/wiki/Raid_Builds' }
    ]
  },
  {
    mode: 'WvW',
    sources: [
      { label: 'MetaBattle (WvW)', url: 'https://metabattle.com/wiki/WvW' },
      { label: 'Snowcrows (WvW)', url: 'https://snowcrows.com/builds/wvw' },
      { label: 'gw2mists (Zerg)', url: 'https://gw2mists.com/en/builds?mode=zerg' }
    ]
  },
  {
    mode: 'WvW Roaming',
    sources: [
      { label: 'MetaBattle (Roaming)', url: 'https://metabattle.com/wiki/WvW_Roaming' },
      { label: 'GuildJen (Roaming)', url: 'https://guildjen.com/gw2-wvw-builds/' }
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
    } else if (this.reconcile()) {
      this.flush()
    }
  }

  /** Sync each mode's sources to the seed (authoritative): drop sources no longer in
   *  the seed, add new ones, update labels, and preserve provenance for survivors. */
  private reconcile(): boolean {
    let changed = false
    for (const seed of DEFAULT_SEED) {
      const existing = this.state.modes.find((m) => m.mode === seed.mode)
      if (!existing) {
        this.state.modes.push(this.makeMode(seed))
        changed = true
        continue
      }
      const synced: MetaSource[] = seed.sources.map((s) => {
        const prev = existing.sources.find((p) => p.url === s.url)
        return prev
          ? { ...prev, label: s.label }
          : { label: s.label, url: s.url, status: 'never', fetchedAt: null, error: null }
      })
      if (JSON.stringify(existing.sources) !== JSON.stringify(synced)) {
        existing.sources = synced
        changed = true
      }
    }
    return changed
  }

  private makeMode(seed: SeedShape): MetaMode {
    return {
      id: randomUUID(),
      mode: seed.mode,
      sources: seed.sources.map((s) => ({
        label: s.label,
        url: s.url,
        status: 'never' as const,
        fetchedAt: null,
        error: null
      })),
      notes: seed.notes ?? '',
      refreshedAt: null,
      updatedAt: new Date().toISOString()
    }
  }

  private read(): FileShape {
    if (!existsSync(this.path)) return { modes: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<FileShape>
      const modes = Array.isArray(parsed.modes) ? parsed.modes : []
      return { modes: modes.map((m) => this.normalize(m)) }
    } catch {
      return { modes: [] }
    }
  }

  private normalize(m: MetaMode): MetaMode {
    return {
      ...m,
      refreshedAt: m.refreshedAt ?? null,
      sources: (m.sources ?? []).map((s) => ({
        label: s.label,
        url: s.url,
        status: s.status ?? 'never',
        fetchedAt: s.fetchedAt ?? null,
        error: s.error ?? null
      }))
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
    if (patch.sources !== undefined)
      mode.sources = patch.sources.map((s) => {
        const prev = mode.sources.find((p) => p.url === s.url)
        return {
          label: s.label,
          url: s.url,
          status: prev?.status ?? 'never',
          fetchedAt: prev?.fetchedAt ?? null,
          error: prev?.error ?? null
        }
      })
    if (patch.notes !== undefined) mode.notes = patch.notes
    mode.updatedAt = new Date().toISOString()
    this.scheduleWrite()
    return mode
  }

  recordFetch(modeId: string, url: string, result: { ok: true } | { ok: false; error: string }): void {
    const mode = this.get(modeId)
    if (!mode) return
    const src = mode.sources.find((s) => s.url === url)
    if (!src) return
    src.status = result.ok ? 'ok' : 'error'
    src.error = result.ok ? null : result.error
    src.fetchedAt = new Date().toISOString()
    mode.updatedAt = new Date().toISOString()
    this.scheduleWrite()
  }

  recordDistill(modeId: string, notes: string): void {
    const mode = this.get(modeId)
    if (!mode) return
    mode.notes = notes
    mode.refreshedAt = new Date().toISOString()
    mode.updatedAt = new Date().toISOString()
    this.scheduleWrite()
  }

  /** Mark every mode stale so the next refresh re-crawls them (dev/manual force). */
  markAllStale(): void {
    for (const m of this.state.modes) m.refreshedAt = null
    this.scheduleWrite()
  }

  removeMode(id: string): void {
    this.state.modes = this.state.modes.filter((m) => m.id !== id)
    this.scheduleWrite()
  }
}

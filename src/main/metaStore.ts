// src/main/metaStore.ts
//
// Owns userData/meta.json — per-game-mode meta source references + notes used to
// bias build/comp advice. Mirrors skillStore.ts (atomic tmp+rename, debounced,
// corrupt-safe). Seeds canonical sources on first run / corrupt file.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'
import type { DerivedComp } from './meta/compDerive'

export interface MetaSource {
  label: string
  url: string
  group: 'meta' | 'wiki' | 'general'
  status: 'ok' | 'error' | 'never'
  fetchedAt: string | null
  error: string | null
  /** The source's own declared publish/modified date (YYYY-MM-DD), distinct from
   *  fetchedAt (when AxiVale crawled it). null when the page declares none. */
  sourceDate: string | null
}

export interface Playbook {
  derived: DerivedComp | null
  derivedAt: string | null
  principles: string
  overrides: string
  blessed: boolean
}

export interface MetaMode {
  id: string
  mode: string
  sources: MetaSource[]
  notes: string
  playbook: Playbook
  refreshedAt: string | null
  updatedAt: string
}

type SeedShape = {
  mode: string
  sources: Array<{ label: string; url: string; group?: 'meta' | 'wiki' | 'general' }>
  notes?: string
  playbook?: { principles?: string; blessed?: boolean }
}

export type MetaModeSeed = SeedShape

interface FileShape {
  modes: MetaMode[]
}

const DEBOUNCE_MS = 300

// Standalone principles so the scrub migration can backfill each into stored
// playbooks that predate it (detected via the marker noted on each below).
// marker: 'melee-driven'
const MELEE_PRINCIPLE =
  '- The meta is melee-driven: spike comes from the melee train. Builds with a real ranged spike (e.g. spear Evoker) are rare standouts — treat ranged backline as a small accent, not the backbone of the comp.'
// marker: 'Down Contribution'
const DOWN_CONTRIBUTION_PRINCIPLE =
  '- In WvW, DPS is NOT the primary damage stat: Down Contribution is #1 (it is what turns pressure into kills), total damage is #2 behind it, and raw DPS is a distant tiebreaker — judge a build or player by the downs they create, not parsed DPS.'

// Order matters: backfilled into existing playbooks in this same order, before
// the iteration-heavy closer.
const BACKFILL_PRINCIPLES = [MELEE_PRINCIPLE, DOWN_CONTRIBUTION_PRINCIPLE]

const WVW_PRINCIPLES = `### WvW comp principles
- ~2 stability supports per subgroup is normal (not wasteful).
- At least 1 cleanse support per subgroup is required.
- Normal comp = reliable boon-rip + reliable burst, at ~2:1 boon-rip:burst DPS (up to 3:1 by damage rate).
- Outlier-stacking: when a build is a broken outlier, stacking it can BE the comp (all-Untamed, Soulbeast stacks).
${MELEE_PRINCIPLE}
${DOWN_CONTRIBUTION_PRINCIPLE}
- The meta is iteration-heavy — treat any comp as a baseline to refine, not gospel.`

const DEFAULT_SEED: SeedShape[] = [
  {
    mode: 'PvE',
    sources: [
      { label: 'Snowcrows (Raids)', url: 'https://snowcrows.com/builds/raids' },
      { label: 'Snowcrows (Open World)', url: 'https://snowcrows.com/builds/open-world' },
      { label: 'MetaBattle (Raids)', url: 'https://metabattle.com/wiki/Raid_Builds' },
      { label: 'MetaBattle (Fractal)', url: 'https://metabattle.com/wiki/Fractal' },
      { label: 'MetaBattle (Open World)', url: 'https://metabattle.com/wiki/Open_World' }
    ]
  },
  {
    mode: 'WvW',
    sources: [
      // Layer 3 — mechanics truth (wiki)
      { label: 'GW2 Wiki (Squad)', url: 'https://wiki.guildwars2.com/wiki/Squad', group: 'wiki' },
      { label: 'GW2 Wiki (Boon)', url: 'https://wiki.guildwars2.com/wiki/Boon', group: 'wiki' },
      // Layer 1 — composition rules (WvW guides)
      { label: 'Snowcrows (WvW Roles)', url: 'https://snowcrows.com/guides/wvw/wvw-basics-understanding-roles' },
      { label: 'Guild Order (WvW Squad Leadership)', url: 'https://guildorder.com/games/gw2/guides/wvw-squad-leadership' },
      // Layer 2 — role-tagged builds
      { label: 'MetaBattle (WvW)', url: 'https://metabattle.com/wiki/WvW' },
      { label: 'Snowcrows (WvW)', url: 'https://snowcrows.com/builds/wvw' },
      { label: 'Snowcrows (WvW DPS tier list)', url: 'https://snowcrows.com/news/wvw' },
      { label: 'gw2mists (Zerg)', url: 'https://gw2mists.com/en/builds?mode=zerg' }
    ],
    playbook: { principles: WVW_PRINCIPLES, blessed: true }
  },
  {
    mode: 'WvW Roaming',
    sources: [
      { label: 'MetaBattle (Roaming)', url: 'https://metabattle.com/wiki/WvW_Roaming' },
      { label: 'GuildJen (Roaming)', url: 'https://guildjen.com/gw2-wvw-builds/' }
    ]
  }
  ,{
    mode: 'Guides',
    sources: [
      { label: 'Snowcrows (Guides)', url: 'https://snowcrows.com/guides', group: 'general' },
      { label: 'GuildJen (Guides)', url: 'https://guildjen.com/category/guides/', group: 'general' },
      { label: 'Hardstuck (Guides)', url: 'https://hardstuck.gg/gw2/guides/', group: 'general' },
      // Discretize moved its content to archive.discretize.eu (the next.* subdomain
      // no longer resolves); archive.discretize.eu matches the discretize.eu config.
      { label: 'Discretize (Fractals)', url: 'https://archive.discretize.eu/fractals', group: 'general' },
      { label: 'Discretize (Guides)', url: 'https://archive.discretize.eu/guides', group: 'general' }
    ]
  }
]

/** Migrate stored WvW principles to the current baseline: strip any legacy
 *  attribution (e.g. "(per <name>, top comp-maker)") so the agent never
 *  name-drops a source, and backfill any newer baseline principle the stored
 *  copy predates. All steps are idempotent and only touch WvW principles. */
function scrubPlaybook(p: Playbook): Playbook {
  let principles = p.principles.replace(/^(### WvW comp principles)\s*\([^)]*\)/m, '$1')
  if (/^### WvW comp principles/m.test(principles)) {
    // Insert each missing principle just before the iteration-heavy closer
    // (or append if that closer was edited away), preserving seed order.
    for (const principle of BACKFILL_PRINCIPLES) {
      // Dedup on the principle's first clause — enough to detect an earlier copy
      // without requiring a verbatim match the user may have lightly edited.
      const marker = principle.slice(0, 40)
      if (principles.includes(marker)) continue
      const idx = principles.indexOf('- The meta is iteration-heavy')
      principles =
        idx >= 0
          ? `${principles.slice(0, idx)}${principle}\n${principles.slice(idx)}`
          : `${principles.replace(/\s*$/, '')}\n${principle}`
    }
  }
  return principles === p.principles ? p : { ...p, principles }
}

function defaultPlaybook(seed?: { principles?: string; blessed?: boolean }): Playbook {
  return {
    derived: null,
    derivedAt: null,
    principles: seed?.principles ?? '',
    overrides: '',
    blessed: seed?.blessed ?? false
  }
}

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
    // Note: reconcile syncs sources from the seed but never overwrites a mode's
    // playbook (user curation wins); seeded principles only apply to brand-new modes.
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
        const group = s.group ?? 'meta'
        return prev
          ? { ...prev, label: s.label, group }
          : { label: s.label, url: s.url, group, status: 'never', fetchedAt: null, error: null, sourceDate: null }
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
        group: s.group ?? 'meta',
        status: 'never' as const,
        fetchedAt: null,
        error: null,
        sourceDate: null
      })),
      notes: seed.notes ?? '',
      playbook: defaultPlaybook(seed.playbook),
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
      // Migrate the legacy 'General' guide mode to its new name 'Guides'.
      mode: m.mode === 'General' ? 'Guides' : m.mode,
      refreshedAt: m.refreshedAt ?? null,
      sources: (m.sources ?? []).map((s) => ({
        label: s.label,
        url: s.url,
        group: s.group ?? 'meta',
        status: s.status ?? 'never',
        fetchedAt: s.fetchedAt ?? null,
        error: s.error ?? null,
        sourceDate: s.sourceDate ?? null
      })),
      playbook: m.playbook ? scrubPlaybook({ ...defaultPlaybook(), ...m.playbook }) : defaultPlaybook()
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
          group: prev?.group ?? 'meta',
          status: prev?.status ?? 'never',
          fetchedAt: prev?.fetchedAt ?? null,
          error: prev?.error ?? null,
          sourceDate: prev?.sourceDate ?? null
        }
      })
    if (patch.notes !== undefined) mode.notes = patch.notes
    mode.updatedAt = new Date().toISOString()
    this.scheduleWrite()
    return mode
  }

  recordFetch(
    modeId: string,
    url: string,
    result: { ok: true; sourceDate?: string | null } | { ok: false; error: string }
  ): void {
    const mode = this.get(modeId)
    if (!mode) return
    const src = mode.sources.find((s) => s.url === url)
    if (!src) return
    src.status = result.ok ? 'ok' : 'error'
    src.error = result.ok ? null : result.error
    // A fresh successful crawl is authoritative for the source date: record what
    // this fetch found (or null if the page declares none). Leave it untouched on error.
    if (result.ok) src.sourceDate = result.sourceDate ?? null
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

  recordDerivedComp(modeId: string, derived: DerivedComp): void {
    const mode = this.get(modeId)
    if (!mode) return
    mode.playbook.derived = structuredClone(derived)
    mode.playbook.derivedAt = new Date().toISOString()
    mode.updatedAt = new Date().toISOString()
    this.scheduleWrite()
  }

  updatePlaybook(modeId: string, patch: Partial<Pick<Playbook, 'principles' | 'overrides' | 'blessed'>>): void {
    const mode = this.get(modeId)
    if (!mode) return
    if (patch.principles !== undefined) mode.playbook.principles = patch.principles
    if (patch.overrides !== undefined) mode.playbook.overrides = patch.overrides
    if (patch.blessed !== undefined) mode.playbook.blessed = patch.blessed
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

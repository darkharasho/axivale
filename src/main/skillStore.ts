// src/main/skillStore.ts
//
// Owns userData/skills.json — user-authored prompt recipes. Mirrors
// ConversationStore/ShareStore: atomic tmp+rename, debounced, path-injected for
// tests, corrupt-file safe (never throws).

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'

export interface Skill {
  id: string
  name: string
  whenToUse: string
  instructions: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type SkillSeed = Pick<Skill, 'name' | 'whenToUse' | 'instructions'> &
  Partial<Pick<Skill, 'enabled'>>

interface FileShape {
  skills: Skill[]
  /** Stable keys of DEFAULT_SEED entries already applied — lets a user delete a
   *  default permanently (no resurrection on relaunch) while a brand-new default
   *  shipped in a later version still lands once. */
  seeded: string[]
}

/** A default skill shipped with the app. `key` is a stable identity (independent of
 *  the editable name) used to track which seeds have already been applied. */
type DefaultSkill = SkillSeed & { key: string }

const DEBOUNCE_MS = 300

const DEFAULT_SEED: DefaultSkill[] = [
  {
    key: 'wvw-report',
    name: 'WvW Report',
    whenToUse:
      'recapping how a WvW raid/night went — "how did we do tonight", performance review, squad report',
    instructions:
      'Produce a succinct, actionable WvW night report from real data only — never invent numbers, and name which run each figure came from.\n\n1. Find the night\'s run(s): call axibridge_runs_list and use the latest run (or the few from tonight). Pull headline numbers with axibridge_run_summary (add axibridge_commander_stats if a commander is in focus) and the per-player breakdown with axibridge_player_stats. If runs were skipped or partial, say so — never present partial data as complete.\n\n2. Know the intended builds: call axiforge_comps_list / axiforge_builds_list (and axiforge_builds_get for specifics) to see the guild\'s intended comp and which spec/build each role should run. Judge each player against what their build is FOR: a heal-alac build should post high cleanses/heals/stability; a strip build should top boon strips; a DPS build should drive down contribution. Flag mismatches — a support build with low support output, or someone on an off-meta build for their role.\n\n3. Headline (article title): one line — outcome + the single biggest takeaway. e.g. "Strong cleave, but stability gaps cost us two pushes."\n\n4. Lede: 2–3 sentences — fights count + date, K/D, attendance, overall squad health.\n\n5. One trend chart, inline: call axibridge_render_chart (or axibridge_compare) for the most telling metric across the night\'s fights or vs recent nights (e.g. down contribution or strips per fight). Introduce it, then put {{figure}} on its own line right after. (Charts go inline via {{figure}}; tool tables do not — never {{figure}} a tool\'s data table.)\n\n6. Write TWO short tables YOURSELF in markdown (you compose these — they render inline as cards), each ≤10 rows, top performers only, lead with "N of M players":\n   - Damage & pressure: player | spec | down contribution | deaths.\n   - Support: player | spec | strips | cleanses | healing | stability.\n   The full, unabridged per-player breakdown from axibridge_player_stats does NOT go in the article — it appears as a card in the Actions panel; mention that readers can open it there for the complete roster.\n\n7. Two tight bulleted sections (action-first):\n   - What went well — 2–4 bullets, metric + who ("Strips strong — 8.4k avg, led by X").\n   - What to improve — 2–4 bullets, each a concrete next step, including build/role mismatches ("Y on a heal build posted bottom-quartile cleanses — recheck their bar or swap their role").\n\n8. Close with the single highest-leverage fix for next week.\n\nKeep it tight: every claim tied to a tool number. Prioritize down contribution, strips, cleanses, healing, stability; kills/deaths and attendance for context.'
  },
  {
    key: 'wvw-trends',
    name: 'WvW Trends',
    whenToUse:
      'weekly WvW trend review — "how are we trending", week over week, progress over time, are we improving',
    instructions:
      'Produce a concise weekly WvW trend review — week-over-week, real data only, and name the date ranges.\n\n1. Scope: use axibridge_runs_list to bound this week\'s runs and last week\'s; pull aggregates with axibridge_run_summary / axibridge_compare across both ranges. Note any skipped or partial runs.\n\n2. Headline (article title): the one-line trajectory. e.g. "Up week — cleave and strips climbing, attendance slipping."\n\n3. Lede: 2–3 sentences — raids per week, K/D trend, attendance trend.\n\n4. Trend charts, inline (axibridge_render_chart or axibridge_compare). Introduce each in a sentence, then {{figure}} on its own line after:\n   - A multi-week line of 2–3 core metrics (down contribution, strips, cleanses).\n   - Attendance over the recent weeks.\n\n5. One table, ≤10 rows: metric | last week | this week | Δ — for the core metrics (down contribution, strips, cleanses, healing, stability, K/D, attendance). Put {{figure}} after the sentence introducing it.\n\n6. Two tight bullet sections (action-first):\n   - Improved — 2–4 bullets, each with the Δ and the likely cause.\n   - Regressed — 2–4 bullets, each with the Δ and a concrete fix.\n\n7. Close with the single focus for next week.\n\nEvery claim tied to a tool number. Metrics: down contribution, strips, cleanses, healing, stability, K/D, attendance.'
  },
  {
    key: 'commander-review',
    name: 'Commander Review',
    whenToUse:
      'reviewing a specific commander\'s recent WvW leadership — "how did <commander> do", commander performance/coaching',
    instructions:
      'Review one commander\'s recent WvW leadership — real data only; name the runs.\n\n1. Identify the commander from the request; if unspecified, use the most active recent commander (say which). Pull axibridge_commander_stats and the runs they led via axibridge_runs_list / axibridge_run_summary (add axibridge_player_stats for squad detail). Note skipped/partial runs.\n\n2. Headline (article title): a one-line verdict on their nights. e.g. "Aggressive tags, high kills — but squad downs spike late."\n\n3. Lede: 2–3 sentences — raids led, date range, overall K/D and squad health under them.\n\n4. One trend chart, inline (axibridge_render_chart): a key metric across their nights — e.g. squad down contribution or K/D per raid. Introduce it, then {{figure}} on its own line after.\n\n5. One table, ≤10 rows: their nights — date | fights | K/D | squad downs | a support metric (or, if more useful, top squad performers under them). Put {{figure}} after the sentence introducing it.\n\n6. Two tight bullet sections (coaching-focused, specific):\n   - Strengths — 2–4 bullets, each metric-backed.\n   - Coaching points — 2–4 bullets, each a concrete adjustment (comp, timing, positioning, target calling).\n\n7. Close with the one habit to double down on and the one to change.\n\nKeep it constructive and tied to numbers + specific runs.'
  }
]

export class SkillStore {
  private state: FileShape
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly path: string) {
    this.state = this.read()
    if (this.applySeeds()) this.flush()
  }

  private read(): FileShape {
    if (!existsSync(this.path)) return { skills: [], seeded: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<FileShape>
      return {
        skills: Array.isArray(parsed.skills) ? parsed.skills : [],
        seeded: Array.isArray(parsed.seeded) ? parsed.seeded : []
      }
    } catch {
      return { skills: [], seeded: [] }
    }
  }

  /** Apply any DEFAULT_SEED entry not yet recorded in `seeded`. A skill matching the
   *  seed's name already present (e.g. a hand-authored copy) is adopted, not duplicated.
   *  Returns true if anything changed. */
  private applySeeds(): boolean {
    const applied = new Set(this.state.seeded)
    let changed = false
    for (const seed of DEFAULT_SEED) {
      if (applied.has(seed.key)) continue
      if (!this.state.skills.some((s) => s.name === seed.name)) {
        const now = new Date().toISOString()
        this.state.skills.push({
          id: randomUUID(),
          name: seed.name,
          whenToUse: seed.whenToUse,
          instructions: seed.instructions,
          enabled: seed.enabled ?? true,
          createdAt: now,
          updatedAt: now
        })
      }
      applied.add(seed.key)
      changed = true
    }
    if (changed) this.state.seeded = [...applied]
    return changed
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

  list(): Skill[] {
    return [...this.state.skills].sort((a, b) => a.name.localeCompare(b.name))
  }

  get(id: string): Skill | null {
    return this.state.skills.find((s) => s.id === id) ?? null
  }

  /** First enabled skill with this exact name (skills are looked up only to be used). */
  getByName(name: string): Skill | null {
    return this.state.skills.find((s) => s.name === name && s.enabled) ?? null
  }

  create(seed: SkillSeed): Skill {
    const now = new Date().toISOString()
    const skill: Skill = {
      id: randomUUID(),
      name: seed.name,
      whenToUse: seed.whenToUse,
      instructions: seed.instructions,
      enabled: seed.enabled ?? true,
      createdAt: now,
      updatedAt: now
    }
    this.state.skills.push(skill)
    this.scheduleWrite()
    return skill
  }

  update(id: string, patch: Partial<SkillSeed>): Skill | null {
    const skill = this.get(id)
    if (!skill) return null
    if (patch.name !== undefined) skill.name = patch.name
    if (patch.whenToUse !== undefined) skill.whenToUse = patch.whenToUse
    if (patch.instructions !== undefined) skill.instructions = patch.instructions
    if (patch.enabled !== undefined) skill.enabled = patch.enabled
    skill.updatedAt = new Date().toISOString()
    this.scheduleWrite()
    return skill
  }

  remove(id: string): void {
    this.state.skills = this.state.skills.filter((s) => s.id !== id)
    this.scheduleWrite()
  }
}

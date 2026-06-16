// src/main/rosterStore.ts
//
// Owns userData/rosterAnnotations.json — local, user-maintained annotations that
// layer on top of the live AxiTools roster. Keyed by Discord member_id (the
// stable anchor on every linked member); holds a preferred nickname, alternate
// aliases, freeform notes, and quick tags so the agent can resolve loose name
// references ("Bob") to a real GW2 account. Mirrors SkillStore: atomic
// tmp+rename, debounced, path-injected for tests, corrupt-file safe (never throws).

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'

export interface RosterAnnotation {
  /** Discord member_id from AxiTools membersLinked — the join key. */
  memberId: string
  /** Preferred canonical short name for this person ('' = unset). */
  nickname: string
  /** Other ways people refer to them (IGN shorthands, old names, display names). */
  aliases: string[]
  /** Freeform context for the AI (role, playstyle, timezone, anything). */
  notes: string
  /** Optional quick labels (e.g. "commander", "core", "trial"). */
  tags: string[]
  createdAt: string
  updatedAt: string
}

export type RosterAnnotationPatch = Partial<
  Pick<RosterAnnotation, 'nickname' | 'aliases' | 'notes' | 'tags'>
>

interface FileShape {
  annotations: RosterAnnotation[]
}

const DEBOUNCE_MS = 300

/** An annotation carries no user-entered content — safe to drop instead of persist. */
function isEmpty(a: RosterAnnotation): boolean {
  return !a.nickname.trim() && a.aliases.length === 0 && !a.notes.trim() && a.tags.length === 0
}

function cleanList(xs: unknown): string[] {
  if (!Array.isArray(xs)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of xs) {
    const s = String(x).trim()
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase())
      out.push(s)
    }
  }
  return out
}

export class RosterStore {
  private state: FileShape
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly path: string) {
    this.state = this.read()
  }

  private read(): FileShape {
    if (!existsSync(this.path)) return { annotations: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<FileShape>
      const annotations = Array.isArray(parsed.annotations) ? parsed.annotations : []
      // Normalize each record so callers never see missing fields from older files.
      return {
        annotations: annotations
          .filter((a): a is RosterAnnotation => Boolean(a && typeof a.memberId === 'string'))
          .map((a) => ({
            memberId: a.memberId,
            nickname: typeof a.nickname === 'string' ? a.nickname : '',
            aliases: cleanList(a.aliases),
            notes: typeof a.notes === 'string' ? a.notes : '',
            tags: cleanList(a.tags),
            createdAt: a.createdAt ?? new Date().toISOString(),
            updatedAt: a.updatedAt ?? new Date().toISOString()
          }))
      }
    } catch {
      return { annotations: [] }
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

  list(): RosterAnnotation[] {
    return this.state.annotations.map((a) => ({ ...a, aliases: [...a.aliases], tags: [...a.tags] }))
  }

  get(memberId: string): RosterAnnotation | null {
    const a = this.state.annotations.find((x) => x.memberId === memberId)
    return a ? { ...a, aliases: [...a.aliases], tags: [...a.tags] } : null
  }

  /** Create or update the annotation for a member. If the result has no content,
   *  the record is removed instead of stored (clearing every field deletes it). */
  upsert(memberId: string, patch: RosterAnnotationPatch): RosterAnnotation | null {
    const now = new Date().toISOString()
    let rec = this.state.annotations.find((x) => x.memberId === memberId)
    if (!rec) {
      rec = { memberId, nickname: '', aliases: [], notes: '', tags: [], createdAt: now, updatedAt: now }
      this.state.annotations.push(rec)
    }
    if (patch.nickname !== undefined) rec.nickname = patch.nickname.trim()
    if (patch.aliases !== undefined) rec.aliases = cleanList(patch.aliases)
    if (patch.notes !== undefined) rec.notes = patch.notes
    if (patch.tags !== undefined) rec.tags = cleanList(patch.tags)
    rec.updatedAt = now

    if (isEmpty(rec)) {
      this.remove(memberId)
      return null
    }
    this.scheduleWrite()
    return { ...rec, aliases: [...rec.aliases], tags: [...rec.tags] }
  }

  remove(memberId: string): void {
    this.state.annotations = this.state.annotations.filter((x) => x.memberId !== memberId)
    this.scheduleWrite()
  }
}

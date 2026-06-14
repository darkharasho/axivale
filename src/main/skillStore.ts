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
}

const DEBOUNCE_MS = 300

export class SkillStore {
  private state: FileShape
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly path: string) {
    this.state = this.read()
  }

  private read(): FileShape {
    if (!existsSync(this.path)) return { skills: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<FileShape>
      return { skills: Array.isArray(parsed.skills) ? parsed.skills : [] }
    } catch {
      return { skills: [] }
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

  list(): Skill[] {
    return [...this.state.skills].sort((a, b) => a.name.localeCompare(b.name))
  }

  get(id: string): Skill | null {
    return this.state.skills.find((s) => s.id === id) ?? null
  }

  getByName(name: string): Skill | null {
    return this.state.skills.find((s) => s.name === name) ?? null
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

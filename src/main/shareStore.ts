// src/main/shareStore.ts
//
// Owns userData/shares.json — the local registry of shares this user created,
// so the UI can list and delete them. Mirrors ConversationStore: atomic
// tmp+rename writes, debounced, path-injected for tests, corrupt-file safe.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import type { ShareKind } from './shareTypes'

export interface ShareEntry {
  id: string
  kind: ShareKind
  title: string
  url: string
  sourceConversationId: string
  createdAt: string
}

interface FileShape {
  shares: ShareEntry[]
}

const DEBOUNCE_MS = 300

export class ShareStore {
  private state: FileShape
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly path: string) {
    this.state = this.read()
  }

  private read(): FileShape {
    if (!existsSync(this.path)) return { shares: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<FileShape>
      return { shares: Array.isArray(parsed.shares) ? parsed.shares : [] }
    } catch {
      return { shares: [] }
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

  list(): ShareEntry[] {
    return [...this.state.shares].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  get(id: string): ShareEntry | null {
    return this.state.shares.find((s) => s.id === id) ?? null
  }

  add(entry: ShareEntry): void {
    this.state.shares.push(entry)
    this.scheduleWrite()
  }

  remove(id: string): void {
    this.state.shares = this.state.shares.filter((s) => s.id !== id)
    this.scheduleWrite()
  }
}

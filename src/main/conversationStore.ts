import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'
import type { ProviderName, SessionState, Turn } from './providers/types'

/** A raw log this conversation has discussed. Kept so reopening the thread still
 *  resolves the same fight; a since-deleted file shows as unavailable, never
 *  silently vanishes. */
export interface ConversationLogRef {
  logId: string
  path: string
  label: string
}

export interface Conversation {
  id: string
  title: string | null
  createdAt: string
  updatedAt: string
  turns: Turn[]
  provider: ProviderName
  session: SessionState
  seenTurnCount: number
  logRefs?: ConversationLogRef[]
}

interface FileShape {
  conversations: Conversation[]
  activeId: string | null
}

/** Fields a caller may seed into a new conversation. */
export type ConversationSeed = Partial<
  Pick<Conversation, 'title' | 'turns' | 'provider' | 'session' | 'seenTurnCount'>
>

const DEBOUNCE_MS = 300

/**
 * Owns userData/conversations.json. Mirrors SettingsStore's path-injection so
 * it is unit-testable against a temp file. Writes are atomic (tmp + rename)
 * and debounced; flush() forces a synchronous write. A corrupt or missing
 * file yields an empty list — never throws.
 */
export class ConversationStore {
  private state: FileShape
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly path: string) {
    this.state = this.read()
  }

  private read(): FileShape {
    if (!existsSync(this.path)) return { conversations: [], activeId: null }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<FileShape>
      return {
        conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
        activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null
      }
    } catch {
      return { conversations: [], activeId: null }
    }
  }

  private scheduleWrite(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS)
  }

  /** Force the pending write to disk now (atomic tmp + rename). */
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

  list(): Conversation[] {
    return [...this.state.conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  get(id: string): Conversation | null {
    return this.state.conversations.find((c) => c.id === id) ?? null
  }

  create(seed: ConversationSeed = {}): Conversation {
    const now = new Date().toISOString()
    const conv: Conversation = {
      id: randomUUID(),
      title: seed.title ?? null,
      createdAt: now,
      updatedAt: now,
      turns: seed.turns ?? [],
      provider: seed.provider ?? 'claude',
      session: seed.session ?? {},
      seenTurnCount: seed.seenTurnCount ?? 0
    }
    this.state.conversations.push(conv)
    this.scheduleWrite()
    return conv
  }

  saveTurns(id: string, turns: Turn[]): void {
    const conv = this.get(id)
    if (!conv) return
    conv.turns = turns
    conv.updatedAt = new Date().toISOString()
    this.scheduleWrite()
  }

  saveSession(id: string, provider: ProviderName, session: SessionState): void {
    const conv = this.get(id)
    if (!conv) return
    conv.provider = provider
    conv.session = session
    this.scheduleWrite()
  }

  rename(id: string, title: string | null): void {
    const conv = this.get(id)
    if (!conv) return
    conv.title = title
    conv.updatedAt = new Date().toISOString()
    this.scheduleWrite()
  }

  remove(id: string): void {
    this.state.conversations = this.state.conversations.filter((c) => c.id !== id)
    if (this.state.activeId === id) this.state.activeId = null
    this.scheduleWrite()
  }

  setActive(id: string): void {
    this.state.activeId = id
    this.scheduleWrite()
  }

  getActiveId(): string | null {
    return this.state.activeId
  }

  markSeen(id: string, count: number): void {
    const conv = this.get(id)
    if (!conv) return
    conv.seenTurnCount = count
    this.scheduleWrite()
  }

  addLogRef(id: string, ref: ConversationLogRef): void {
    const conv = this.get(id)
    if (!conv) return
    const refs = conv.logRefs ?? []
    if (refs.some((r) => r.logId === ref.logId)) return
    conv.logRefs = [...refs, ref]
    this.scheduleWrite()
  }
}

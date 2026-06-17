//
// Durable officer memory: facts (one-liners) + artifacts (operational know-how).
// Records live in userData/memory.json (authoritative); the LanceDB table is a
// derived recall/dedup index. See docs/superpowers/specs/2026-06-16-memory-sources-design.md.

export type ArtifactKind = 'playbook' | 'anti_pattern' | 'heuristic'
export type MemoryKind = 'fact' | ArtifactKind
export type MemorySource = 'agent' | 'user'

export interface MemoryFact {
  id: string
  body: string
  bodyNorm: string
  /** Roster identity key the fact is about, or null for a global/guild fact. */
  entity: string | null
  tags: string[]
  /** Effective pin (userPinned OR top-score auto-pin) — what gets injected. */
  pinned: boolean
  /** Sticky user intent; auto-pin can never clear this. */
  userPinned: boolean
  useCount: number
  score: number
  source: MemorySource
  createdAt: string
  lastUsedAt: string | null
  archived: boolean
}

export interface MemoryArtifact {
  id: string
  kind: ArtifactKind
  title: string
  body: string
  bodyNorm: string
  tags: string[]
  entity: string | null
  useCount: number
  score: number
  source: MemorySource
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
  archived: boolean
}

export interface RecalledFact {
  id: string
  body: string
  entity: string | null
  entityName?: string
  tags: string[]
  source: MemorySource
  learnedAt: string
  lastUsedAt: string | null
  timesUsed: number
}

export interface RecalledArtifact {
  id: string
  kind: ArtifactKind
  title: string
  body: string
  tags: string[]
  source: MemorySource
  updatedAt: string
  lastUsedAt: string | null
  timesUsed: number
}

export interface MemoryRecallResult {
  facts: RecalledFact[]
  artifacts: RecalledArtifact[]
}

//
// Pure scoring for memory rerank. score = base(source/pin) * recencyDecay *
// (1 + 0.25*log1p(useCount)). Recency uses lastUsedAt, falling back to createdAt.

import type { MemoryFact, MemoryArtifact } from './types'

export const HALF_LIFE_MS = 21 * 86_400_000
export const ARCHIVE_AFTER_MS = 180 * 86_400_000
export const FACT_PIN_BUDGET = 40
export const FACT_DUP_COSINE = 0.9
export const ARTIFACT_DUP_COSINE = 0.85

const USER_PIN_BASE = 1_000_000
const USER_BASE = 2
const AGENT_BASE = 1
const USE_WEIGHT = 0.25

function recency(lastUsedAt: string | null, createdAt: string, now: number): number {
  const ref = lastUsedAt ?? createdAt
  const t = Date.parse(ref)
  if (Number.isNaN(t)) return 1
  return Math.pow(2, -Math.max(0, now - t) / HALF_LIFE_MS)
}

export function factScore(f: MemoryFact, now: number): number {
  const base = f.userPinned ? USER_PIN_BASE : f.source === 'user' ? USER_BASE : AGENT_BASE
  return base * recency(f.lastUsedAt, f.createdAt, now) * (1 + USE_WEIGHT * Math.log1p(f.useCount))
}

export function artifactScore(a: MemoryArtifact, now: number): number {
  const base = a.source === 'user' ? USER_BASE : AGENT_BASE
  return base * recency(a.lastUsedAt, a.updatedAt, now) * (1 + USE_WEIGHT * Math.log1p(a.useCount))
}

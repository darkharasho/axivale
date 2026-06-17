// src/main/memoryPrompt.ts
//
// Builds the per-turn "What AxiVale remembers" block: the pinned durable facts,
// injected into the system prompt for cloud providers (mirrors metaPrompt.ts).
// Returns '' (no leading separator) when there is nothing pinned — zero overhead.

import type { MemoryFact } from './memory/types'

const MAX_CHARS = 4000

export function buildMemoryReference(facts: MemoryFact[]): string {
  if (facts.length === 0) return ''
  const lines: string[] = []
  let used = 0
  for (const f of facts) {
    const line = `- ${f.body}`
    if (used + line.length > MAX_CHARS) break
    lines.push(line)
    used += line.length + 1
  }
  if (lines.length === 0) return ''
  return (
    `\n\n# What AxiVale remembers\n` +
    `Durable facts learned across past sessions. Treat as standing context; when a ` +
    `task concerns a specific person or resembles past work, also call recall for detail.\n` +
    lines.join('\n')
  )
}

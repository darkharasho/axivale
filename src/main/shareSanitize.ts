// src/main/shareSanitize.ts
//
// Pure: turns a stored Conversation into a redacted ShareDoc. The only place
// the redaction rule lives — keep tool NAMES and visible display cards, drop
// raw tool `input` and `resultText` (they can carry API keys, guild ids, etc.).

import type { Conversation } from './conversationStore'
import type { Turn } from './providers/types'
import type { ShareDoc, SharedTurn } from './shareTypes'

export interface BuildShareOptions {
  id: string
  createdAt: string
  appVersion: string
  /** When set, share only this turn as a standalone kind:"response". */
  turnId?: number
}

/** First non-empty line, with a leading markdown heading/bullet marker removed. */
export function deriveTitle(text: string): string {
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/^\s*(#{1,6}|[-*])\s*/, '').trim()
    if (line) return line
  }
  return ''
}

function sanitizeTurn(turn: Turn, includeUser: boolean): SharedTurn {
  return {
    ...(includeUser ? { userText: turn.userText } : {}),
    agentText: turn.agentText,
    filedAt: turn.filedAt,
    tools: turn.tools
      .filter((t) => !t.isError)
      .map((t) => ({ name: t.name, ...(t.display ? { display: t.display } : {}) }))
  }
}

export function buildSharePayload(conv: Conversation, opts: BuildShareOptions): ShareDoc {
  const base = {
    v: 1 as const,
    id: opts.id,
    createdAt: opts.createdAt,
    app: { name: 'AxiVale', version: opts.appVersion }
  }

  if (opts.turnId !== undefined) {
    const target = conv.turns.find((t) => t.id === opts.turnId)
    if (!target) throw new Error('Response not found in conversation.')
    return {
      ...base,
      kind: 'response',
      title: deriveTitle(target.agentText) || 'AxiVale dispatch',
      turns: [sanitizeTurn(target, false)]
    }
  }

  const turns = conv.turns.filter((t) => t.done && !t.error)
  return {
    ...base,
    kind: 'conversation',
    title: conv.title?.trim() || deriveTitle(turns[0]?.userText ?? '') || 'AxiVale dispatch',
    turns: turns.map((t) => sanitizeTurn(t, true))
  }
}

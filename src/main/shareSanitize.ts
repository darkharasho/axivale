// src/main/shareSanitize.ts
//
// Pure: turns a stored Conversation into a redacted ShareDoc. The only place
// the redaction rule lives — keep tool NAMES and visible display cards, drop
// raw tool `input` and `resultText` (they can carry API keys, guild ids, etc.).

import type { Conversation } from './conversationStore'
import type { Turn } from './providers/types'
import type { ShareDoc, SharedTurn, ShareEntity } from './shareTypes'

export interface BuildShareOptions {
  id: string
  createdAt: string
  appVersion: string
  /** When set, share only this turn as a standalone kind:"response". */
  turnId?: number
  /** Full entity dictionary; only entries referenced by `[[…]]` markers in the
   *  shared turns are baked into the doc so the offline viewer can render them. */
  dictionary?: ShareEntity[]
}

const ENTITY_MARKER = /\[\[(?:skill|trait|item):([^\]]+)\]\]/g

/** The dictionary subset referenced by `[[type:Name]]` markers across the turns.
 *  Keyed by name (the viewer's resolver is name-keyed), so type is ignored here. */
function referencedEntities(turns: SharedTurn[], dictionary: ShareEntity[]): ShareEntity[] {
  if (dictionary.length === 0) return []
  const names = new Set<string>()
  for (const t of turns) {
    ENTITY_MARKER.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = ENTITY_MARKER.exec(t.agentText)) !== null) names.add(m[1].trim())
  }
  return names.size === 0 ? [] : dictionary.filter((e) => names.has(e.name))
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

  const dictionary = opts.dictionary ?? []

  if (opts.turnId !== undefined) {
    const target = conv.turns.find((t) => t.id === opts.turnId)
    if (!target) throw new Error('Response not found in conversation.')
    const turns = [sanitizeTurn(target, false)]
    const entities = referencedEntities(turns, dictionary)
    return {
      ...base,
      kind: 'response',
      title: deriveTitle(target.agentText) || 'AxiVale dispatch',
      turns,
      ...(entities.length ? { entities } : {})
    }
  }

  const turns = conv.turns.filter((t) => t.done && !t.error).map((t) => sanitizeTurn(t, true))
  const entities = referencedEntities(turns, dictionary)
  return {
    ...base,
    kind: 'conversation',
    title: conv.title?.trim() || deriveTitle(turns[0]?.userText ?? '') || 'AxiVale dispatch',
    turns,
    ...(entities.length ? { entities } : {})
  }
}

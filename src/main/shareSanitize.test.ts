// src/main/shareSanitize.test.ts
import { describe, it, expect } from 'vitest'
import { buildSharePayload, deriveTitle } from './shareSanitize'
import type { Conversation } from './conversationStore'
import type { Turn } from './providers/types'

function turn(over: Partial<Turn> = {}): Turn {
  return {
    id: 1,
    userText: 'how many members?',
    agentText: '# Roster Report\n\nWe have 42 members.',
    tools: [
      {
        id: 't1',
        name: 'gw2_guild_members',
        input: { guildId: 'SECRET-GUILD', apiKey: 'SECRET' },
        resultText: '{"raw":"sensitive payload"}',
        display: { kind: 'table', data: { columns: [{ key: 'n', label: 'Name' }], rows: [] } }
      }
    ],
    done: true,
    error: null,
    filedAt: '3:45 PM',
    ...over
  }
}

function conv(over: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1',
    title: null,
    createdAt: '2026-06-13T00:00:00Z',
    updatedAt: '2026-06-13T00:00:00Z',
    turns: [turn()],
    provider: 'claude',
    session: {},
    seenTurnCount: 0,
    ...over
  }
}

const OPTS = { id: 'abc', createdAt: '2026-06-13T01:00:00Z', appVersion: '0.3.2' }

describe('buildSharePayload — conversation', () => {
  it('strips raw tool input and resultText but keeps name + display', () => {
    const doc = buildSharePayload(conv(), OPTS)
    expect(doc.kind).toBe('conversation')
    const tool = doc.turns[0].tools[0]
    expect(tool.name).toBe('gw2_guild_members')
    expect(tool.display).toBeDefined()
    expect(JSON.stringify(doc)).not.toContain('SECRET')
    expect(JSON.stringify(doc)).not.toContain('sensitive payload')
  })

  it('includes userText and copies stable metadata', () => {
    const doc = buildSharePayload(conv(), OPTS)
    expect(doc.turns[0].userText).toBe('how many members?')
    expect(doc).toMatchObject({ v: 1, id: 'abc', createdAt: '2026-06-13T01:00:00Z' })
    expect(doc.app).toEqual({ name: 'AxiVale', version: '0.3.2' })
  })

  it('uses conversation.title when set, else derives from first user line', () => {
    expect(buildSharePayload(conv({ title: 'My Title' }), OPTS).title).toBe('My Title')
    expect(buildSharePayload(conv(), OPTS).title).toBe('how many members?')
  })

  it('omits unfinished or errored turns', () => {
    const c = conv({ turns: [turn({ id: 1 }), turn({ id: 2, done: false }), turn({ id: 3, error: 'boom' })] })
    expect(buildSharePayload(c, OPTS).turns).toHaveLength(1)
  })

  it('drops errored tools', () => {
    const c = conv({ turns: [turn({ tools: [{ id: 'e', name: 'bad', input: {}, isError: true }] })] })
    expect(buildSharePayload(c, OPTS).turns[0].tools).toHaveLength(0)
  })
})

describe('buildSharePayload — response', () => {
  it('returns only the target turn, without userText', () => {
    const c = conv({ turns: [turn({ id: 1 }), turn({ id: 2, agentText: '# Second\n\nbody' })] })
    const doc = buildSharePayload(c, { ...OPTS, turnId: 2 })
    expect(doc.kind).toBe('response')
    expect(doc.turns).toHaveLength(1)
    expect(doc.turns[0].userText).toBeUndefined()
    expect(doc.title).toBe('Second')
  })

  it('throws when the turn id is missing', () => {
    expect(() => buildSharePayload(conv(), { ...OPTS, turnId: 999 })).toThrow(/not found/i)
  })
})

describe('buildSharePayload — entity dictionary baking', () => {
  const DICT = [
    { name: 'Disrupting Stab', type: 'skill' as const, icon: 'https://r/stab.png' },
    { name: 'Winds of Disenchantment', type: 'skill' as const, icon: 'https://r/winds.png' },
    { name: 'Scholar', type: 'item' as const, icon: 'https://r/scholar.png' }
  ]

  it('bakes only the entities referenced by [[…]] markers in the turns', () => {
    const c = conv({ turns: [turn({ agentText: 'Use [[skill:Disrupting Stab]] on cooldown.' })] })
    const doc = buildSharePayload(c, { ...OPTS, dictionary: DICT })
    expect(doc.entities).toEqual([{ name: 'Disrupting Stab', type: 'skill', icon: 'https://r/stab.png' }])
  })

  it('omits the entities field entirely when no markers are present', () => {
    const doc = buildSharePayload(conv(), { ...OPTS, dictionary: DICT })
    expect(doc.entities).toBeUndefined()
  })

  it('omits entities when a marker has no dictionary match', () => {
    const c = conv({ turns: [turn({ agentText: 'Use [[skill:Unknown Skill]].' })] })
    expect(buildSharePayload(c, { ...OPTS, dictionary: DICT }).entities).toBeUndefined()
  })

  it('bakes referenced entities for a single-response share too', () => {
    const c = conv({ turns: [turn({ id: 2, agentText: '[[item:Scholar]] runes win.' })] })
    const doc = buildSharePayload(c, { ...OPTS, turnId: 2, dictionary: DICT })
    expect(doc.entities).toEqual([{ name: 'Scholar', type: 'item', icon: 'https://r/scholar.png' }])
  })
})

describe('deriveTitle', () => {
  it('strips leading markdown heading/bullet markers and takes the first non-empty line', () => {
    expect(deriveTitle('## Hello\n\nworld')).toBe('Hello')
    expect(deriveTitle('\n\n* bullet')).toBe('bullet')
    expect(deriveTitle('   ')).toBe('')
  })
})

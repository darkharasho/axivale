import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ConversationStore, type Conversation } from './conversationStore'
import type { Turn } from './providers/types'

function makePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'axivale-conv-'))
  return join(dir, 'conversations.json')
}

function turn(id: number, userText: string, agentText = '', done = true): Turn {
  return { id, userText, agentText, tools: [], done, error: null, filedAt: '12:00' }
}

describe('ConversationStore', () => {
  it('starts empty for a missing file', () => {
    const store = new ConversationStore(makePath())
    expect(store.list()).toEqual([])
    expect(store.getActiveId()).toBeNull()
  })

  it('creates a conversation with defaults and returns it', () => {
    const store = new ConversationStore(makePath())
    const conv = store.create()
    expect(conv.id).toBeTruthy()
    expect(conv.title).toBeNull()
    expect(conv.turns).toEqual([])
    expect(conv.provider).toBe('claude')
    expect(conv.session).toEqual({})
    expect(conv.seenTurnCount).toBe(0)
    expect(store.list()).toHaveLength(1)
    expect(store.get(conv.id)).toMatchObject({ id: conv.id })
  })

  it('honours a seed on create', () => {
    const store = new ConversationStore(makePath())
    const conv = store.create({ provider: 'openai', turns: [turn(1, 'hi')] })
    expect(conv.provider).toBe('openai')
    expect(conv.turns).toHaveLength(1)
  })

  it('saves turns and bumps updatedAt', () => {
    const store = new ConversationStore(makePath())
    const conv = store.create()
    const before = store.get(conv.id)!.updatedAt
    store.saveTurns(conv.id, [turn(1, 'hello', 'hi there')])
    const after = store.get(conv.id)!
    expect(after.turns).toHaveLength(1)
    expect(after.updatedAt >= before).toBe(true)
  })

  it('saves a provider session', () => {
    const store = new ConversationStore(makePath())
    const conv = store.create()
    store.saveSession(conv.id, 'claude', { claudeSessionId: 'sess-1' })
    expect(store.get(conv.id)!.session).toEqual({ claudeSessionId: 'sess-1' })
    expect(store.get(conv.id)!.provider).toBe('claude')
  })

  it('renames and removes', () => {
    const store = new ConversationStore(makePath())
    const a = store.create()
    const b = store.create()
    store.rename(a.id, 'Weekly muster')
    expect(store.get(a.id)!.title).toBe('Weekly muster')
    store.remove(b.id)
    expect(store.list().map((c) => c.id)).toEqual([a.id])
  })

  it('tracks the active id and markSeen', () => {
    const store = new ConversationStore(makePath())
    const a = store.create()
    store.setActive(a.id)
    expect(store.getActiveId()).toBe(a.id)
    store.markSeen(a.id, 3)
    expect(store.get(a.id)!.seenTurnCount).toBe(3)
  })

  it('persists across instances after flush', () => {
    const path = makePath()
    const s1 = new ConversationStore(path)
    const conv = s1.create({ turns: [turn(1, 'q', 'a')] })
    s1.rename(conv.id, 'Filed')
    s1.setActive(conv.id)
    s1.flush()
    const s2 = new ConversationStore(path)
    expect(s2.list()).toHaveLength(1)
    expect(s2.get(conv.id)!.title).toBe('Filed')
    expect(s2.getActiveId()).toBe(conv.id)
  })

  it('debounces writes but flush forces them to disk', () => {
    const path = makePath()
    const store = new ConversationStore(path)
    store.create()
    // Debounced — nothing on disk yet.
    expect(existsSync(path)).toBe(false)
    store.flush()
    expect(existsSync(path)).toBe(true)
  })

  it('tolerates a corrupt file', () => {
    const path = makePath()
    writeFileSync(path, '{ this is not json')
    const store = new ConversationStore(path)
    expect(store.list()).toEqual([])
    // A subsequent write recreates a valid file.
    store.create()
    store.flush()
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    expect(Array.isArray(parsed.conversations)).toBe(true)
  })

  it('list() returns newest-updated first', () => {
    const store = new ConversationStore(makePath())
    const a = store.create()
    const b = store.create()
    store.saveTurns(a.id, [turn(1, 'newer')])
    expect(store.list()[0].id).toBe(a.id)
    expect(store.list()[1].id).toBe(b.id)
  })

  it('persists log refs on a conversation and survives a reload', () => {
    const path = makePath()
    const store = new ConversationStore(path)
    const convo = store.create({ title: 'Fight review' })
    store.addLogRef(convo.id, { logId: 'abc12345', path: '/logs/20260830-211432.zevtc', label: 'WvW 21:14' })
    store.flush()

    const reloaded = new ConversationStore(path)
    expect(reloaded.get(convo.id)!.logRefs).toEqual([
      { logId: 'abc12345', path: '/logs/20260830-211432.zevtc', label: 'WvW 21:14' }
    ])
  })

  it('does not duplicate a log ref added twice', () => {
    const store = new ConversationStore(makePath())
    const convo = store.create({ title: 'x' })
    const ref = { logId: 'abc12345', path: '/logs/a.zevtc', label: 'a' }
    store.addLogRef(convo.id, ref)
    store.addLogRef(convo.id, ref)
    expect(store.get(convo.id)!.logRefs).toHaveLength(1)
  })
})

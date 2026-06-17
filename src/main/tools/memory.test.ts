// src/main/tools/memory.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore } from '../memoryStore'
import { FakeMemoryIndex } from '../memory/index'
import { MemoryService } from '../memory/service'
import { buildMemoryTools } from './memory'
import type { ToolDeps } from './shared'

function deps(over: Partial<ToolDeps> = {}): { deps: ToolDeps; service: MemoryService } {
  const store = new MemoryStore(join(mkdtempSync(join(tmpdir(), 'mem-')), 'memory.json'))
  const service = new MemoryService(store, new FakeMemoryIndex(), { entityName: (k) => (k === '111' ? 'Zara' : undefined) })
  const d = {
    memory: () => service,
    resolveEntityKey: async (name: string) => (name.toLowerCase().includes('zara') ? { key: '111', name: 'Zara' } : null)
  } as unknown as ToolDeps
  return { deps: { ...d, ...over }, service }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = async (t: { handler: (a: any, e: unknown) => Promise<any> }, args: unknown) =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  JSON.parse((await t.handler(args, {})).content[0].text as string)

describe('remember tool', () => {
  it('resolves a loose entity name and anchors the fact', async () => {
    const { deps: d, service } = deps()
    const tools = buildMemoryTools(d)
    const remember = tools.find((t) => t.name === 'remember')!
    const out = await call(remember, { kind: 'fact', body: 'prefers wvw', entity: 'zara' })
    expect(out.merged).toBe(false)
    expect(service.list().facts[0].entity).toBe('111')
  })

  it('stores entity:null and folds an unresolved name into tags', async () => {
    const { deps: d, service } = deps()
    const remember = buildMemoryTools(d).find((t) => t.name === 'remember')!
    await call(remember, { kind: 'fact', body: 'likes condi', entity: 'nobodyhere' })
    const f = service.list().facts[0]
    expect(f.entity).toBeNull()
    expect(f.tags).toContain('nobodyhere')
  })
})

describe('recall tool', () => {
  it('returns matching facts with provenance', async () => {
    const { deps: d } = deps()
    const tools = buildMemoryTools(d)
    await call(tools.find((t) => t.name === 'remember')!, { kind: 'fact', body: 'zara plays wvw small scale', entity: 'zara' })
    const out = await call(tools.find((t) => t.name === 'recall')!, { query: 'wvw', entity: 'zara' })
    expect(out.facts[0].body).toContain('wvw')
    expect(out.facts[0].entityName).toBe('Zara')
  })

  it('returns a note when nothing matches', async () => {
    const { deps: d } = deps()
    const recall = buildMemoryTools(d).find((t) => t.name === 'recall')!
    const out = await call(recall, { query: 'absolutely-nothing-here' })
    expect(out.note).toBe('no matching memory yet')
  })
})

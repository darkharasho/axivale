import { describe, it, expect } from 'vitest'
import { distillComp } from './distillComp'

describe('distillComp', () => {
  it('returns null for empty input without calling the model', async () => {
    let called = false
    const model = async (): Promise<string> => {
      called = true
      return 'x'
    }
    expect(await distillComp('WvW', [], model)).toBeNull()
    expect(called).toBe(false)
  })

  it('returns null when the model yields empty', async () => {
    const out = await distillComp('WvW', ['some rule text'], async () => '   ')
    expect(out).toBeNull()
  })

  it('sends a comp-rules prompt and returns the model output trimmed', async () => {
    let seen = ''
    const model = async (p: string): Promise<string> => {
      seen = p
      return '## Squad Composition\n- one Primary Support per subgroup\n'
    }
    const out = await distillComp('WvW', ['Primary Support provides Stability...'], model)
    expect(out).toContain('Squad Composition')
    expect(seen).toContain('## Squad Composition')
    expect(seen.toLowerCase()).toContain('subgroup')
    expect(seen.toLowerCase()).toContain('boon')
    expect(seen).toContain('Primary Support provides Stability')
  })

  it('filters whitespace-only entries and still distills real content', async () => {
    let seen = ''
    const model = async (p: string): Promise<string> => {
      seen = p
      return '## Squad Composition\n- rule'
    }
    const out = await distillComp('WvW', ['   ', 'real rule text'], model)
    expect(out).toContain('Squad Composition')
    expect(seen).toContain('real rule text')
    expect(seen).not.toContain('   \n\n---') // the blank entry was dropped, not joined
  })
})

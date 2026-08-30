import { describe, it, expect, beforeEach } from 'vitest'
import { loadAxilog, axilogUnavailableReason, __resetAxilogForTest } from './axilogNative'

describe('loadAxilog', () => {
  beforeEach(() => {
    __resetAxilogForTest()
  })

  it('returns a module exposing parseFile when the binary is present', () => {
    const native = loadAxilog()
    if (native === null) {
      // Acceptable on a platform with no prebuilt binary; the reason must say why.
      expect(axilogUnavailableReason()).toBeTruthy()
      return
    }
    expect(typeof native.parseFile).toBe('function')
    expect(axilogUnavailableReason()).toBeNull()
  })

  it('never throws, even when the require fails', () => {
    expect(() => loadAxilog()).not.toThrow()
  })

  it('degrades gracefully and reports a reason when the native require throws', () => {
    __resetAxilogForTest()
    const native = loadAxilog(() => {
      throw new Error('simulated missing binary: axilog.linux-x64-gnu.node not found')
    })
    expect(native).toBeNull()
    expect(axilogUnavailableReason()).toBe(
      'simulated missing binary: axilog.linux-x64-gnu.node not found'
    )
  })

  it('degrades gracefully when the loaded module has no parseFile', () => {
    __resetAxilogForTest()
    const native = loadAxilog(() => ({}) as unknown)
    expect(native).toBeNull()
    expect(axilogUnavailableReason()).toBe('@axiapps/axilog loaded but exposes no parseFile')
  })
})

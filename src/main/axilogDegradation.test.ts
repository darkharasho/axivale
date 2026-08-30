// Task 10 Step 2: proves, programmatically, that the whole AxiLog feature
// degrades honestly when the @axiapps/axilog native module is absent —
// without renaming anything under node_modules.
//
// axilogNative.ts already exposes an injectable `requireFn` seam on
// loadAxilog() specifically so tests can exercise the "native module missing"
// path on any machine, regardless of whether the real binary happens to be
// present. A test that only passes after someone manually renames
// node_modules/@axiapps/axilog is not a test worth committing — it can't run
// in CI and it risks leaving a contributor's tree broken. This file uses the
// seam instead, and mirrors the exact gating expression index.ts uses
// (`axilogUnavailableReason() === null ? new AxilogService(...) : null`) so a
// regression in that wiring would show up here too.
import { describe, it, expect, beforeEach } from 'vitest'
import { loadAxilog, axilogUnavailableReason, __resetAxilogForTest } from './axilogNative'
import { buildAxilogReference } from './axilogPrompt'
import { buildAxilogTools } from './tools/axilog'
import { AxilogWatcher } from './axilogWatcher'

const simulateAbsent = (): void => {
  loadAxilog(() => {
    throw new Error("Cannot find module '@axiapps/axilog'")
  })
}

describe('AxiLog degrades honestly when the native module is absent', () => {
  beforeEach(() => {
    __resetAxilogForTest()
  })

  it('1. axilogUnavailableReason() returns a non-null, human-readable reason', () => {
    simulateAbsent()
    const reason = axilogUnavailableReason()
    expect(reason).toBeTruthy()
    expect(typeof reason).toBe('string')
    expect(reason).toMatch(/axilog/i)
  })

  it('2. every axilog tool that needs the parser fails with an honest error, not a raw stack, while filesystem-only tools keep working', async () => {
    simulateAbsent()
    // Mirrors index.ts: `axilogService = axilogUnavailableReason() === null ? new AxilogService(...) : null`
    const service = axilogUnavailableReason() === null ? ({} as never) : null

    const watcher = new AxilogWatcher({ dir: () => null, now: () => 0 })
    const entry = watcher.registerOpened('/logs/20260830-211432.zevtc')
    const tools = buildAxilogTools(() => ({ watcher, service }))

    // The tools remain registered (this codebase's chosen degradation shape,
    // per tools/axilog.ts's `resolve()` guard) rather than disappearing.
    expect(tools.map((t) => t.name).sort()).toEqual([
      'axilog_fight_overview',
      'axilog_logs_list',
      'axilog_query',
      'axilog_section',
      'axilog_sections_list'
    ])

    const call = async (name: string, args: unknown) => {
      const t = tools.find((x) => x.name === name)!
      return t.handler(args as never, {} as never) as unknown as {
        isError?: boolean
        content: Array<{ text: string }>
      }
    }

    for (const [name, args] of [
      ['axilog_fight_overview', { logId: entry.logId }],
      ['axilog_section', { logId: entry.logId, section: 'support' }],
      ['axilog_query', { logId: entry.logId, filter: '.' }]
    ] as const) {
      const res = await call(name, args)
      expect(res.isError, `${name} should error rather than crash`).toBe(true)
      const text = res.content[0].text
      expect(text).toMatch(/not available/i)
      // No raw stack trace / file:line leakage to the model.
      expect(text).not.toMatch(/at .*\(.*:\d+:\d+\)/)
      expect(text).not.toMatch(/node_modules/)
    }

    // Listing logs and sections needs no parser and must still succeed.
    const list = await call('axilog_logs_list', {})
    expect(list.isError).toBeFalsy()
    const sections = await call('axilog_sections_list', {})
    expect(sections.isError).toBeFalsy()
  })

  it('3. buildAxilogReference gates off entirely, so the prompt block costs nothing', () => {
    simulateAbsent()
    const available = axilogUnavailableReason() === null
    expect(available).toBe(false)
    expect(buildAxilogReference(available)).toBe('')
  })

  it('4. main-process modules that touch AxiLog still import cleanly with the native module absent', async () => {
    simulateAbsent()
    await expect(import('./axilogWatcher')).resolves.toBeTruthy()
    await expect(import('./axilogService')).resolves.toBeTruthy()
    await expect(import('./axilogSections')).resolves.toBeTruthy()
    await expect(import('./axilogPrompt')).resolves.toBeTruthy()
    await expect(import('./tools/axilog')).resolves.toBeTruthy()
    await expect(import('./tools/index')).resolves.toBeTruthy()
  })
})

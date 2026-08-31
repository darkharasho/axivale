// src/main/index.axilogAvailable.test.ts
//
// index.ts is Electron main-process wiring (it calls app.whenReady() at
// module scope), so it cannot be imported directly under vitest without a
// full Electron mock. computeAxilogAvailable/resolveAxilogDir in
// axilogWatcher.ts carry their own direct unit coverage — this test instead
// guards the WIRING itself: that index.ts's `axilogAvailable` deps field
// actually delegates to the shared, tested computeAxilogAvailable() rather
// than hand-rolling its own (narrower) dir check again. That hand-rolled
// re-inlining is the exact regression this file exists to catch — a
// pure-function unit test alone does not see it, because nothing exercises
// index.ts's source at all otherwise.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function extractAxilogAvailableField(src: string): string {
  const marker = 'axilogAvailable:'
  const start = src.indexOf(marker)
  expect(start, 'axilogAvailable field present in index.ts').toBeGreaterThan(-1)
  // Slice to the matching top-level comma (depth-aware, so commas inside the
  // nested computeAxilogAvailable({...}) call don't end the slice early).
  let depth = 0
  let end = start
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{' || ch === '(') depth++
    else if (ch === '}' || ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      end = i
      break
    }
  }
  return src.slice(start, end)
}

describe('index.ts axilogAvailable wiring', () => {
  const src = readFileSync(join(__dirname, 'index.ts'), 'utf8')
  const field = extractAxilogAvailableField(src)

  it('delegates to the shared computeAxilogAvailable rather than re-deriving the dir check', () => {
    expect(field).toContain('computeAxilogAvailable(')
  })

  it('does not call detectLogDir directly (that bypasses the configured-dir override)', () => {
    expect(field).not.toContain('detectLogDir(')
  })
})

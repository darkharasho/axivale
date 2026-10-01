import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** Every bundle entry that pulls in theme.css, directly or via App. */
const ENTRIES = [
  { name: 'renderer', path: new URL('./main.tsx', import.meta.url) },
  { name: 'share-viewer', path: new URL('../../share-viewer/main.tsx', import.meta.url) }
]

describe('bundle entries', () => {
  // theme.css declares no values of its own any more — it aliases onto
  // --axi-* tokens. An entry that pulls in theme.css without axi.css renders
  // with every token undefined: invisible text on a transparent ground, and
  // it builds cleanly, because custom properties fail at paint, not at build.
  // That is exactly how the share viewer broke when the bridge landed.
  it.each(ENTRIES)('$name imports axi.css so the bridged tokens resolve', ({ path }) => {
    const src = readFileSync(path, 'utf8')
    expect(src).toMatch(/@axiapps\/axi-design\/axi\.css/)
    expect(src).toMatch(/@axiapps\/axi-design\/accents\.css/)
  })

  it.each(ENTRIES)('$name imports axi.css before theme.css', ({ path }) => {
    // Import statements only — a comment mentioning theme.css is not an import,
    // and matching prose here would make the ordering check meaningless.
    const imports = (readFileSync(path, 'utf8').match(/^import .*$/gm) ?? []).join('\n')
    const axi = imports.indexOf('axi-design/axi.css')
    // theme.css reaches the renderer entry via App; the share viewer imports it directly.
    const theme = imports.includes('theme.css')
      ? imports.indexOf('theme.css')
      : imports.indexOf("from './App'")
    expect(axi).toBeGreaterThan(-1)
    expect(theme).toBeGreaterThan(-1)
    expect(axi).toBeLessThan(theme)
  })

  it('share-viewer pins an accent, having no picker and no IPC', () => {
    const src = readFileSync(ENTRIES[1].path, 'utf8')
    expect(src).toMatch(/setAttribute\(\s*'data-axi-accent'\s*,\s*'crimson-red'\s*\)/)
  })
})

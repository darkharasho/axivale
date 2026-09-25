import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// import.meta.url, not __dirname: package.json sets "type": "module", so this
// file is ESM and __dirname does not exist in it.
const themeCss = readFileSync(new URL('./theme.css', import.meta.url), 'utf8')

/** The :root block only — where tokens are declared. */
const rootBlock = themeCss.slice(
  themeCss.indexOf(':root{'),
  themeCss.indexOf('}', themeCss.indexOf(':root{')) + 1
)

describe('token bridge', () => {
  it('declares no raw hex colours in :root', () => {
    expect(rootBlock).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('aliases every legacy token onto an axi token', () => {
    for (const name of [
      'bg',
      'bg2',
      'paper',
      'line',
      'rule',
      'rule2',
      'ink',
      'ink-dim',
      'faint',
      'accent',
      'green',
      'amber'
    ]) {
      expect(rootBlock).toMatch(new RegExp(`--${name}\\s*:\\s*var\\(--axi-`))
    }
  })

  it('derives --accent-b from the live accent rather than pinning it', () => {
    expect(rootBlock).toMatch(
      /--accent-b\s*:\s*color-mix\(in srgb,\s*var\(--axi-accent\)\s*82%,\s*white\)/
    )
  })

  it('derives --focus from the live accent rather than pinning it', () => {
    expect(rootBlock).toMatch(/--focus\s*:\s*color-mix\(in srgb,\s*var\(--axi-accent\)/)
  })
})

/** The `body{...}` rule, which is where the app's ground is drawn. */
const bodyRule = themeCss.match(/(?:^|\n)body\{[^}]*\}/)?.[0] ?? ''

describe('sanctioned departures', () => {
  // Without this, an extraction that silently matches nothing turns every
  // `not.toMatch` below into a test that passes because it asserts on ''.
  it('extracts a non-empty body rule to assert against', () => {
    expect(bodyRule).toMatch(/^\nbody\{/)
  })

  it('draws the body on the flat ground, with no gradient', () => {
    expect(bodyRule).toMatch(/background:\s*var\(--axi-ground\)/)
    expect(bodyRule).not.toMatch(/gradient/)
  })

  it('does not set a serif body font', () => {
    expect(bodyRule).not.toMatch(/font-family/)
  })

  // Departure 2 of 2: the halftone scanline, scoped to the reading column
  // rather than painted across the app.
  it('scopes the scanline to the editorial column', () => {
    const chatcol = themeCss.match(/\.chatcol\{[^}]*\}/)?.[0] ?? ''
    expect(chatcol).toMatch(/repeating-linear-gradient/)
  })

  it('uses repeating-linear-gradient nowhere but the scanline', () => {
    expect(themeCss.match(/repeating-linear-gradient/g)).toHaveLength(1)
  })

  // Departure 1 of 2: the torn paper edges, on user clippings and the input.
  it('keeps exactly two clip-path torn edges, drawn on the axi surface', () => {
    expect(themeCss.match(/clip-path/g)).toHaveLength(2)
    expect(themeCss).not.toMatch(/\.msg\.user \.body::after\{[^}]*var\(--paper\)/)
    expect(themeCss).not.toMatch(/\.inputzone::before\{[^}]*var\(--paper\)/)
  })
})

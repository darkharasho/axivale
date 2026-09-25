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

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { EmojiIcon, renderExtLink } from './emojiIcons'

// jsdom normalizes inline backgroundColor hex values to rgb() form.
// We compare against those normalized values.

// Helper: convert #rrggbb to the rgb() string jsdom produces
function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgb(${r}, ${g}, ${b})`
}

function assertColoredSpan(emoji: string, hex: string): void {
  const { container } = render(<EmojiIcon emoji={emoji} />)
  const span = container.querySelector('span')
  expect(span, `${emoji} should render a span`).toBeTruthy()
  expect(span!.style.backgroundColor).toBe(hexToRgb(hex))
}

describe('EmojiIcon – colored-shape emoji', () => {
  // Circles
  it('renders 🔴 tinted red (#e0352b)', () => assertColoredSpan('🔴', '#e0352b'))
  it('renders 🟠 tinted orange (#e67e22)', () => assertColoredSpan('🟠', '#e67e22'))
  it('renders 🟡 tinted yellow (#f1c40f)', () => assertColoredSpan('🟡', '#f1c40f'))
  it('renders 🟢 tinted green (#2ecc71)', () => assertColoredSpan('🟢', '#2ecc71'))
  it('renders 🔵 tinted blue (#3498db)', () => assertColoredSpan('🔵', '#3498db'))
  it('renders 🟣 tinted purple (#9b59b6)', () => assertColoredSpan('🟣', '#9b59b6'))
  it('renders 🟤 tinted brown (#8a5a2b)', () => assertColoredSpan('🟤', '#8a5a2b'))
  it('renders ⚫ tinted near-black (#2c2c2c)', () => assertColoredSpan('⚫', '#2c2c2c'))
  it('renders ⚪ tinted light-grey (#d8d8d8)', () => assertColoredSpan('⚪', '#d8d8d8'))

  // Squares
  it('renders 🟥 tinted red (#e0352b)', () => assertColoredSpan('🟥', '#e0352b'))
  it('renders 🟧 tinted orange (#e67e22)', () => assertColoredSpan('🟧', '#e67e22'))
  it('renders 🟨 tinted yellow (#f1c40f)', () => assertColoredSpan('🟨', '#f1c40f'))
  it('renders 🟩 tinted green (#2ecc71)', () => assertColoredSpan('🟩', '#2ecc71'))
  it('renders 🟦 tinted blue (#3498db)', () => assertColoredSpan('🟦', '#3498db'))
  it('renders 🟪 tinted purple (#9b59b6)', () => assertColoredSpan('🟪', '#9b59b6'))
  it('renders 🟫 tinted brown (#8a5a2b)', () => assertColoredSpan('🟫', '#8a5a2b'))
  it('renders ⬛ tinted near-black (#2c2c2c)', () => assertColoredSpan('⬛', '#2c2c2c'))
  it('renders ⬜ tinted light-grey (#d8d8d8)', () => assertColoredSpan('⬜', '#d8d8d8'))
})

describe('EmojiIcon – non-color emoji do not get a colored background', () => {
  it('renders 🔥 as a Lucide icon SVG, no span', () => {
    const { container } = render(<EmojiIcon emoji="🔥" />)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(container.querySelector('span')).toBeNull()
  })

  it('renders 🚀 as a Lucide icon SVG, no span', () => {
    const { container } = render(<EmojiIcon emoji="🚀" />)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(container.querySelector('span')).toBeNull()
  })

  it('renders ✅ as a Lucide icon SVG, no span', () => {
    const { container } = render(<EmojiIcon emoji="✅" />)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(container.querySelector('span')).toBeNull()
  })

  it('renderExtLink opens links in a new tab with safe rel', () => {
    const { container } = render(renderExtLink({ href: 'https://snowcrows.com/builds/wvw', children: 'Snowcrows' }))
    const a = container.querySelector('a')!
    expect(a.getAttribute('href')).toBe('https://snowcrows.com/builds/wvw')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    expect(a.textContent).toBe('Snowcrows')
  })
})

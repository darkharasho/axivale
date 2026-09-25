// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Appearance from './Appearance'
import { ACCENTS, DEFAULT_ACCENT_ID } from '../../themes/accents'

describe('Appearance', () => {
  it('renders one swatch per official accent', () => {
    const { container } = render(<Appearance accent={DEFAULT_ACCENT_ID} onSelect={vi.fn()} />)
    expect(container.querySelectorAll('.accent-swatch')).toHaveLength(ACCENTS.length)
  })

  it('marks the active accent as pressed, and only that one', () => {
    const { container } = render(<Appearance accent="teal-ocean" onSelect={vi.fn()} />)
    const pressed = container.querySelectorAll('.accent-swatch[aria-pressed="true"]')
    expect(pressed).toHaveLength(1)
    expect(pressed[0].getAttribute('data-accent-id')).toBe('teal-ocean')
  })

  it('reports the chosen accent', () => {
    const onSelect = vi.fn()
    const { container } = render(<Appearance accent={DEFAULT_ACCENT_ID} onSelect={onSelect} />)
    fireEvent.click(container.querySelector('[data-accent-id="violet-purple"]')!)
    expect(onSelect).toHaveBeenCalledWith('violet-purple')
  })

  it('paints each swatch in its own accent hex', () => {
    const { container } = render(<Appearance accent={DEFAULT_ACCENT_ID} onSelect={vi.fn()} />)
    const crimson = container.querySelector('[data-accent-id="crimson-red"]') as HTMLElement
    expect(crimson.style.getPropertyValue('--swatch')).toBe('#ef4444')
  })
})

// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Appearance from './Appearance'
import { ACCENTS, DEFAULT_ACCENT_ID } from '../../themes/accents'

function renderAppearance(
  overrides: Partial<{ accent: string; onSelect: (id: string) => void }> = {}
): ReturnType<typeof render> {
  return render(
    <Appearance
      accent={overrides.accent ?? DEFAULT_ACCENT_ID}
      onSelect={overrides.onSelect ?? vi.fn()}
      surface="axi"
      onSelectSurface={vi.fn()}
    />
  )
}

describe('Appearance', () => {
  it('renders one swatch per official accent', () => {
    const { container } = renderAppearance()
    expect(container.querySelectorAll('.accent-swatch')).toHaveLength(ACCENTS.length)
  })

  it('marks the active accent as pressed, and only that one', () => {
    const { container } = renderAppearance({ accent: 'teal-ocean' })
    const pressed = container.querySelectorAll('.accent-swatch[aria-pressed="true"]')
    expect(pressed).toHaveLength(1)
    expect(pressed[0].getAttribute('data-accent-id')).toBe('teal-ocean')
  })

  it('reports the chosen accent', () => {
    const onSelect = vi.fn()
    const { container } = renderAppearance({ onSelect })
    fireEvent.click(container.querySelector('[data-accent-id="violet-purple"]')!)
    expect(onSelect).toHaveBeenCalledWith('violet-purple')
  })

  it('paints each swatch in its own accent hex', () => {
    const { container } = renderAppearance()
    const crimson = container.querySelector('[data-accent-id="crimson-red"]') as HTMLElement
    expect(crimson.style.getPropertyValue('--swatch')).toBe('#ef4444')
  })

  it('marks the current surface pressed and reports a click', () => {
    const onSelectSurface = vi.fn()
    const { getByRole } = render(
      <Appearance
        accent="crimson-red"
        onSelect={vi.fn()}
        surface="flat"
        onSelectSurface={onSelectSurface}
      />
    )
    const flat = getByRole('button', { name: 'Flat' })
    expect(flat.getAttribute('aria-pressed')).toBe('true')
    expect(getByRole('button', { name: 'Glass' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(getByRole('button', { name: 'Glass' }))
    expect(onSelectSurface).toHaveBeenCalledWith('glass')
  })
})

// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Notifications from './Notifications'

function renderNotifications(system = true, badge = true) {
  return render(
    <Notifications
      system={system}
      badge={badge}
      onToggleSystem={vi.fn()}
      onToggleBadge={vi.fn()}
    />
  )
}

describe('Notifications toggles', () => {
  // The toggle was a button with its state in a class name (.sk2-toggle.off)
  // and an LED span. A screen reader had no way to know it was a switch, let
  // alone which way it was set.
  it('exposes each toggle as a switch', () => {
    const { container } = renderNotifications()
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(2)
  })

  it('reports its state through aria-checked rather than a class', () => {
    const { container } = renderNotifications(true, false)
    const [system, badge] = Array.from(container.querySelectorAll('[role="switch"]'))
    expect(system.getAttribute('aria-checked')).toBe('true')
    expect(badge.getAttribute('aria-checked')).toBe('false')
  })

  it('carries the axi switch form and its knob', () => {
    const { container } = renderNotifications()
    const sw = container.querySelector('[role="switch"]')!
    expect(sw.classList.contains('axi-switch')).toBe(true)
    // The knob's travel is a calc over the track's own tokens, so the track
    // must contain nothing but the knob.
    expect(sw.children).toHaveLength(1)
    expect(sw.children[0].classList.contains('axi-switch__knob')).toBe(true)
  })

  it('still toggles when clicked', () => {
    const onToggleSystem = vi.fn()
    const { container } = render(
      <Notifications
        system={false}
        badge
        onToggleSystem={onToggleSystem}
        onToggleBadge={vi.fn()}
      />
    )
    fireEvent.click(container.querySelector('[role="switch"]')!)
    expect(onToggleSystem).toHaveBeenCalledWith(true)
  })
})

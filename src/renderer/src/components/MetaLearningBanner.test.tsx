// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import MetaLearningBanner from './MetaLearningBanner'

function officer() {
  let cb: ((e: unknown) => void) | null = null
  return { onLearnProgress: (fn: (e: unknown) => void) => { cb = fn; return () => {} }, __fire: (e: unknown) => cb?.(e) }
}
beforeEach(() => { (window as unknown as { officer: unknown }).officer = officer() })

describe('MetaLearningBanner', () => {
  it('is hidden until a refresh starts', () => {
    const { container } = render(<MetaLearningBanner />)
    expect(container.querySelector('.learn-banner')).toBeNull()
  })
  it('shows a phase on start, advances per advance, hides on done', () => {
    const o = (window as unknown as { officer: { __fire: (e: unknown) => void } }).officer
    const { container } = render(<MetaLearningBanner />)
    act(() => o.__fire({ phase: 'meta', kind: 'start', total: 2, label: 'Learning the current meta…' }))
    expect(screen.getByText(/learning the current meta/i)).toBeTruthy()
    const fill = container.querySelector('.learn-fill') as HTMLElement
    expect(fill.style.width).toBe('0%')
    act(() => o.__fire({ phase: 'meta', kind: 'advance' }))
    expect((container.querySelector('.learn-fill') as HTMLElement).style.width).toBe('50%')
    act(() => o.__fire({ phase: 'meta', kind: 'done' }))
    expect(container.querySelector('.learn-banner')).toBeNull()
  })

  it('shows meta and wiki phases concurrently, each with its own bar', () => {
    const o = (window as unknown as { officer: { __fire: (e: unknown) => void } }).officer
    const { container } = render(<MetaLearningBanner />)
    act(() => o.__fire({ phase: 'meta', kind: 'start', total: 4, label: 'Learning the current meta…' }))
    act(() => o.__fire({ phase: 'wiki', kind: 'start', total: 10, label: 'Reading the GW2 wiki…' }))
    expect(container.querySelectorAll('.learn-banner')).toHaveLength(2)
    expect(screen.getByText(/reading the gw2 wiki/i)).toBeTruthy()
    // advancing wiki does not affect the meta bar
    act(() => o.__fire({ phase: 'wiki', kind: 'advance' }))
    const fills = Array.from(container.querySelectorAll('.learn-fill')) as HTMLElement[]
    expect(fills.map((f) => f.style.width).sort()).toEqual(['0%', '10%'])
    // wiki finishes; meta bar remains
    act(() => o.__fire({ phase: 'wiki', kind: 'done' }))
    expect(container.querySelectorAll('.learn-banner')).toHaveLength(1)
    expect(screen.getByText(/learning the current meta/i)).toBeTruthy()
  })
}
)

// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import MetaLearningBanner from './MetaLearningBanner'

function officer() {
  let cb: ((e: unknown) => void) | null = null
  return { onMetaProgress: (fn: (e: unknown) => void) => { cb = fn; return () => {} }, __fire: (e: unknown) => cb?.(e) }
}
beforeEach(() => { (window as unknown as { officer: unknown }).officer = officer() })

describe('MetaLearningBanner', () => {
  it('is hidden until a refresh starts', () => {
    const { container } = render(<MetaLearningBanner />)
    expect(container.querySelector('.learn-banner')).toBeNull()
  })
  it('shows on refresh-start and advances the bar per source-done, hides on idle', () => {
    const o = (window as unknown as { officer: { __fire: (e: unknown) => void } }).officer
    const { container } = render(<MetaLearningBanner />)
    act(() => o.__fire({ type: 'refresh-start', total: 2 }))
    expect(screen.getByText(/learning the current meta/i)).toBeTruthy()
    const fill = container.querySelector('.learn-fill') as HTMLElement
    expect(fill.style.width).toBe('0%')
    act(() => o.__fire({ type: 'source-done', modeId: 'a', url: 'https://x.com' }))
    expect((container.querySelector('.learn-fill') as HTMLElement).style.width).toBe('50%')
    act(() => o.__fire({ type: 'idle' }))
    expect(container.querySelector('.learn-banner')).toBeNull()
  })
}
)

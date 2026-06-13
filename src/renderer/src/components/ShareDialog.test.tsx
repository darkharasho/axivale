// @vitest-environment jsdom
// src/renderer/src/components/ShareDialog.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ShareDialog, { type ShareState } from './ShareDialog'

describe('ShareDialog', () => {
  it('renders nothing when idle', () => {
    const { container } = render(<ShareDialog state={{ status: 'idle' }} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows a pending message while publishing', () => {
    render(<ShareDialog state={{ status: 'publishing' }} onClose={() => {}} />)
    expect(screen.getByText(/going to press/i)).toBeTruthy()
    expect(screen.getByText(/ready in a moment/i)).toBeTruthy()
  })

  it('shows the url and copies it on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const state: ShareState = { status: 'done', url: 'https://x.github.io/axivale-shares/#/s/abc' }
    render(<ShareDialog state={state} onClose={() => {}} />)
    expect(screen.getByDisplayValue(state.url!)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }))
    expect(writeText).toHaveBeenCalledWith(state.url)
  })

  it('shows an error and a close button', () => {
    const onClose = vi.fn()
    render(<ShareDialog state={{ status: 'error', error: 'nope' }} onClose={onClose} />)
    expect(screen.getByText('nope')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })
})

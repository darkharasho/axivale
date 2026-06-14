// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MetaIndexInspector from './MetaIndexInspector'

function officer(over: Record<string, unknown> = {}) {
  return {
    metaIndexStats: vi.fn().mockResolvedValue({ total: 42, byMode: { PvE: 30, WvW: 12 }, bySource: { 'snowcrows.com': 30, 'metabattle.com': 12 }, lastIndexedAt: '2026-06-14T00:00:00.000Z' }),
    metaIndexSample: vi.fn().mockResolvedValue([{ id: 'a:0', mode: 'PvE', source: 'snowcrows.com', url: 'a', title: 'Power Tempest', snippet: 'runs Force', indexedAt: '' }]),
    metaIndexSearch: vi.fn().mockResolvedValue([{ source: 'snowcrows.com', url: 'a', title: 'Power Tempest', snippet: 'sigil of force', score: 0.91 }]),
    ...over
  }
}
beforeEach(() => {
  ;(window as unknown as { officer: unknown }).officer = officer()
})

describe('MetaIndexInspector', () => {
  it('renders index stats on mount', async () => {
    render(<MetaIndexInspector />)
    expect(await screen.findByText(/42/)).toBeTruthy()
    expect(screen.getByText(/PvE: 30/)).toBeTruthy()
  })

  it('runs a test search and renders ranked hits', async () => {
    const search = vi.fn().mockResolvedValue([{ source: 'metabattle.com', url: 'b', title: 'Scourge', snippet: 'curse', score: 0.8 }])
    ;(window as unknown as { officer: unknown }).officer = officer({ metaIndexSearch: search })
    render(<MetaIndexInspector />)
    fireEvent.change(screen.getByPlaceholderText(/test search/i), { target: { value: 'scourge' } })
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))
    await waitFor(() => expect(search).toHaveBeenCalledWith('scourge', undefined))
    expect(await screen.findByText('Scourge')).toBeTruthy()
  })

  it('loads a sample of chunks', async () => {
    render(<MetaIndexInspector />)
    fireEvent.click(screen.getByRole('button', { name: /load sample/i }))
    expect(await screen.findByText('Power Tempest')).toBeTruthy()
  })
})
